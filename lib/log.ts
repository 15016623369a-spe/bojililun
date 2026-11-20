/**
 * 「记录」数据层：把饮食 + 训练汇成一条时间线，并支持语音快记、编辑、撤销。
 * 只给服务端（API route / Server Component）用。
 */

import { getDb } from './db';
import { currentMealType, MEAL_LABEL, type MealType } from './date';
import { macrosFor, EMPTY_MACROS } from './nutrition';
import { addDays, periodRange } from './period';
import { daySessions, getSession, getSessionSets, todayStr, volumeStats, type SessionDetail } from './core/workout';
import { getProfileRow, mealsOn } from './core/meals';
import { savePhoto } from './core/chat';
import { getExercise } from './exercise';
import {
  estimateEnergy,
  muscleHeat,
  sanitizeSet,
  type EnergyBreakdown,
  type ExerciseLoad,
  type MuscleHeat,
} from './energy';
import { EQUIPMENT_LABEL } from './exercise-label';
import { parseLog, parseVolume, stripVolume, type VolumeSpec } from './parse-log';
import type { FoodItem, ReviewDay, ReviewPayload, TimelineEntry } from './types';

const TZ = process.env.APP_TZ || 'Asia/Shanghai';

/* ------------------------------ 小工具 ------------------------------ */

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function dayText(date: string): { label: string; weekday: string } {
  const [y, m, d] = date.split('-').map(Number);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return { label: `${m}月${d}日 周${wd}`, weekday: `周${wd}` };
}

const REGION: Record<string, string> = {
  chest: '胸部',
  back: '背部',
  shoulders: '肩部',
  'upper arms': '手臂',
  'lower arms': '前臂',
  'upper legs': '腿部',
  'lower legs': '小腿',
  waist: '核心',
  neck: '颈部',
  cardio: '有氧',
};

export function regionOf(bodyPart: string): string {
  return REGION[bodyPart] ?? '综合';
}

/** 从一句话里猜部位（动作没匹配上时的兜底） */
function guessBodyPart(text: string): string {
  if (/胸|推胸|卧推|飞鸟/.test(text)) return 'chest';
  if (/背|划船|下拉|引体|硬拉/.test(text)) return 'back';
  if (/肩|推举|侧平举|飞鸟/.test(text)) return 'shoulders';
  if (/腿|蹲|腿举|箭步/.test(text)) return 'upper legs';
  if (/臀|髋|臀推/.test(text)) return 'upper legs';
  if (/手臂|二头|三头|弯举|臂屈伸/.test(text)) return 'upper arms';
  if (/核心|腹|卷腹|平板/.test(text)) return 'waist';
  if (/跑|骑|游|有氧|跳绳/.test(text)) return 'cardio';
  return '';
}

/* ------------------------------ 时间线条目 ------------------------------ */

function splitMealTitle(items: FoodItem[]): { title: string; meta: string; names: string[] } {
  const names = items.map((i) => i.name);
  if (names.length === 0) return { title: '一餐', meta: '', names };
  if (names.length === 1) return { title: names[0], meta: `${Math.round(items[0].grams)}g`, names };
  const head = names.slice(0, 2).join(' + ');
  const tail = items
    .slice(2)
    .map((i) => `${i.name} ${Math.round(i.grams)}g`)
    .join('、');
  return { title: head, meta: tail, names };
}

function mealEntry(m: ReturnType<typeof mealsOn>[number]): TimelineEntry {
  const { title, meta } = splitMealTitle(m.items);
  return {
    kind: 'meal',
    id: m.id,
    time: hhmm(m.created_at),
    label: MEAL_LABEL[m.meal_type] ?? '一餐',
    title,
    meta,
    kcal: Math.round(m.kcal),
    items: m.items.map((i) => i.name),
    photo: m.photo_path ?? undefined,
  };
}

function sessionBodyPart(d: SessionDetail): string {
  const counts = new Map<string, number>();
  for (const s of d.sets) {
    if (!s.body_part) continue;
    counts.set(s.body_part, (counts.get(s.body_part) ?? 0) + 1);
  }
  let best = '';
  let n = 0;
  for (const [k, v] of counts) {
    if (v > n) {
      n = v;
      best = k;
    }
  }
  return best;
}

