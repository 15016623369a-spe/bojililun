import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR, getDb } from '../db';
import { getProvider } from '../ai';
import { enrichItems } from './enrich';
import { currentMealType, MEAL_LABEL, type MealType } from '../date';
import { buildMemoryBlock, extractMemoryCandidates, getAlwaysOnMemories, listMemories, searchMemories } from '../memory';
import { findExercises, type ExerciseRow } from '../exercise';
import { EQUIPMENT_LABEL, TARGET_LABEL } from '../exercise-label';
import { addPlanItem, getPlan } from './workout';
import type { AssistantReply, FoodItem } from '../types';
import type { RawItem } from '../ai/types';

const MAX_BYTES = 8 * 1024 * 1024;

const TZ = process.env.APP_TZ || 'Asia/Shanghai';

/* ---------------------------- 图片落盘 ---------------------------- */

export function savePhoto(dataUrl: string): string {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('图片格式不支持（需要 jpeg / png / webp）');
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw new Error('图片太大了，先压缩一下');
  const name = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return `/api/uploads/${name}`;
}

/* ---------------------------- 草稿卡 ---------------------------- */

interface DraftPayload {
  items: FoodItem[];
  mealType: MealType;
  photoUrl?: string;
  note?: string;
}

function createDraft(payload: DraftPayload): string {
  const draftId = crypto.randomUUID();
  getDb()
    .prepare('INSERT INTO draft (id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)')
    .run(draftId, 'food', JSON.stringify(payload), new Date().toISOString());
  return draftId;
}

/** 顺手清理一天前的草稿，避免一直挂着 */
export function cleanupDrafts(): void {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  getDb().prepare('DELETE FROM draft WHERE created_at < ?').run(cutoff);
}

/* ---------------------------- 记忆上下文 ---------------------------- */

function memoryBlockFor(query: string): string {
  const always = getAlwaysOnMemories();
  const relevant = searchMemories(query, 4).filter((m) => !always.some((a) => a.id === m.id));
  return buildMemoryBlock([...always, ...relevant]);
}

/* ---------------------------- 训练 / 器械意图 ---------------------------- */

const BODY_PART: Array<[RegExp, string, string]> = [
  [/胸/, 'chest', '胸'],
  [/背|引体|划船/, 'back', '背'],
  [/腿|股四|深蹲|腿举/, 'upper legs', '腿'],
  [/肩|三角肌/, 'shoulders', '肩'],
  [/手臂|二头|三头|肱/, 'upper arms', '手臂'],
  [/腹|核心|卷腹/, 'waist', '腹'],
];

const EQUIPMENT_WORDS: Array<[RegExp, string]> = [
  [/杠铃/, 'barbell'],
  [/哑铃/, 'dumbbell'],
  [/史密斯/, 'smith machine'],
  [/龙门架|绳索|缆|拉力器/, 'cable'],
  [/壶铃/, 'kettlebell'],
  [/弹力带|阻力带/, 'band'],
  [/固定器械|器械/, 'leverage machine'],
  [/单杠|引体向上杆/, 'body weight'],
];

const WORKOUT_RE = /(练|训练|动作|计划|安排|怎么练)/;

function trimZh(text: string, max = 90): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function equipmentsFromMemory(mems: Array<{ kind: string; content: string }>): string[] {
  const found = new Set<string>();
  for (const m of mems) {
    if (m.kind !== 'equipment') continue;
    for (const [re, eq] of EQUIPMENT_WORDS) {
      if (re.test(m.content)) found.add(eq);
    }
  }
  return [...found];
}

/* ---------------------------- 约束 → 动作安全过滤 ---------------------------- */

/**
 * 确定性安全规则：伤病/禁忌类记忆 → 高风险动作关键词。
 * 匹配动作英文名 + 中文名；宁可保守排除，也不给伤病用户排危险动作。
 * 例如「左肩有伤 / 不能做过顶推举」会排除推举、抓举、挺举、颈后、直立划船等过顶/肩部高压动作。
 */
const CONSTRAINT_RULES: Array<{ trigger: RegExp; exclude: RegExp; label: string }> = [
  {
    trigger: /肩|过顶|过头|overhead/i,
    exclude:
      /overhead|shoulder press|military|snatch|jerk|push press|thruster|upright row|behind.*neck|arnold|\bclean\b|above.*head|过顶|过头|上方头|颈后|推举|抓举|挺举|借力推|高翻|翻站|直立划船|阿诺德/i,
    label: '过顶/肩部高压类动作',
  },
  {
    trigger: /膝/,
    exclude: /jump|plyo|sprint|跳|爆发|冲刺/i,
    label: '跳跃冲击类动作',
  },
  {
    trigger: /腰|下背|腰椎/,
    exclude: /deadlift|good morning|sit-?up|硬拉|早安式|仰卧起坐/i,
    label: '下背高压类动作',
  },
  {
    trigger: /肘/,
    exclude: /skull|tricep.*extension|臂屈伸/i,
    label: '肘部高压类动作',
  },
  {
    trigger: /腕/,
    exclude: /wrist|curl|腕|弯举/i,
    label: '腕部高压类动作',
  },
];

