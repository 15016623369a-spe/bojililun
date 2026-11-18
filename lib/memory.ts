/**
 * 记忆层（服务端）。
 *
 * 设计要点：
 * 1. 约束类记忆永远进上下文，不做检索裁剪 —— 忘掉“左肩有伤”会让人受伤。
 * 2. 写入必须经过用户确认（卡片），并且冲突时不静默覆盖。
 * 3. 事件类数据（吃了什么、练了什么）不进记忆表，直接查 meal_log / workout_log。
 */
import { getDb } from './db';
import type { CandidateMemory, Memory, MemoryKind } from './types';

export function nowIso(): string {
  return new Date().toISOString();
}

type Row = {
  id: number;
  kind: string;
  key: string;
  content: string;
  importance: number;
  source: string;
  confidence: number;
  status: string;
  created_at: string;
  updated_at: string;
};

function toMemory(r: Row): Memory {
  return { ...r, kind: r.kind as MemoryKind, status: r.status as Memory['status'] };
}

export function listMemories(includeArchived = false): Memory[] {
  const db = getDb();
  const sql = includeArchived
    ? 'SELECT * FROM memory ORDER BY importance DESC, updated_at DESC'
    : "SELECT * FROM memory WHERE status = 'active' ORDER BY importance DESC, updated_at DESC";
  return (db.prepare(sql).all() as Row[]).map(toMemory);
}

/** 约束优先 + 高重要度优先，全部返回（这一层不裁剪） */
export function getAlwaysOnMemories(): Memory[] {
  return listMemories().filter((m) => m.kind === 'constraint' || m.importance >= 4);
}

/** 按关键词做极简相关度检索（够用，先不上向量库） */
export function searchMemories(query: string, limit = 6): Memory[] {
  const mems = listMemories();
  if (!query.trim()) return mems.filter((m) => m.importance >= 4).slice(0, limit);
  const q = query.toLowerCase();
  const scored = mems.map((m) => {
    let score = m.importance;
    const content = (m.content + ' ' + m.key).toLowerCase();
    // 中文按 2-gram 粗略重合度打分
    for (let i = 0; i < q.length - 1; i++) {
      const gram = q.slice(i, i + 2);
      if (gram.trim() && content.includes(gram)) score += 1.5;
    }
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.m);
}

export interface UpsertResult {
  memory: Memory;
  action: 'created' | 'updated' | 'unchanged';
  previous?: string;
}

export function upsertMemory(
  input: CandidateMemory & { source?: string; confidence?: number },
): UpsertResult {
  const db = getDb();
  const now = nowIso();
  const existing = db.prepare('SELECT * FROM memory WHERE key = ?').get(input.key) as Row | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO memory (kind, key, content, importance, source, confidence, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      input.kind,
      input.key,
      input.content,
      input.importance,
      input.source ?? 'chat',
      input.confidence ?? 0.8,
      now,
      now,
    );
    const created = db.prepare('SELECT * FROM memory WHERE key = ?').get(input.key) as Row;
    return { memory: toMemory(created), action: 'created' };
  }

  if (existing.content === input.content) {
    db.prepare('UPDATE memory SET updated_at = ?, status = (?) WHERE key = ?').run(now, 'active', input.key);
    return { memory: toMemory({ ...existing, status: 'active', updated_at: now }), action: 'unchanged' };
  }

  db.prepare(
    `UPDATE memory SET content = ?, importance = MAX(importance, ?), status = 'active', updated_at = ?
     WHERE key = ?`,
  ).run(input.content, input.importance, now, input.key);
  const updated = db.prepare('SELECT * FROM memory WHERE key = ?').get(input.key) as Row;
  return { memory: toMemory(updated), action: 'updated', previous: existing.content };
}

export function archiveMemory(id: number): void {
  getDb()
    .prepare("UPDATE memory SET status = 'archived', updated_at = ? WHERE id = ?")
    .run(nowIso(), id);
}