function trainingEntry(d: SessionDetail): TimelineEntry {
  const bodyPart = sessionBodyPart(d) || guessBodyPart(d.session.note ?? '');
  const region = regionOf(bodyPart);
  const exercises: string[] = [];
  for (const g of d.groups) {
    if (!exercises.includes(g.exercise_name)) exercises.push(g.exercise_name);
  }
  let minutes = 0;
  if (d.session.ended_at) {
    const ms = new Date(d.session.ended_at).getTime() - new Date(d.session.started_at).getTime();
    minutes = Math.max(1, Math.round(ms / 60000));
  }
  return {
    kind: 'training',
    id: d.session.id,
    time: hhmm(d.session.started_at),
    label: d.session.ended_at ? '训练' : '训练中',
    title: exercises.length === 0 ? `${region === '综合' ? '' : region}训练` : `${region}训练`,
    exercises,
    minutes,
    region,
    bodyPart,
    note: d.session.note ?? undefined,
    photo: d.session.photo_path ?? undefined,
  };
}

/** 某一天的全部记录（饮食 + 训练），按时间升序 */
export function dayTimeline(date: string): TimelineEntry[] {
  const meals = mealsOn(date).map(mealEntry);
  const trainings = daySessions(date).map(trainingEntry);
  return [...meals, ...trainings].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

/* ------------------------------ 匹配 ------------------------------ */

interface ExerciseLite {
  id: string;
  name: string;
  zh_name: string;
  body_part: string;
  target: string;
}

function allExercises(): ExerciseLite[] {
  return getDb()
    .prepare('SELECT id, name, zh_name, body_part, target FROM exercise')
    .all() as unknown as ExerciseLite[];
}

/** 「肩」「背」「腿」这种词是部位，不是动作名 —— 只当提示用，不进动作列表 */
const BODY_WORDS = new Set([
  '肩', '肩部', '胸', '胸部', '背', '背部', '腿', '腿部', '臀', '臀部',
  '手臂', '前臂', '核心', '腹', '腹肌', '腰', '颈', '有氧', '全身',
]);

export function isBodyWord(token: string): boolean {
  return BODY_WORDS.has(token.trim());
}

function matchExercise(token: string, rows: ExerciseLite[], hintPart = ''): ExerciseLite | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  let best: ExerciseLite | null = null;
  let bestScore = 0;
  for (const r of rows) {
    for (const k of [r.zh_name, r.name]) {
      if (!k) continue;
      const key = k.toLowerCase();
      let score = 0;
      if (key === t) score = 220;
      else if (t.length >= 2 && key.endsWith(t)) score = 170 - key.length * 2;
      else if (t.length >= 2 && key.startsWith(t)) score = 150 - key.length * 2;
      else if (t.length >= 2 && key.includes(t)) score = 130 - key.length * 2;
      else if (t.length >= 2 && t.includes(key) && key.length >= 2) score = 110 - key.length * 2;
      if (score > 0 && hintPart && r.body_part === hintPart) score += 25;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
  }
  return bestScore >= 60 ? best : null;
}

interface FoodRow {
  name: string;
  aliases: string;
  kcal_100g: number;
  protein_100g: number;
  carb_100g: number;
  fat_100g: number;
  default_grams: number;
}

function matchFood(token: string, rows: FoodRow[]): FoodRow | null {
  const t = token.trim();
  if (!t) return null;
  let best: FoodRow | null = null;
  let bestScore = 0;
  for (const r of rows) {
    const keys = [r.name, ...r.aliases.split(',').map((s) => s.trim())].filter(Boolean);
    for (const k of keys) {
      let score = 0;
      if (t === k) score = 100;
      else if (t.includes(k)) score = 60 + k.length * 4;
      else if (k.includes(t) && t.length >= 2) score = 40 + t.length * 4;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
  }
  return bestScore >= 44 ? best : null;
}

/* ------------------------------ 语音快记 ------------------------------ */

export interface QuickLogResult {
  entry: TimelineEntry;
  /** 给界面看的确认文案，例如「背部训练 · 20 分钟」 */
  summary: string;
  matched: number;
}

function addExerciseSets(
  sessionId: number,
  tokens: string[],
  hintPart: string,
  note: string,
  globalSpec: VolumeSpec = {},
): void {
  const db = getDb();
  const rows = allExercises();
  const fallbackPart = hintPart || guessBodyPart(note);
  const seen = new Set<string>();
  let index = 0;

  for (const token of tokens) {
    const spec: VolumeSpec = { ...globalSpec, ...definedOnly(parseVolume(token)) };
    const cleaned = stripVolume(token) || token;
    const hit = matchExercise(cleaned, rows, fallbackPart);
    const name = cleaned;
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const sets = sanitizeSet(spec.sets ?? 1, 'sets');
    const reps = sanitizeSet(spec.reps ?? 0, 'reps');
    const weight = sanitizeSet(spec.weight ?? 0, 'weight');

    for (let i = 0; i < sets; i += 1) {
      index += 1;
      db.prepare(
        `INSERT INTO session_set (session_id, plan_item_id, exercise_id, exercise_name, body_part, target, set_index, weight, reps, duration_sec, rest_sec, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      ).run(
        sessionId,
        hit?.id ?? `quick-${index}`,
        name,
        hit?.body_part ?? fallbackPart,
        hit?.target ?? '',
        index,
        weight,
        reps,
        new Date().toISOString(),
      );
    }
  }
}

/** 只保留有值的字段，方便用「词内的数」覆盖「整句的数」 */
function definedOnly(spec: VolumeSpec): VolumeSpec {
  const out: VolumeSpec = {};
  if (spec.sets !== undefined) out.sets = spec.sets;
  if (spec.reps !== undefined) out.reps = spec.reps;
  if (spec.weight !== undefined) out.weight = spec.weight;
  return out;
}

function quickLogTraining(text: string, minutes: number, tokens: string[], photo?: string): QuickLogResult {
  const db = getDb();
  const hint = guessBodyPart(text) || guessBodyPart(tokens.join('、'));
  const names = tokens.filter((t) => !isBodyWord(t));
  const globalSpec = parseVolume(text);

  // 没说时长时，按「组数」粗估一次训练多长（每组约 2.5 分钟，含休息）
  if (!minutes) {
    const totalSets = names.reduce((a, t) => {
      const s = { ...globalSpec, ...definedOnly(parseVolume(t)) };
      return a + Math.min(20, Math.max(1, Math.round(s.sets ?? 1)));
    }, 0);
    minutes = Math.min(90, Math.max(15, Math.round(totalSets * 2.5) + 5));
  }
  const now = new Date();
  const ended = now.toISOString();
  const started = new Date(now.getTime() - minutes * 60000).toISOString();
  db.prepare('INSERT INTO session (date, started_at, ended_at, note, photo_path) VALUES (?, ?, ?, ?, ?)').run(
    todayStr(),
    started,
    ended,
    text,
    photo ?? null,
  );
  const id = (db.prepare('SELECT id FROM session ORDER BY id DESC LIMIT 1').get() as { id: number }).id;
  addExerciseSets(id, names, hint, text, globalSpec);

  const detail = daySessions(todayStr()).find((d) => d.session.id === id);
  const entry = detail
    ? trainingEntry(detail)
    : ({
        kind: 'training',
        id,
        time: hhmm(started),
        label: '训练',
        title: '训练',
        exercises: tokens,
        minutes,
        region: '综合',
        bodyPart: '',
      } as TimelineEntry);
  return {
    entry,
    summary: entry.kind === 'training' ? `${entry.title} · ${minutes} 分钟` : '已记录',
    matched: entry.kind === 'training' ? entry.exercises.length : 0,
  };
}

function quickLogMeal(
  text: string,
  mealType: MealType | null,
  tokens: string[],
  photo?: string,
  preset?: FoodItem[],
): QuickLogResult {
  const db = getDb();
  const rows = db
    .prepare('SELECT name, aliases, kcal_100g, protein_100g, carb_100g, fat_100g, default_grams FROM food_cache')
    .all() as unknown as FoodRow[];

  const names = tokens.length ? tokens : [text];
  const items: FoodItem[] = [];
  let total = { ...EMPTY_MACROS };

  // 问答浮层点「记入今天」时会把算好的那份营养一起带过来，避免再匹配一次导致数字对不上
  if (preset && preset.length) {
    for (const p of preset) {
      const grams = Math.min(2000, Math.max(1, Math.round(Number(p.grams) || 100)));
      const item: FoodItem = {
        name: String(p.name || '食物'),
        grams,
        kcal_100g: Number(p.kcal_100g) || 0,
        protein_100g: Number(p.protein_100g) || 0,
        carb_100g: Number(p.carb_100g) || 0,
        fat_100g: Number(p.fat_100g) || 0,
        matched: Boolean(p.matched),
      };
      const m = macrosFor(grams, {
        kcal: item.kcal_100g,
        protein: item.protein_100g,
        carb: item.carb_100g,
        fat: item.fat_100g,
      });
      total = {
        kcal: total.kcal + m.kcal,
        protein: Math.round((total.protein + m.protein) * 10) / 10,
        carb: Math.round((total.carb + m.carb) * 10) / 10,
        fat: Math.round((total.fat + m.fat) * 10) / 10,
      };
      items.push(item);
    }
  }

  for (const name of preset && preset.length ? [] : names) {
    const hit = matchFood(name, rows);
    const grams = hit ? hit.default_grams : 100;
    const item: FoodItem = {
      name,
      grams,
      kcal_100g: hit?.kcal_100g ?? 0,
      protein_100g: hit?.protein_100g ?? 0,
      carb_100g: hit?.carb_100g ?? 0,
      fat_100g: hit?.fat_100g ?? 0,
      matched: Boolean(hit),
    };
    const m = macrosFor(grams, {
      kcal: item.kcal_100g,
      protein: item.protein_100g,
      carb: item.carb_100g,
      fat: item.fat_100g,
    });
    total = {
      kcal: total.kcal + m.kcal,
      protein: Math.round((total.protein + m.protein) * 10) / 10,
      carb: Math.round((total.carb + m.carb) * 10) / 10,
      fat: Math.round((total.fat + m.fat) * 10) / 10,
    };
    items.push(item);
  }

  const type: MealType = mealType ?? currentMealType(TZ);
  db.prepare(
    `INSERT INTO meal_log (date, meal_type, photo_path, items_json, kcal, protein, carb, fat, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    todayStr(),
    type,
    photo ?? null,
    JSON.stringify(items),
    total.kcal,
    total.protein,
    total.carb,
    total.fat,
    new Date().toISOString(),
  );

  const id = (db.prepare('SELECT id FROM meal_log ORDER BY id DESC LIMIT 1').get() as { id: number }).id;
  const saved = mealsOn(todayStr()).find((m) => m.id === id);
  const entry: TimelineEntry = saved
    ? mealEntry(saved)
    : { kind: 'meal', id, time: hhmm(new Date().toISOString()), label: '一餐', title: text, meta: '', kcal: 0, items: names };

  return {
    entry,
    summary: entry.kind === 'meal' ? `${entry.label} · ${entry.title}` : '已记录',
    matched: items.filter((i) => i.matched).length,
  };
}

export function quickLog(text: string, photoDataUrl?: string, preset?: FoodItem[]): QuickLogResult {
  const photo = photoDataUrl ? savePhoto(photoDataUrl) : undefined;
  const parsed = parseLog(text);
  if (parsed.kind === 'training') return quickLogTraining(text, parsed.minutes, parsed.tokens, photo);
  return quickLogMeal(text, parsed.mealType, parsed.tokens, photo, preset);
}

/* ------------------------------ 编辑 / 撤销 ------------------------------ */

export function deleteTraining(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM session_set WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM session WHERE id = ?').run(id);
}

export function editTraining(id: number, patch: { minutes?: number; exercises?: string[] }): TimelineEntry {
  const db = getDb();
  const session = getSession(id);
  if (!session) throw new Error('这条记录已经不在了');

  const minutes = Math.min(600, Math.max(1, Math.round(Number(patch.minutes) || 0) || 1));
  const endedAt = session.ended_at ? new Date(session.ended_at) : new Date();
  const startedAt = new Date(endedAt.getTime() - minutes * 60000);
  db.prepare('UPDATE session SET started_at = ?, ended_at = ? WHERE id = ?').run(
    startedAt.toISOString(),
    endedAt.toISOString(),
    id,
  );

  if (Array.isArray(patch.exercises)) {
    db.prepare('DELETE FROM session_set WHERE session_id = ?').run(id);
    addExerciseSets(id, patch.exercises.filter((x) => !isBodyWord(x)), guessBodyPart(session.note ?? ''), session.note ?? '');
  }

  const detail = daySessions(session.date).find((d) => d.session.id === id);
  if (!detail) throw new Error('保存失败');
  return trainingEntry(detail);
}

export function deleteMeal(id: number): void {
  getDb().prepare('DELETE FROM meal_log WHERE id = ?').run(id);
}

export function editMeal(id: number, names: string[]): TimelineEntry {
  const db = getDb();
  const row = db.prepare('SELECT * FROM meal_log WHERE id = ?').get(id) as
    | { date: string; meal_type: string; items_json: string }
    | undefined;
  if (!row) throw new Error('这条记录已经不在了');

  const prev = JSON.parse(row.items_json) as FoodItem[];
  const rows = db
    .prepare('SELECT name, aliases, kcal_100g, protein_100g, carb_100g, fat_100g, default_grams FROM food_cache')
    .all() as unknown as FoodRow[];

  const items: FoodItem[] = names.map((name) => {
    const old = prev.find((p) => p.name === name);
    if (old) return old;
    const hit = matchFood(name, rows);
    return {
      name,
      grams: hit ? hit.default_grams : 100,
      kcal_100g: hit?.kcal_100g ?? 0,
      protein_100g: hit?.protein_100g ?? 0,
      carb_100g: hit?.carb_100g ?? 0,
      fat_100g: hit?.fat_100g ?? 0,
      matched: Boolean(hit),
    };
  });

  let total = { ...EMPTY_MACROS };
  for (const it of items) {
    const m = macrosFor(it.grams, {
      kcal: it.kcal_100g,
      protein: it.protein_100g,
      carb: it.carb_100g,
      fat: it.fat_100g,
    });
    total = {
      kcal: total.kcal + m.kcal,
      protein: Math.round((total.protein + m.protein) * 10) / 10,
      carb: Math.round((total.carb + m.carb) * 10) / 10,
      fat: Math.round((total.fat + m.fat) * 10) / 10,
    };
  }

  db.prepare('UPDATE meal_log SET items_json = ?, kcal = ?, protein = ?, carb = ?, fat = ? WHERE id = ?').run(
    JSON.stringify(items),
    total.kcal,
    total.protein,
    total.carb,
    total.fat,
    id,
  );

  const saved = mealsOn(row.date).find((m) => m.id === id);
  if (!saved) throw new Error('保存失败');
  return mealEntry(saved);
}

/* ------------------------------ 回顾 ------------------------------ */

export type ReviewPeriod = 'day' | 'week' | 'month';

export function reviewData(period: ReviewPeriod, date = todayStr()): ReviewPayload {
  let start = date;
  let end = date;
  if (period === 'week') {
    const r = periodRange('week', date);
    start = r.start;
    end = r.end;
  } else if (period === 'month') {
    const r = periodRange('month', date);
    start = r.start;
    end = r.end;
  }

  let label: string;
  if (period === 'day') {
    label = dayText(date).label;
  } else if (period === 'week') {
    const a = dayText(start);
    const b = dayText(end);
    label = `${a.label.split(' 周')[0]} — ${b.label.split(' 周')[0]}`;
  } else {
    const [y, m] = start.split('-').map(Number);
    label = `${y}年${m}月`;
  }

  // 这段时间里练到的部位（去重，按容量排序）
  const parts = getDb()
    .prepare(
      `SELECT s.body_part AS body_part, COALESCE(SUM(s.weight * s.reps), 0) AS volume, COUNT(*) AS sets
       FROM session_set s JOIN session se ON se.id = s.session_id
       WHERE se.date BETWEEN ? AND ? AND s.body_part != ''
       GROUP BY s.body_part ORDER BY sets DESC`,
    )
    .all(start, end) as unknown as Array<{ body_part: string; volume: number; sets: number }>;

  const days: ReviewDay[] = [];
  for (let d = end; d >= start; d = addDays(d, -1)) {
    const entries = dayTimeline(d);
    if (entries.length === 0) continue;
    const t = dayText(d);
    days.push({ date: d, label: t.label, weekday: t.weekday, entries });
    if (days.length >= 40) break;
  }

  return { start, end, label, bodyParts: parts.map((p) => p.body_part), days };
}

export { todayStr };


/* ------------------------------ 单次训练详情 ------------------------------ */

export interface DetailExercise extends ExerciseLoad {
  key: string;
  exerciseId: string;
  image: string;
  equipmentLabel: string;
  volume: number;
  kcal: number;
}

export interface TrainingDetail {
  id: number;
  date: string;
  time: string;
  label: string;
  minutes: number;
  note?: string;
  region: string;
  exercises: DetailExercise[];
  heat: MuscleHeat[];
  energy: EnergyBreakdown;
  bodyWeightKg: number;
  profileMissing: boolean;
  photo?: string;
}

/** 一次训练的「解剖图 + 热区 + 热量」所需的全部数据 */
export function trainingDetail(id: number): TrainingDetail | null {
  const session = getSession(id);
  if (!session) return null;

  const rows = getSessionSets(id);
  const profile = getProfileRow();
  const bodyWeightKg = profile?.weight_kg && profile.weight_kg > 0 ? profile.weight_kg : 70;

  const grouped = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.exercise_id || r.exercise_name;
    const list = grouped.get(key) ?? [];
    list.push(r);
    grouped.set(key, list);
  }

  const exercises: DetailExercise[] = [];
  for (const [key, list] of grouped) {
    const first = list[0];
    const meta = /^quick-/.test(key) ? null : getExercise(key);
    const sets = list.length;
    const reps = list.reduce((m, r) => Math.max(m, r.reps), 0);
    const weight = list.reduce((m, r) => Math.max(m, r.weight), 0);
    let secondary: string[] = [];
    try {
      const parsed = JSON.parse(meta?.secondary_muscles || '[]');
      if (Array.isArray(parsed)) secondary = parsed.map(String);
    } catch {
      secondary = [];
    }

    exercises.push({
      key,
      exerciseId: key,
      name: first.exercise_name,
      bodyPart: first.body_part || meta?.body_part || '',
      target: meta?.target || first.target || '',
      secondary,
      equipment: meta?.equipment || 'body weight',
      equipmentLabel: EQUIPMENT_LABEL[meta?.equipment ?? ''] ?? '自重',
      image: meta?.image ?? '',
      sets,
      reps,
      weight,
      volume: Math.round(sets * reps * weight),
      kcal: 0,
    });
  }

  const minutes =
    session.ended_at && session.started_at
      ? Math.max(1, Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60000))
      : 1;

  const energy = estimateEnergy(exercises, minutes, bodyWeightKg);

  // 每个动作单独估算，时长按组数占比摊
  const totalSets = exercises.reduce((a, e) => a + Math.max(1, e.sets), 0) || 1;
  for (const e of exercises) {
    const share = Math.max(1, e.sets) / totalSets;
    e.kcal = estimateEnergy([e], Math.max(1, minutes * share), bodyWeightKg).kcal;
  }

  const region = regionOf(sessionBodyPart({ session, sets: rows, groups: [] }));

  return {
    id,
    date: session.date,
    time: hhmm(session.started_at),
    label: dayText(session.date).label,
    minutes,
    note: session.note ?? undefined,
    region,
    exercises,
    heat: muscleHeat(exercises, bodyWeightKg),
    energy,
    bodyWeightKg: Math.round(bodyWeightKg),
    profileMissing: !profile,
    photo: session.photo_path ?? undefined,
  };
}

/** 详情页保存：用「组数 × 次数 × 重量」重写这次训练的所有组 */
export function replaceSets(
  sessionId: number,
  items: Array<{
    exerciseId?: string;
    name: string;
    bodyPart?: string;
    target?: string;
    sets: number;
    reps: number;
    weight: number;
  }>,
): void {
  const db = getDb();
  const session = getSession(sessionId);
  if (!session) throw new Error('这条记录已经不在了');

  db.prepare('DELETE FROM session_set WHERE session_id = ?').run(sessionId);
  let index = 0;
  for (const it of items) {
    const sets = sanitizeSet(it.sets, 'sets');
    const reps = sanitizeSet(it.reps ?? 0, 'reps');
    const weight = sanitizeSet(it.weight ?? 0, 'weight');
    const meta = it.exerciseId && !/^quick-/.test(it.exerciseId) ? getExercise(it.exerciseId) : null;
    for (let i = 0; i < sets; i += 1) {
      index += 1;
      db.prepare(
        `INSERT INTO session_set (session_id, plan_item_id, exercise_id, exercise_name, body_part, target, set_index, weight, reps, duration_sec, rest_sec, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      ).run(
        sessionId,
        it.exerciseId ?? `quick-${index}`,
        String(it.name || '').slice(0, 60),
        it.bodyPart ?? meta?.body_part ?? '',
        it.target ?? meta?.target ?? '',
        index,
        weight,
        reps,
        new Date().toISOString(),
      );
    }
  }
}


/* ------------------------------ 身体页 / 回顾页的聚合 ------------------------------ */

/** 今天练过的肌群 → 3D 图上点亮的强度（0~1） */
export function todayMuscles(date = todayStr()): Array<{ id: string; level: number }> {
  const details = daySessions(date);
  const exercises: ExerciseLoad[] = [];

  for (const d of details) {
    for (const g of d.groups) {
      const meta = g.exercise_id && !g.exercise_id.startsWith('quick-') ? getExercise(g.exercise_id) : null;
      let secondary: string[] = [];
      try {
        const parsed = JSON.parse(meta?.secondary_muscles || '[]');
        if (Array.isArray(parsed)) secondary = parsed.map(String);
      } catch {
        secondary = [];
      }
      exercises.push({
        name: g.exercise_name,
        bodyPart: g.body_part,
        target: meta?.target || g.sets[0]?.target || '',
        secondary,
        equipment: meta?.equipment || 'body weight',
        sets: g.sets.length,
        reps: g.sets.reduce((m, x) => Math.max(m, x.reps), 0),
        weight: g.sets.reduce((m, x) => Math.max(m, x.weight), 0),
      });
    }
  }

  if (exercises.length === 0) return [];
  const bw = getProfileRow()?.weight_kg || 70;
  return muscleHeat(exercises, bw)
    .filter((m) => m.level > 0.02)
    .map((m) => ({ id: m.id, level: m.level }));
}

export interface ReviewOverview {
  days: number;
  sessions: number;
  meals: number;
  sets: number;
  volume: number;
  minutes: number;
  parts: Array<{ part: string; label: string; count: number }>;
  week: Array<{ date: string; dow: string; label: string; has: boolean; today: boolean; training: boolean }> | null;
}

/** 回顾页顶部的轻量概览：几天、几次、几餐 + 部位标签 + 一周小圆点 */
export function reviewOverview(period: ReviewPeriod, date = todayStr()): ReviewOverview {
  let start = date;
  let end = date;
  if (period === 'week') {
    const r = periodRange('week', date);
    start = r.start;
    end = r.end;
  } else if (period === 'month') {
    const r = periodRange('month', date);
    start = r.start;
    end = r.end;
  }

  const vol = volumeStats(start, end);
  let sessions = 0;
  let meals = 0;
  const daysWith: string[] = [];
  const partCount = new Map<string, number>();
  const dayFlag = new Map<string, { training: boolean; meal: boolean }>();

  for (let d = start; d <= end; d = addDays(d, 1)) {
    const entries = dayTimeline(d);
    if (entries.length === 0) continue;
    daysWith.push(d);
    const flag = { training: false, meal: false };
    for (const e of entries) {
      if (e.kind === 'training') {
        sessions += 1;
        flag.training = true;
        const key = e.bodyPart || '';
        if (key) partCount.set(key, (partCount.get(key) ?? 0) + 1);
      } else {
        meals += 1;
        flag.meal = true;
      }
    }
    dayFlag.set(d, flag);
  }

  let week: ReviewOverview['week'] = null;
  if (period === 'week') {
    const DOW = ['一', '二', '三', '四', '五', '六', '日'];
    week = [];
    let i = 0;
    for (let d = start; d <= end; d = addDays(d, 1), i += 1) {
      const flag = dayFlag.get(d);
      week.push({
        date: d,
        dow: DOW[i] ?? '',
        label: String(Number(d.slice(8, 10))),
        has: Boolean(flag),
        today: d === todayStr(),
        training: Boolean(flag?.training),
      });
    }
  }

  const parts = [...partCount.entries()]
    .map(([part, count]) => ({ part, label: regionOf(part).replace(/部$/, ''), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    days: daysWith.length,
    sessions,
    meals,
    sets: vol.sets,
    volume: vol.volume,
    minutes: vol.durationMin,
    parts,
    week,
  };
}
