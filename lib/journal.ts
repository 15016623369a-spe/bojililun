import type { MuscleId } from './muscles';

/** 部位 → 训练名称：背部训练 / 手臂训练 / 核心训练 */
export function regionTrainingName(region: string): string {
  return ['手臂', '核心'].includes(region) ? `${region}训练` : `${region}部训练`;
}

/** 标准化训练行：动作 + 组数/次数/重量/用时，语音与详细训练共用同一表格结构 */
export interface TrainingExerciseRow {
  name: string;
  sets?: number;
  reps?: string;
  weight?: string;
  duration?: string;
}

/** 饮食分量的编辑来源：语音记录改 payload，拍照/对话餐改 meal_log 克数 */
export type MealItemSource =
  | { kind: 'quick'; quickId: number; index: number }
  | { kind: 'meal'; mealId: number; index: number };

/** 语音记录的结构化 JSON：前端只渲染这份 payload，不展示原话 */
export interface QuickPayload {
  kind: 'meal' | 'training' | 'sleep' | 'note';
  planned?: boolean;
  regions?: string[];
  exercises?: TrainingExerciseRow[];
  items?: Array<{ name: string; amount: string; meal?: string; planned?: boolean; grams?: number; src?: MealItemSource }>;
  mealType?: string;
  sleep?: { duration?: string; bedtime?: string; wake?: string; quality?: string };
  summary?: string;
}

export interface JournalEntry {
  id: string;
  quickId?: number;
  /** 记录时间（ISO）：饮食时间线按它排序，界面不直接展示 */
  createdAt?: string;
  kind: 'meal' | 'training' | 'sleep' | 'note';
  date: string;
  title: string;
  detail: string;
  meta?: string;
  source?: string;
  time?: string;
  muscles?: MuscleId[];
  href?: string;
  payload?: QuickPayload;
}

const MUSCLE_CUES: [RegExp, MuscleId][] = [
  [/上胸|上斜.*推/, 'chest_upper'], [/练(?:了|的是|个|一下|下)?胸|卧推|夹胸|俯卧撑/, 'chest_mid'],
  [/高位下拉|练(?:了|的是|个|一下|下)?背|引体/, 'lats'], [/划船|上背/, 'upperback'],
  [/侧平举|练(?:了|的是|个|一下|下)?肩/, 'delt_side'], [/深蹲|腿举|练(?:了|的是|个|一下|下)?腿/, 'quads'],
  [/臀桥|臀推|练(?:了|的是|个|一下|下)?臀/, 'glutes'], [/卷腹|练(?:了|的是|个|一下|下)?腹/, 'abs'],
  [/二头|弯举/, 'biceps'], [/三头|下压|臂屈伸/, 'triceps'],
];

const NEGATED_TRAINING = /(?:实际上|其实)?(?:没有|没|并未|不是|不|未)(?:去)?(?:练|做)(?:了|的是|个|一下|下)?[背胸肩腿臀腹](?:了)?/g;

function musclesIn(text: string): MuscleId[] {
  return MUSCLE_CUES.filter(([pattern]) => pattern.test(text)).map(([, muscle]) => muscle);
}

/** 实际训练部位：排除「没练胸」「不是练腿」等否定内容。 */
export function mentionedMuscles(text: string): MuscleId[] {
  return musclesIn(text.replace(NEGATED_TRAINING, ''));
}

/** 被明确否定的部位，用于发现语音与训练计划之间的冲突。 */
export function negatedMuscles(text: string): MuscleId[] {
  return musclesIn((text.match(NEGATED_TRAINING) ?? []).join(' '));
}

/** 动作行是否带有实际记录的数据（组数/次数/重量/用时）；纯名称提及不进入训练表格 */
export function hasRecordedData(row: TrainingExerciseRow): boolean {
  return row.sets !== undefined || Boolean(row.reps) || Boolean(row.weight) || Boolean(row.duration);
}

/** 无数据行时的标准化摘要：去重后的动作/部位名称，而非原话 */
export function trainingSummary(payload: QuickPayload): string | undefined {
  if (payload.summary) return payload.summary;
  const names = [...new Set([
    ...(payload.exercises ?? []).map((exercise) => exercise.name),
    ...(payload.regions ?? []).map(regionTrainingName),
  ])].filter(Boolean);
  return names.length ? names.join('、') : undefined;
}

/** 同一天只呈现一条整合后的饮食记录：各餐语音/记录合并成同一张标准化表格，保留餐次与计划标记。 */
export function consolidateMealEntries(entries: JournalEntry[], date: string): JournalEntry[] {
  if (entries.length <= 1) return entries;
  const items = entries.flatMap((entry) => (entry.payload?.items ?? []).map((item) => ({
    ...item,
    meal: item.meal ?? entry.payload?.mealType ?? entry.title,
    planned: item.planned ?? entry.payload?.planned ?? undefined,
  })));
  if (!items.length) return entries;
  const meals = [...new Set(items.map((item) => item.meal).filter((meal): meal is string => Boolean(meal) && meal !== '饮食'))];
  const meta = [...meals, `共 ${items.length} 项`].join(' · ');
  const time = entries.map((entry) => entry.time).filter(Boolean).sort().at(-1);
  const planned = entries.every((entry) => entry.payload?.planned) || undefined;
  return [{
    id: `meal-${date}`,
    kind: 'meal',
    date,
    title: '饮食记录',
    detail: items.map((item) => item.name).join('、'),
    meta,
    href: `/history/${date}`,
    time,
    payload: { kind: 'meal', items, planned },
  }];
}

/** 同一天只呈现一条整合后的训练记录：表格只保留有实际记录数据的行，不保留原话。 */
export function consolidateTrainingEntries(entries: JournalEntry[], date: string): JournalEntry[] {
  if (entries.length <= 1) return entries;
  const sessions = entries.filter((entry) => entry.id.startsWith('session-'));
  const quick = entries.filter((entry) => entry.quickId !== undefined);
  const muscles = [...new Set(entries.flatMap((entry) => entry.muscles ?? []))];
  const mentioned = [
    ...sessions.flatMap((entry) => entry.payload?.exercises ?? []),
    ...quick.flatMap((entry) => entry.payload?.exercises ?? []),
  ];
  const exercises = mentioned.filter(hasRecordedData);
  const regions = [...new Set(entries.flatMap((entry) => entry.payload?.regions ?? []))];
  const summary = exercises.length ? undefined : trainingSummary({ kind: 'training', exercises: mentioned, regions });
  const detail = exercises.map((exercise) => exercise.name).join('、') || summary || '';
  const meta = [
    ...sessions.map((entry) => entry.meta).filter(Boolean),
    !sessions.length && quick.length ? `${quick.length} 项语音记录` : '',
  ].filter(Boolean).join(' · ');
  const time = entries.map((entry) => entry.time).filter(Boolean).sort().at(-1);
  const planned = entries.every((entry) => entry.payload?.planned) || undefined;
  return [{
    id: `training-${date}`,
    kind: 'training',
    date,
    title: '训练记录',
    detail,
    meta: meta || undefined,
    muscles,
    href: `/history/${date}`,
    time,
    payload: { kind: 'training', exercises, regions, planned, summary },
  }];
}