export function deleteMemory(id: number): void {
  getDb().prepare('DELETE FROM memory WHERE id = ?').run(id);
}

/** 拼成给模型看的记忆块 */
export function buildMemoryBlock(memories: Memory[]): string {
  if (!memories.length) return '';
  const order: MemoryKind[] = ['constraint', 'goal', 'equipment', 'preference', 'fact'];
  const label: Record<MemoryKind, string> = {
    constraint: '约束（必须遵守）',
    goal: '目标',
    equipment: '可用器械',
    preference: '偏好',
    fact: '背景事实',
  };
  const lines: string[] = [];
  for (const kind of order) {
    const group = memories.filter((m) => m.kind === kind);
    if (!group.length) continue;
    lines.push(`# ${label[kind]}`);
    for (const m of group) lines.push(`- ${m.content}`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 从一段话里抽取“值得记住的信息”——纯规则版，真实模型接入后可换成 LLM 抽取 */
/* ------------------------------------------------------------------ */

const BODY = '(左|右)?(肩|肩膀|膝盖|膝|腰|腰椎|手腕|肘|手肘|脚踝|髋|脖子|颈椎|后背|下背|跟腱)';

interface Rule {
  kind: MemoryKind;
  importance: number;
  re: RegExp;
  key: (m: RegExpMatchArray) => string;
  content: (m: RegExpMatchArray) => string;
}

const RULES: Rule[] = [
  {
    kind: 'constraint',
    importance: 5,
    re: new RegExp(`${BODY}[^，。,.；;！!？?\\s]{0,8}(伤|疼|痛|受伤|不适|积液|做过手术|做过手术)`, 'g'),
    key: (m) => `injury:${m[1] ?? ''}${m[2]}`,
    content: (m) => `身体约束：${m[0]}`,
  },
  {
    kind: 'constraint',
    importance: 5,
    re: /(不能|不可以|避免)(做|练|用|吃)([^，。,.；;！!？?\s]{1,16})/g,
    key: (m) => `forbid:${m[3]}`,
    content: (m) => `禁忌：${m[0]}`,
  },
  {
    kind: 'constraint',
    importance: 5,
    re: /对?([^，。,.；;！!？?\s]{1,8})过敏/g,
    key: (m) => `allergy:${m[1]}`,
    content: (m) => `过敏：${m[1]}`,
  },
  {
    kind: 'preference',
    importance: 3,
    re: /(不喜欢|不爱吃|不吃|讨厌|接受不了|不想吃)([^，。,.；;！!？?\s]{1,10})/g,
    key: (m) => `dislike:${m[2]}`,
    content: (m) => `不吃 / 不喜欢：${m[2]}`,
  },
  {
    kind: 'equipment',
    importance: 4,
    re: /(我家|家里|健身房|宿舍|器材)(?:只)?(?:有|是)([^，。,.；;！!？?\s]{1,24})/g,
    key: (m) => `equipment:${m[2]}`,
    content: (m) => `${m[1]}可用器械：${m[2]}`,
  },
  {
    kind: 'goal',
    importance: 4,
    re: /(?:我(?:的)?目标(?:是)?|正在|打算)(减脂|增肌|维持|塑形|备赛|刷脂)/g,
    key: (m) => `goal:${m[1]}`,
    content: (m) => `当前目标：${m[1]}`,
  },
  {
    kind: 'fact',
    importance: 3,
    re: /(?:记住|记一下|记下|别忘了)[:：,，]?\s*([^。！!？?\n]{2,40})/g,
    key: (m) => `note:${m[1].trim().slice(0, 20)}`,
    content: (m) => m[1].trim(),
  },
];

export function extractMemoryCandidates(text: string): CandidateMemory[] {
  if (!text || text.length < 3) return [];
  const out: CandidateMemory[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      const key = rule.key(m).replace(/\s+/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: rule.kind, key, content: rule.content(m), importance: rule.importance });
    }
  }
  return out.slice(0, 5);
}
