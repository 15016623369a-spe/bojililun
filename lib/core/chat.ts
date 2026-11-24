import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR, getDb } from '../db';
import { getProvider } from '../ai';
import { enrichItems } from './enrich';
import { currentMealType, MEAL_LABEL, type MealType } from '../date';
import { buildMemoryBlock, extractMemoryCandidates, getAlwaysOnMemories, listMemories, searchMemories } from '../memory';
import { findExercises, getExercise, sortForPlan, type ExerciseRow } from '../exercise';
import { getExercisePreferences } from './exercise-preferences';
import { mentionedExercises } from '../ledger-parse';
import foods from '../../data/food-reference.json';
import { EQUIPMENT_LABEL, TARGET_LABEL } from '../exercise-label';
import { addPlanItem, getPlan } from './workout';
import { getTrainingProfile } from './training-profile';
import { TRAINING_GOALS } from '../training-goals';
import { constraintRulesFor, type ConstraintRule } from '../exercise-constraints';
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
  const goal = getTrainingProfile().goal;
  return [goal ? `当前训练目标：${TRAINING_GOALS[goal]}` : '', buildMemoryBlock([...always, ...relevant])].filter(Boolean).join('\n');
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

function filterByConstraints(exs: ExerciseRow[], rules: ConstraintRule[]): ExerciseRow[] {
  if (!rules.length) return exs;
  return exs.filter((e) => {
    const text = `${e.name} ${e.zh_name}`;
    return !rules.some((r) => r.exclude.test(text));
  });
}

/** 有约束时扩大候选池，过滤后仍尽量凑够 4 个动作 */
function pickSafeExercises(bodyPart: string, equipments: string[], rules: ConstraintRule[], want: number) {
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

/**
 * 按部位挑动作进今日计划的候选：常练和常见动作在前（与动作库同一排序），
 * 跳过不喜欢的、已在今日计划里的，以及伤病限制要避开的动作；记过器械条件时只用这些器械。
 */
function planCandidates(bodyPart: string, want: number) {
  const mems = listMemories();
  const equipments = equipmentsFromMemory(mems);
  const rules = constraintRulesFor(mems);
  const preferences = getExercisePreferences();
  const existing = new Set(getPlan().map((p) => p.exercise_id));
  const pool = findExercises({ bodyPart, equipments: equipments.length ? equipments : undefined, limit: 5000 })
    .filter((e) => preferences.get(e.id) !== 'disliked' && !existing.has(e.id));
  return { exs: filterByConstraints(sortForPlan(pool, preferences), rules).slice(0, want), equipments, rules, mems };
}

function tryPlanWrite(text: string): string | null {
  if (!PLAN_WRITE_RE.test(text)) return null;
  const hit = BODY_PART.find(([re]) => re.test(text));
  if (!hit) return null;

  const { exs, equipments, rules, mems } = planCandidates(hit[1], 4);

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

/* ------------------------- 按住「记录」说话排今日计划 ------------------------- */

const OTHER_DAY = /明天|后天|下次|下周|周[一二三四五六日天]|星期|礼拜/;
/** 「给我排四个动作」「安排一下」；「排了」是在说已经做过的事，「排骨」「鸡腿排」是吃的 */
const ARRANGE = /安排(?!了)|(?:给我|帮我|再)排|排(?:一下|[0-9一二两三四五六几]*个)/;
/** 「再加一个飞鸟」「加两个胸的动作」「把卧推加到计划里」 */
const ADD = /(?:再加|加)(?!了|重|餐)(?:[0-9一二两三四五六几]*个|到|进|入)/;
/** 说了组数、次数或重量，是在记录已经练完的训练，不是排计划 */
const RECORDED = /[0-9一二两三四五六七八九十]+\s*(?:组|次)|\d+(?:\.\d+)?\s*(?:kg|公斤)/i;
const COUNT: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 几: 4 };

export type SpeechPlan = { message: string; added: string[] };

/**
 * 记录页和底部「记录」长按说的话里，排今日计划的那几种说法。不需要 AI：
 * - 点名动作：「再加一个飞鸟」「给我排个卧推」→ 把这个动作加进今日计划；
 * - 按部位：「今天练胸，给我排四个动作」「再加两个背的动作」→ 按常练、常见动作挑几个加进去。
 * 不是排计划的话返回 null，照常进手账记录。
 */
export function planFromSpeech(text: string): SpeechPlan | null {
  const t = text.trim();
  if (!t || OTHER_DAY.test(t) || RECORDED.test(t)) return null;
  // 说的是吃的（「再加一个鸡腿」里也有「腿」），照常记饮食
  if (/吃|喝|饭|餐/.test(t) || foods.some((f) => t.includes(f.food_name))) return null;
  const verb = t.match(ADD) ?? t.match(ARRANGE);
  if (!verb) return null;

  const named = mentionedExercises(t)[0];
  if (named) {
    const row = named.dict?.legacy_id
      ? getExercise(named.dict.legacy_id)
      : (getDb().prepare('SELECT * FROM exercise WHERE zh_name = ? LIMIT 1').get(named.name) as unknown as ExerciseRow | undefined) ?? null;
    if (!row) return { message: `动作库里没找到「${named.name}」，可以在训练页从动作库添加`, added: [] };
    const name = named.dict?.name_zh ?? row.zh_name ?? row.name;
    if (getPlan().some((p) => p.exercise_id === row.id)) return { message: `${name}已经在今日计划里了`, added: [] };
    const item = addPlanItem({ ...row, zh_name: name }, { sets: 4, reps: 10, restSec: 90 });
    return { message: `已加进今日训练：${item.name} · ${item.sets} 组 × ${item.reps} 次`, added: [item.name] };
  }

  const hit = BODY_PART.find(([re]) => re.test(t));
  if (!hit) return null;
  const n = verb[0].match(/([0-9]+|[一二两三四五六几])个/)?.[1];
  const want = Math.min(6, Math.max(1, n ? Number(n) || COUNT[n] || 4 : 4));
  const { exs, rules } = planCandidates(hit[1], want);
  if (!exs.length) {
    return {
      message: rules.length ? `按你的伤病限制筛完，${hit[2]}没有能安全加进计划的动作了` : `今天已经排过${hit[2]}的这些动作了`,
      added: [],
    };
  }
  const added = exs.map((e) => addPlanItem(e, { sets: 4, reps: 10, restSec: 90 }).name);
  return { message: `已加进今日训练（${hit[2]}）：${added.join('、')}`, added };
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