type MemoryLike = Array<{ kind: string; content: string }>;

function constraintRulesFor(mems: MemoryLike) {
  return CONSTRAINT_RULES.filter((r) =>
    mems.some((m) => m.kind === 'constraint' && r.trigger.test(m.content)),
  );
}

function filterByConstraints(exs: ExerciseRow[], rules: typeof CONSTRAINT_RULES): ExerciseRow[] {
  if (!rules.length) return exs;
  return exs.filter((e) => {
    const text = `${e.name} ${e.zh_name}`;
    return !rules.some((r) => r.exclude.test(text));
  });
}

/** 有约束时扩大候选池，过滤后仍尽量凑够 4 个动作 */
function pickSafeExercises(bodyPart: string, equipments: string[], rules: typeof CONSTRAINT_RULES, want: number) {
  const pool = findExercises({
    bodyPart,
    equipments: equipments.length ? equipments : undefined,
    limit: rules.length ? want * 6 : want,
  });
  return filterByConstraints(pool, rules).slice(0, want);
}

function workoutText(bodyPart: string, label: string): string {
  const mems = listMemories();
  const equipMem = mems.find((m) => m.kind === 'equipment');
  const equipments = equipmentsFromMemory(mems);
  const rules = constraintRulesFor(mems);
  const exs = pickSafeExercises(bodyPart, equipments, rules, 4);

  if (!exs.length) {
    return rules.length
      ? `按你的伤病/禁忌限制筛完，这个部位暂时没有安全的动作了。建议先咨询医生或康复师，或换个部位试试。`
      : `这个部位我暂时没有动作数据，换个部位试试？`;
  }

  const lines = exs.map((e, i) => {
    return `${i + 1}. ${e.zh_name || e.name}（${EQUIPMENT_LABEL[e.equipment] ?? e.equipment}）\n   目标：${TARGET_LABEL[e.target] ?? (e.target || e.muscle_group)}\n   要点：${trimZh(e.zh)}`;
  });

  const parts = [`今天练${label}，给你挑了 ${exs.length} 个动作：`, ...lines, '', '建议 3–4 组 × 8–12 次，组间休息 90 秒；重量按上次完成度微调。'];

  if (equipMem && equipments.length) parts.push(`（已按你的器械条件筛选：${equipMem.content}）`);
  const constraints = mems.filter((m) => m.kind === 'constraint');
  if (rules.length) {
    parts.push(`🛡️ 已按你的限制避开${rules.map((r) => r.label).join('、')}（${constraints.map((c) => c.content).join('；')}）。`);
  } else if (constraints.length) {
    parts.push(`⚠️ 注意你记录的限制：${constraints.map((c) => c.content).join('；')}——有冲突的动作请直接跳过。`);
  }

  return parts.join('\n');
}

function equipmentText(words: string): string {
  const hit = EQUIPMENT_WORDS.find(([re]) => re.test(words));
  if (!hit) {
    return '拍一张器械照片给我，我可以讲它练什么、怎么用、以及能替代哪些动作。';
  }
  const exs = findExercises({ equipments: [hit[1]], limit: 3 });
  if (!exs.length) return `我暂时没有「${hit[1]}」的动作数据。`;
  return [
    `用${words.replace(/怎么用|如何使用|这是什么|器械|怎么练/g, '') || '这类器械'}可以做的动作：`,
    ...exs.map((e, i) => `${i + 1}. ${e.zh_name || e.name}\n   目标：${TARGET_LABEL[e.target] ?? e.target}\n   要点：${trimZh(e.zh)}`),
    '',
    '想要完整的使用讲解和替代动作，接上视觉模型后可以直接拍器械识别。',
  ].join('\n');
}

const PLAN_WRITE_RE = /(安排|排一?下|排个|加(到|进|入)|放进|写进|计划)/;

function tryPlanWrite(text: string): string | null {
  if (!PLAN_WRITE_RE.test(text)) return null;
  const hit = BODY_PART.find(([re]) => re.test(text));
  if (!hit) return null;

  const mems = listMemories();
  const equipments = equipmentsFromMemory(mems);
  const rules = constraintRulesFor(mems);
  const existing = new Set(getPlan().map((p) => p.exercise_id));
  const exs = pickSafeExercises(hit[1], equipments, rules, 8)
    .filter((e) => !existing.has(e.id))
    .slice(0, 4);

  if (!exs.length) {
    return rules.length && getPlan().length === 0
      ? `按你的伤病/禁忌限制筛完，${hit[2]}暂时没有能安全加进清单的动作了。建议先咨询医生或康复师。`
      : `今天已经排过${hit[2]}的动作了，去「训练」页看看。`;
  }

  const added = exs.map((e) => addPlanItem(e, { sets: 4, reps: 10, restSec: 90 }));
  const lines = added.map((p, i) => `${i + 1}. ${p.name} · 4 组 × 10 次 · 休息 ${p.rest_sec}s`);
  const tips = [
    `已经加进今日训练清单（${hit[2]}）：`,
    ...lines,
    '',
    '去底部「训练」页点开始，就能一组一组记录、自动计时和组间休息。',
  ];
  if (equipments.length) tips.push(`（已按你的器械条件筛选）`);
  const constraints = mems.filter((m) => m.kind === 'constraint');
  if (rules.length) {
    tips.push(`🛡️ 已按你的限制避开${rules.map((r) => r.label).join('、')}（${constraints.map((c) => c.content).join('；')}）。`);
  } else if (constraints.length) {
    tips.push(`⚠️ 记得你的限制：${constraints.map((c) => c.content).join('；')}`);
  }
  return tips.join('\n');
}

function tryLocalIntent(text: string): AssistantReply | null {
  if (!WORKOUT_RE.test(text)) return null;

  const equip = text.match(/器械|史密斯|龙门架|杠铃|哑铃|壶铃|弹力带|单杠/);
  if (equip) {
    const bodyHit = BODY_PART.find(([re]) => re.test(text));
    if (!bodyHit && /器械/.test(text)) {
      return { kind: 'text', text: equipmentText(text) };
    }
  }

  const hit = BODY_PART.find(([re]) => re.test(text));
  if (hit) return { kind: 'text', text: workoutText(hit[1], hit[2]) };

  if (/今天|明天/.test(text) && /练|训练/.test(text)) {
    return {
      kind: 'text',
      text: '今天想练哪个部位？胸 / 背 / 腿 / 肩 / 手臂 / 腹，说一个我就给你排动作。',
    };
  }
  return null;
}

/* ---------------------------- 主入口 ---------------------------- */

function foodCard(raw: RawItem[], mealType: MealType, photoUrl?: string, note?: string): AssistantReply {
  const items = enrichItems(raw);
  const draftId = createDraft({ items, mealType, photoUrl, note });
  return { kind: 'food_card', draftId, mealType, items, photoUrl, note };
}

export async function handleChat(input: { text?: string; imageDataUrl?: string }): Promise<AssistantReply[]> {
  const text = (input.text ?? '').trim();
  const replies: AssistantReply[] = [];
  const candidates = text ? extractMemoryCandidates(text) : [];
  const hasMemory = candidates.length > 0;

  try {
    if (input.imageDataUrl) {
      const photoUrl = savePhoto(input.imageDataUrl);
      const rec = await getProvider().recognize({
        imageDataUrl: input.imageDataUrl,
        text: text || undefined,
        memoryBlock: memoryBlockFor(text),
      });
      if (rec.kind === 'food') {
        replies.push(foodCard(rec.items, rec.mealType ?? currentMealType(TZ), photoUrl, rec.note));
      } else if (rec.kind === 'equipment') {
        replies.push({ kind: 'text', text: equipmentText(rec.name) });
      } else {
        replies.push({ kind: 'text', text: rec.text });
      }
    } else if (text) {
      const planned = tryPlanWrite(text);
      if (planned) {
        replies.push({ kind: 'text', text: planned });
      } else {
      const local = tryLocalIntent(text);
      if (local) {
        replies.push(local);
      } else {
        const rec = await getProvider().recognize({ text, memoryBlock: memoryBlockFor(text) });
        if (rec.kind === 'food') {
          replies.push(foodCard(rec.items, rec.mealType ?? currentMealType(TZ), undefined, rec.note));
        } else if (rec.kind === 'equipment') {
          replies.push({ kind: 'text', text: equipmentText(rec.name) });
        } else {
          replies.push({
            kind: 'text',
            text: hasMemory
              ? '好，这些我记下了。确认下面的条目，我就长期记住 —— 之后排训练、算热量都会避开。'
              : rec.text,
          });
        }
      }
      }
    } else {
      replies.push({ kind: 'text', text: '发一张照片，或者说一句你吃了什么。' });
    }
  } catch (err) {
    replies.push({
      kind: 'text',
      text: `出了点问题：${(err as Error).message}\n\n如果还没配模型，当前演示模式只能识别内置食物库里的东西。`,
    });
  }

  const existing = listMemories();
  const fresh = candidates.filter((c) => {
    const hit = existing.find((m) => m.key === c.key);
    return !hit || hit.content !== c.content;
  });
  if (fresh.length) replies.push({ kind: 'memory_proposal', candidates: fresh });

  return replies;
}
