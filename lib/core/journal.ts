import { getDb } from '../db';
import { DEFAULT_TZ, MEAL_LABEL } from '../date';
import { getExercise } from '../exercise';
import { canonicalExercise, coreOf, prefixOf, rootOf, spokenExercisePhrase } from '../exercise-words';
import { JOURNAL_MEAL_LABELS, mealNutritionLabel, mentionedMuscles, negatedMuscles, type JournalEntry, type QuickPayload } from '../journal';
import { MUSCLES, muscleMatchesExercise, type MuscleId, type Region } from '../muscles';
import { macrosFor } from '../nutrition';
import { addDays } from '../period';
import { estimateQuickMealItem, looksLikeMeal, numOf, parseQuickPayload, readQuickPayload } from '../quick-parse';
import { fixSpeechText } from '../speech-fix';
import type { MealRecord, PlanItem, SessionRow } from '../types';
import { savePhoto } from './chat';
import { mealsOn } from './meals';
import { addSet, appendSessionSet, daySessions, getPlan, getPlanProgress, getSession, markPlanDone, nowIso, todayStr, type SessionDetail } from './workout';

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: process.env.APP_TZ || DEFAULT_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

interface QuickRow {
  id: number;
  date: string;
  kind: JournalEntry['kind'];
  title: string;
  detail: string;
  source_text: string;
  merged_session_id: number | null;
  payload_json: string | null;
  created_at: string;
}

export interface ExerciseOption {
  id: string;
  name: string;
  zh_name: string;
  equipment: string;
  target: string;
  image: string;
}

export interface TrainingConflictTarget {
  ordinal: number;
  planItemId: number | null;
  sessionId: number | null;
  exerciseId: string;
  exerciseName: string;
}

export interface TrainingConflict {
  planned: Region[];
  actual: Region[];
  mode: 'region' | 'exercise';
  target?: TrainingConflictTarget;
  options?: ExerciseOption[];
  spokenExercise?: string;
}

export class TrainingConflictError extends Error {
  constructor(public conflict: TrainingConflict) {
    super(conflict.mode === 'exercise' && conflict.target
      ? `今天的第${conflict.target.ordinal}个动作是「${conflict.target.exerciseName}」，语音里识别到「${conflict.spokenExercise}」，请确认是否替换动作`
      : `今天的计划或记录包含${conflict.planned.join('、')}，语音里识别到${conflict.actual.join('、')}，请确认实际训练部位`);
    this.name = 'TrainingConflictError';
  }
}

function exerciseMuscles(exerciseId: string, exerciseName: string): MuscleId[] {
  const exercise = getExercise(exerciseId);
  return exercise ? MUSCLES.filter((muscle) => muscleMatchesExercise(muscle, exercise)).map((muscle) => muscle.id)
    : mentionedMuscles(exerciseName);
}

function regionsOf(muscles: Iterable<MuscleId>): Region[] {
  const ids = new Set(muscles);
  return [...new Set(MUSCLES.filter((muscle) => ids.has(muscle.id)).map((muscle) => muscle.region))];
}

export function planMuscles(plan: PlanItem[]): MuscleId[] {
  return [...new Set(plan.flatMap((item) => exerciseMuscles(item.exercise_id, item.name)))];
}

function plannedMuscles(date: string): Set<MuscleId> {
  const muscles = new Set(planMuscles(getPlan(date)));
  for (const { groups } of daySessions(date)) {
    for (const group of groups) {
      for (const muscle of exerciseMuscles(group.exercise_id, group.exercise_name)) muscles.add(muscle);
    }
  }
  return muscles;
}

/** 计划动作与语音动作是否一致：包含关系、或同核心名且器械不冲突。 */
function sameExercise(targetName: string, phrase: string): boolean {
  if (targetName.includes(phrase) || phrase.includes(targetName)) return true;
  if (coreOf(targetName) !== coreOf(phrase)) return false;
  const targetPrefix = prefixOf(targetName);
  const spokenPrefix = prefixOf(phrase);
  return !(targetPrefix && spokenPrefix && targetPrefix !== spokenPrefix);
}

const CN_NUMERAL: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function ordinalIn(source: string): number | undefined {
  // 量词容忍识别 garble（第三组→第三主/第三种），以及省略量词的「第三动作」
  const match = source.match(/第([一二两三四五六七八九十\d]+)(?:个|项|组|主|种)(?:动作|练习|主动)?/)
    ?? source.match(/第([一二两三四五六七八九十\d]+)(?:动作|练习)/);
  if (!match) return undefined;
  const raw = match[1];
  return /^\d+$/.test(raw) ? Number(raw) : CN_NUMERAL[raw];
}

function exerciseTarget(source: string, date: string): TrainingConflictTarget | undefined {
  const plan = getPlan(date);
  const sessions = daySessions(date);
  const names = plan.length ? plan.map((item) => item.name) : (sessions[0]?.groups.map((group) => group.exercise_name) ?? []);
  const ordinal = ordinalIn(source);
  let index = (ordinal ?? 1) - 1;
  if (ordinal === undefined) {
    // 没报序号时：先找与语音一致的动作槽（无需修改），否则定位同动作家族的槽位。
    const spoken = spokenExercisePhrase(source);
    const phrase = spoken ? canonicalExercise(spoken) : undefined;
    if (phrase && names.length) {
      const exact = names.findIndex((name) => sameExercise(name, phrase));
      const family = exact >= 0 ? exact : names.findIndex((name) => rootOf(name) === rootOf(phrase));
      index = family >= 0 ? family : 0;
    }
  }
  const planItem = plan[index];
  let session: SessionRow | undefined;
  let group: SessionDetail['groups'][number] | undefined;
  if (planItem) {
    for (const detail of sessions) {
      const found = detail.groups.find((entry) => entry.exercise_id === planItem.exercise_id);
      if (found) {
        session = detail.session;
        group = found;
        break;
      }
    }
  } else {
    session = sessions[0]?.session;
    group = sessions[0]?.groups[index];
  }
  const exerciseId = planItem?.exercise_id ?? group?.exercise_id;
  const exerciseName = planItem?.name ?? group?.exercise_name;
  if (!exerciseId || !exerciseName) return undefined;
  return { ordinal: index + 1, planItemId: planItem?.id ?? null, sessionId: session?.id ?? null, exerciseId, exerciseName };
}

function exerciseOptions(term: string): ExerciseOption[] {
  const rows = getDb().prepare(`
    SELECT id, name, zh_name, equipment, target, image FROM exercise
    WHERE zh_name LIKE ? OR name LIKE ? OR target LIKE ?
    ORDER BY CASE WHEN zh_name = ? THEN 0 ELSE 1 END,
      CASE equipment WHEN 'barbell' THEN 0 WHEN 'dumbbell' THEN 1 WHEN 'cable' THEN 2
      WHEN 'leverage machine' THEN 3 WHEN 'smith machine' THEN 4 WHEN 'body weight' THEN 5 ELSE 9 END,
      length(zh_name) ASC LIMIT 8
  `).all(`%${term}%`, `%${term}%`, `%${term}%`, term) as unknown as ExerciseOption[];
  return rows.map((row) => ({ ...row }));
}

/** 替换意图动词：用户说「换成/改成…」时，即使动作库没有匹配也要弹出确认（可搜索选择）。 */
const REPLACE_VERB = /换成|换为|改成|改为|替换成|替换为|换了/;

function replacementSpan(source: string): string | undefined {
  const match = source.match(/(?:换成|换为|改成|改为|替换成|替换为|换了)(?:了|成)?([^，,。！？!?、；;：:\s]{2,12})/);
  return match?.[1];
}

function findExerciseConflict(source: string, date: string): TrainingConflict | undefined {
  const intent = REPLACE_VERB.test(source);
  let phrase = spokenExercisePhrase(source);
  if (!phrase && intent) phrase = replacementSpan(source);
  if (!phrase) return undefined;
  const canonical = canonicalExercise(phrase);
  const target = exerciseTarget(source, date);
  if (!target || sameExercise(target.exerciseName, canonical)) return undefined;
  let options = exerciseOptions(canonical);
  if (!options.length && canonical !== phrase) options = exerciseOptions(phrase);
  if (!options.length) options = exerciseOptions(coreOf(canonical));
  if (!options.length) options = exerciseOptions(rootOf(canonical));
  if (!options.length && !intent) return undefined;
  return {
    mode: 'exercise',
    planned: regionsOf(exerciseMuscles(target.exerciseId, target.exerciseName)),
    actual: regionsOf(mentionedMuscles(source)),
    target,
    options,
    spokenExercise: phrase,
  };
}

export function findTrainingConflict(source: string, date: string): TrainingConflict | undefined {
  const exerciseConflict = findExerciseConflict(source, date);
  if (exerciseConflict) return exerciseConflict;
  const planned = regionsOf(plannedMuscles(date));
  const actualMuscles = mentionedMuscles(source);
  const actual = regionsOf(actualMuscles);
  if (!planned.length || !actual.length) return undefined;
  const negated = new Set(regionsOf(negatedMuscles(source)));
  const unexpected = actual.some((region) => !planned.includes(region));
  const rejected = planned.some((region) => negated.has(region));
  return unexpected || rejected ? { mode: 'region', planned, actual } : undefined;
}

/** 用户确认后，把计划/训练里的某个动作替换成实际做的动作，保留组数、重量与计时。 */
function replaceExercise(date: string, target: TrainingConflictTarget, exerciseId: string): number | null {
  const exercise = getExercise(exerciseId);
  if (!exercise) throw new Error('替换的动作不存在');
  const db = getDb();
  const name = exercise.zh_name || exercise.name;
  if (target.planItemId !== null) {
    db.prepare('UPDATE plan_item SET exercise_id = ?, name = ?, body_part = ?, target = ?, equipment = ? WHERE id = ? AND date = ?')
      .run(exercise.id, name, exercise.body_part, exercise.target, exercise.equipment, target.planItemId, date);
  }
  if (target.sessionId !== null) {
    db.prepare('UPDATE session_set SET exercise_id = ?, exercise_name = ?, body_part = ?, target = ? WHERE session_id = ? AND (plan_item_id = ? OR exercise_id = ?)')
      .run(exercise.id, name, exercise.body_part, exercise.target, target.sessionId, target.planItemId, target.exerciseId);
    const session = db.prepare('SELECT plan_json FROM session WHERE id = ?').get(target.sessionId) as { plan_json: string | null } | undefined;
    if (session?.plan_json) {
      const plan = JSON.parse(session.plan_json) as PlanItem[];
      const updated = plan.map((item) => (item.id === target.planItemId || item.exercise_id === target.exerciseId)
        ? { ...item, exercise_id: exercise.id, name, body_part: exercise.body_part, target: exercise.target, equipment: exercise.equipment }
        : item);
      db.prepare('UPDATE session SET plan_json = ? WHERE id = ?').run(JSON.stringify(updated), target.sessionId);
    }
  }
  return target.sessionId;
}

/** 用户明确确认后，才以实际部位替换今天不相符的计划和训练记录。 */
function replaceConflictingTraining(date: string, actualMuscles: MuscleId[]) {
  const db = getDb();
  const actual = new Set(regionsOf(actualMuscles));
  let planItems = 0;
  let sessions = 0;
  let quickEntries = 0;

  for (const item of getPlan(date)) {
    const regions = regionsOf(exerciseMuscles(item.exercise_id, item.name));
    if (regions.length && !regions.some((region) => actual.has(region))) {
      db.prepare('DELETE FROM plan_item WHERE id = ?').run(item.id);
      planItems += 1;
    }
  }

  for (const { session, groups } of daySessions(date)) {
    let changed = false;
    for (const group of groups) {
      const regions = regionsOf(exerciseMuscles(group.exercise_id, group.exercise_name));
      if (regions.length && !regions.some((region) => actual.has(region))) {
        db.prepare('DELETE FROM session_set WHERE session_id = ? AND exercise_id = ?').run(session.id, group.exercise_id);
        changed = true;
      }
    }
    if (changed) {
      sessions += 1;
      const remaining = db.prepare('SELECT COUNT(*) AS count FROM session_set WHERE session_id = ?').get(session.id) as { count: number };
      if (!remaining.count) db.prepare('DELETE FROM session WHERE id = ?').run(session.id);
    }
  }

  const quick = db.prepare("SELECT id, detail FROM journal_entry WHERE date = ? AND kind = 'training'").all(date) as unknown as Array<{ id: number; detail: string }>;
  for (const entry of quick) {
    const regions = regionsOf(mentionedMuscles(entry.detail));
    if (regions.length && !regions.some((region) => actual.has(region))) {
      db.prepare('DELETE FROM journal_entry WHERE id = ?').run(entry.id);
      quickEntries += 1;
    }
  }
  return { planItems, sessions, quickEntries };
}

function inferQuickEntry(source: string, date: string) {
  const meal = source.match(/早餐|早上|早饭|午餐|中午|午饭|晚餐|晚上|晚饭|夜宵|加餐/);
  const ate = /吃|喝|午餐|午饭|晚餐|晚饭|早[餐饭]|夜宵|加餐/.test(source);
  const training = /训练|练了|练完|练(?:个|一下|下)?[背胸肩腿臀腹]|健身|卧推|深蹲|下拉|划船|跑[步了]|做了.{0,8}(组|分钟)|骑[车了]|游[泳了]/.test(source)
    || /第[一二两三四五六七八九十\d]+(?:个|项|组)(?:动作|练习)/.test(source)
    || Boolean(spokenExercisePhrase(source));
  const sleep = /睡眠|睡觉|睡了|入睡|失眠|熬夜|午睡|小憩|补觉|睡醒|醒来/.test(source);
  const dateOffset = /前天/.test(source) ? -2 : /昨天|昨晚/.test(source) ? -1 : 0;
  const entryDate = addDays(date, dateOffset);
  const detail = source.replace(/^(?:帮我)?(?:记录一下|记一下|记录|记一笔)[：:，,\s]*/, '')
    .replace(/^(?:前天|昨天|今天)\s*/, '').replace(/^[\s，,：:]+|[。！!]+$/g, '');
  if (ate || (!training && !sleep && looksLikeMeal(detail))) {
    const title = /早/.test(meal?.[0] ?? '') ? '早餐'
      : /午/.test(meal?.[0] ?? '') ? '午餐'
        : /晚/.test(meal?.[0] ?? '') || /昨晚/.test(source) ? '晚餐'
          : meal ? '加餐' : '饮食';
    return { date: entryDate, kind: 'meal' as const, title, detail: detail.replace(/^(?:早餐|早上|早饭|午餐|中午|午饭|晚餐|晚上|晚饭|昨晚|夜宵|加餐)(?:吃了?|喝了?)?[：:，,\s]*/, '') || detail };
  }
  if (sleep) return { date: entryDate, kind: 'sleep' as const, title: '睡眠', detail };
  if (training) return { date: entryDate, kind: 'training' as const, title: '训练', detail };
  // 不符合饮食/训练/睡眠范式的自由内容也允许记录，不再拒绝输入
  return { date: entryDate, kind: 'note' as const, title: '记录', detail };
}

function serializeQuick(row: QuickRow): JournalEntry {
  const payload = readQuickPayload(row);
  let title = row.title;
  // 饮食分量可编辑：为每行食物带上回写来源（语音记录 id + 行号）
  if (payload.kind === 'meal' && payload.items?.length) {
    payload.items = payload.items.map((item, index) => ({ ...item, src: { kind: 'quick', quickId: row.id, index } }));
    const labels = new Set(payload.items.map((item) => item.meal ?? payload.mealType ?? row.title));
    if (labels.size === 1) title = [...labels][0];
  }
  return {
    id: `quick-${row.id}`, quickId: row.id, date: row.date, kind: row.kind, title,
    detail: row.detail, source: row.source_text,
    time: timeFormatter.format(new Date(row.created_at)),
    meta: payload.kind === 'meal' ? mealNutritionLabel([payload]) : undefined,
    muscles: row.kind === 'training' ? mentionedMuscles(row.detail) : [],
    payload,
  };
}

/** 拍照/对话确认餐的标准化 payload：分量以克数呈现，编辑回写 meal_log 并重算热量 */
export function mealLogPayload(meal: MealRecord): QuickPayload {
  return {
    kind: 'meal',
    mealType: MEAL_LABEL[meal.meal_type],
    items: meal.items.map((item, index) => ({
      name: item.name,
      amount: `${item.grams} g`,
      grams: item.grams,
      nutrition: item.matched || item.kcal_100g || item.protein_100g || item.carb_100g || item.fat_100g
        ? macrosFor(item.grams, {
          kcal: item.kcal_100g, protein: item.protein_100g, carb: item.carb_100g, fat: item.fat_100g,
        }) : undefined,
      src: { kind: 'meal', mealId: meal.id, index },
    })),
  };
}

/** 修改语音饮食记录中的单行食物并重算营养 */
export function updateQuickMealItem(quickId: number, index: number, changes: {
  amount: string;
  name?: string;
  meal?: string;
  preparation?: string;
  manualKcal?: number | null;
  photoData?: string;
  removePhoto?: boolean;
}): JournalEntry {
  const db = getDb();
  const row = db.prepare('SELECT * FROM journal_entry WHERE id = ?').get(quickId) as QuickRow | undefined;
  if (!row || row.kind !== 'meal') throw new Error('记录不存在');
  const value = changes.amount.trim();
  if (!value || value.length > 30) throw new Error('分量不能为空，且不超过 30 个字');
  const foodName = changes.name?.trim();
  if (foodName !== undefined && (!foodName || foodName.length > 100)) throw new Error('食物名称需要 1 至 100 个字');
  const payload = readQuickPayload(row);
  if (!payload.items?.[index]) throw new Error('记录不存在');
  const item = payload.items[index];
  const { meal, manualKcal } = changes;
  if (meal !== undefined && !JOURNAL_MEAL_LABELS.some((label) => label === meal)) throw new Error('请选择餐次');
  const preparation = changes.preparation?.trim();
  if (preparation && preparation.length > 120) throw new Error('做法或备注请控制在 120 个字以内');
  if (manualKcal != null && (!Number.isSafeInteger(manualKcal) || manualKcal < 0)) {
    throw new Error('热量需要填写非负整数');
  }
  const updated = estimateQuickMealItem({ ...item, name: foodName ?? item.name, amount: value });
  if (meal !== undefined) updated.meal = meal;
  if (preparation !== undefined) updated.preparation = preparation || undefined;
  if (manualKcal !== undefined) updated.manualKcal = manualKcal ?? undefined;
  if (changes.removePhoto) updated.photoUrl = undefined;
  if (changes.photoData) updated.photoUrl = savePhoto(changes.photoData);
  payload.items[index] = updated;
  const payloadJson = JSON.stringify(payload);
  db.prepare('UPDATE journal_entry SET payload_json = ? WHERE id = ?').run(payloadJson, quickId);
  return serializeQuick({ ...row, payload_json: payloadJson });
}

export interface TrainingMutationPreview {
  intent: 'correction' | 'completion';
  date: string;
  sessionId: number | null;
  planItemId: number | null;
  exerciseId: string;
  exerciseName: string;
  beforeSets: number;
  afterSets: number;
  clearDayTraining?: boolean;
}

/** Read the current DB state and prepare a preview; this never mutates journal/workout rows. */
export function prepareTrainingMutation(raw: string, intent: 'correction' | 'completion', targetCardId?: string): TrainingMutationPreview {
  const source = fixSpeechText(raw.trim());
  const parsed = inferQuickEntry(source, todayStr());
  let date = parsed.date;
  if (!targetCardId && /(实际没练|其实没练|今天没练|今天没有训练|实际没有训练|没进行训练)/.test(source)) {
    const sessions = daySessions(date).filter(({ sets }) => sets.length > 0);
    return { intent, date, sessionId: null, planItemId: null, exerciseId: '',
      exerciseName: '今日全部训练记录', beforeSets: sessions.reduce((sum, row) => sum + row.sets.length, 0),
      afterSets: 0, clearDayTraining: true };
  }
  const explicit = source.match(/(\d+|[一二两三四五六七八九十]+)\s*组/);
  const requested = explicit ? numOf(explicit[1]) : undefined;
  if (intent === 'correction' && requested === undefined) throw new Error('请说清要改成几组，例如「杠铃站姿转体应该是三组」');
  if (requested !== undefined && (requested < 1 || requested > 20)) throw new Error('组数需要在 1 至 20 之间');

  let target: TrainingConflictTarget | undefined;
  if (targetCardId?.startsWith('session-')) {
    const sessionId = Number(targetCardId.slice(8));
    const targetedSession = getSession(sessionId);
    if (!targetedSession) throw new Error('这条训练卡片已不存在');
    date = targetedSession.date;
    const card = daySessions(date).find(({ session }) => session.id === sessionId);
    if (!card) throw new Error('这条训练卡片已不存在或日期不匹配');
    const phrase = spokenExercisePhrase(source);
    const candidates = phrase ? card.groups.filter((group) => sameExercise(group.exercise_name, canonicalExercise(phrase))) : card.groups;
    const group = candidates.length === 1 ? candidates[0] : card.groups.length === 1 ? card.groups[0] : undefined;
    if (!group) throw new Error('这张卡片里有多个动作，请从动作明细中直接修改目标动作');
    target = { ordinal: 1, planItemId: group.sets[0]?.plan_item_id ?? null, sessionId, exerciseId: group.exercise_id, exerciseName: group.exercise_name };
  } else {
    target = exerciseTarget(source, date);
  }
  if (!target) throw new Error('没有找到可修改的今日训练动作');
  const details = daySessions(date);
  const group = details.find(({ session }) => session.id === target!.sessionId)?.groups.find(({ exercise_id }) => exercise_id === target!.exerciseId);
  const planItem = getPlan(date).find(({ id }) => id === target!.planItemId)
    ?? getPlan(date).find(({ exercise_id }) => exercise_id === target!.exerciseId);
  const beforeSets = group?.sets.length ?? 0;
  const afterSets = requested ?? Math.max(beforeSets, planItem?.sets ?? 0);
  if (afterSets < 1) throw new Error('还没有找到已完成组数；请在卡片编辑里明确修改，或说出完成的组数');
  return { intent, date, sessionId: target.sessionId, planItemId: planItem?.id ?? target.planItemId,
    exerciseId: target.exerciseId, exerciseName: target.exerciseName, beforeSets, afterSets };
}

/** Apply only after explicit user confirmation, and reject previews if DB state changed. */
export function applyTrainingMutation(preview: TrainingMutationPreview): JournalEntry {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (preview.clearDayTraining) {
      const currentSets = daySessions(preview.date).reduce((sum, row) => sum + row.sets.length, 0);
      if (currentSets !== preview.beforeSets) throw new Error('训练记录刚刚发生变化，请重新识别并确认');
      db.prepare('DELETE FROM session_set WHERE session_id IN (SELECT id FROM session WHERE date = ?)').run(preview.date);
      db.prepare('DELETE FROM session WHERE date = ?').run(preview.date);
      db.prepare("DELETE FROM journal_entry WHERE date = ? AND kind = 'training'").run(preview.date);
      db.exec('COMMIT');
      return { id: `session-cleared-${preview.date}`, date: preview.date, kind: 'training', title: '训练记录已更正',
        detail: '已移除今日训练记录', time: '', source: '', quickId: null } as unknown as JournalEntry;
    }
    const details = daySessions(preview.date);
    let session = preview.sessionId ? details.find(({ session: row }) => row.id === preview.sessionId) : undefined;
    let group = session?.groups.find(({ exercise_id }) => exercise_id === preview.exerciseId);
    const current = group?.sets.length ?? 0;
    if (current !== preview.beforeSets) throw new Error('训练记录刚刚发生变化，请重新识别并确认');
    let sessionId = session?.session.id;
    if (!sessionId && preview.afterSets > 0) {
      const now = nowIso();
      const result = db.prepare('INSERT INTO session (date, started_at, ended_at) VALUES (?, ?, ?)').run(preview.date, now, now);
      sessionId = Number(result.lastInsertRowid);
      session = undefined;
    }
    if (sessionId && group) {
      const ordered = [...group.sets].sort((a, b) => a.set_index - b.set_index || a.id - b.id);
      for (const set of ordered.slice(preview.afterSets)) db.prepare('DELETE FROM session_set WHERE id = ?').run(set.id);
      if (preview.afterSets < ordered.length) {
        const remaining = ordered.slice(0, preview.afterSets);
        remaining.forEach((set, index) => db.prepare('UPDATE session_set SET set_index = ? WHERE id = ?').run(index + 1, set.id));
      }
      for (let i = ordered.length; i < preview.afterSets; i++) appendSessionSet(sessionId, preview.exerciseId, {});
    } else if (sessionId && preview.planItemId) {
      const plan = getPlan(preview.date).find(({ id }) => id === preview.planItemId);
      if (!plan) throw new Error('对应计划已不存在，请重新确认');
      for (let i = 0; i < preview.afterSets; i++) addSet(sessionId, { planItemId: plan.id, exerciseId: plan.exercise_id,
        exerciseName: plan.name, bodyPart: plan.body_part, target: plan.target, setIndex: i + 1,
        weight: plan.weight, reps: plan.reps, durationSec: 0, restSec: plan.rest_sec });
    }
    if (preview.intent === 'completion' && preview.planItemId) markPlanDone(preview.planItemId);
    const entry = recordedJournalForDate(preview.date).find((item) => item.id === `session-${sessionId}`);
    if (!entry) throw new Error('训练变更已处理，但记录卡暂时无法读取');
    db.exec('COMMIT');
    return entry;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function writeQuickEntry(raw: string, requestId: string, id?: number, resolution?: 'actual', replacementExerciseId?: string) {
  // 语音转写先做领域纠错（练个熊→练个胸 等），再分类入库
  const source = fixSpeechText(raw.trim());
  if (!source || source.length > 1000) throw new Error('记录需要 1 至 1000 个字');
  const db = getDb();
  if (id !== undefined) {
    const row = db.prepare('SELECT * FROM journal_entry WHERE id = ?').get(id) as QuickRow | undefined;
    if (!row) throw new Error('这条记录已不存在');
    const changedDate = /前天|昨天|今天|昨晚/.test(source);
    const parsed = inferQuickEntry(source, todayStr());
    const payload = parseQuickPayload(source, parsed.kind, parsed.detail, parsed.title);
    if (payload.items && row.kind === 'meal') {
      const previous = readQuickPayload(row).items ?? [];
      if (source === row.source_text) {
        payload.items = previous;
      } else {
        // 原话编辑可能改变顺序。只在能对上菜名时保留照片和备注。
        const unused = [...previous];
        payload.items = payload.items.map((item) => {
          const matches = unused.filter((old) => old.name === item.name);
          const old = matches.find((candidate) => candidate.amount === item.amount)
            ?? (matches.length === 1 ? matches[0] : undefined);
          if (!old) return item;
          unused.splice(unused.indexOf(old), 1);
          return { ...item, preparation: old.preparation, photoUrl: old.photoUrl,
            manualKcal: old.amount === item.amount ? old.manualKcal : undefined };
        });
      }
    }
    db.prepare('UPDATE journal_entry SET date = ?, kind = ?, title = ?, detail = ?, source_text = ?, payload_json = ? WHERE id = ?')
      .run(changedDate ? parsed.date : row.date, parsed.kind, parsed.title, parsed.detail, source,
        JSON.stringify(payload), id);
    return serializeQuick(db.prepare('SELECT * FROM journal_entry WHERE id = ?').get(id) as unknown as QuickRow);
  }

  const parsed = inferQuickEntry(source, todayStr());
  if (parsed.kind === 'training' && resolution !== 'actual') {
    const conflict = findTrainingConflict(source, parsed.date);
    if (conflict) throw new TrainingConflictError(conflict);
  }

  const insert = (mergedSessionId: number | null = null) => {
    db.prepare(`INSERT INTO journal_entry (request_id, date, kind, title, detail, source_text, merged_session_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING`)
      .run(requestId, parsed.date, parsed.kind, parsed.title, parsed.detail, source, mergedSessionId,
        JSON.stringify(parseQuickPayload(source, parsed.kind, parsed.detail, parsed.title)), nowIso());
    return serializeQuick(db.prepare('SELECT * FROM journal_entry WHERE request_id = ?').get(requestId) as unknown as QuickRow);
  };

  if (parsed.kind === 'training' && resolution === 'actual') {
    db.exec('BEGIN IMMEDIATE');
    try {
      // 用户已确认实际训练：当天原有语音补充记录全部删除，只保留最终训练表格
      db.prepare("DELETE FROM journal_entry WHERE date = ? AND kind = 'training'").run(parsed.date);
      let mergedSessionId: number | null = null;
      if (replacementExerciseId) {
        const target = exerciseTarget(source, parsed.date);
        if (!target) throw new Error('未找到要替换的动作，请刷新后重试');
        mergedSessionId = replaceExercise(parsed.date, target, replacementExerciseId);
      } else {
        const conflict = findTrainingConflict(source, parsed.date);
        if (conflict?.mode === 'exercise') throw new TrainingConflictError(conflict);
        replaceConflictingTraining(parsed.date, mentionedMuscles(source));
        mergedSessionId = daySessions(parsed.date).find((detail) => detail.sets.length > 0)?.session.id ?? null;
      }
      // 同一句话在旧版本中已直接保存时，确认后替换它，而不是再新增一条重复记录。
      db.prepare('DELETE FROM journal_entry WHERE date = ? AND source_text = ?').run(parsed.date, source);
      const entry = insert(mergedSessionId);
      db.exec('COMMIT');
      return entry;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return insert();
}

export function undoQuickEntry(id: number) {
  getDb().prepare('DELETE FROM journal_entry WHERE id = ?').run(id);
}

export function journalMarkers(start: string, end: string) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT date, kind, count(*) AS count
    FROM (
      SELECT date, kind FROM journal_entry
      WHERE date BETWEEN $start AND $end AND kind = 'meal' AND merged_session_id IS NULL
      UNION ALL
      SELECT date, 'meal' FROM meal_log WHERE date BETWEEN $start AND $end
      UNION ALL
      SELECT date, 'training' FROM session
      WHERE date BETWEEN $start AND $end AND ended_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM session_set WHERE session_id = session.id)
    )
    GROUP BY date, kind
  `).all({ $start: start, $end: end }) as Array<{ date: string; kind: 'training' | 'meal'; count: number }>;
  const quickTraining = db.prepare(`
    SELECT * FROM journal_entry
    WHERE date BETWEEN ? AND ? AND kind = 'training' AND merged_session_id IS NULL
  `).all(start, end) as unknown as QuickRow[];
  const byDate = new Map<string, { training: number; meal: number }>();
  for (const { date, kind, count } of rows) {
    const markers = byDate.get(date) ?? { training: 0, meal: 0 };
    markers[kind] = count;
    byDate.set(date, markers);
  }
  for (const row of quickTraining) {
    if (readQuickPayload(row).planned) continue;
    const markers = byDate.get(row.date) ?? { training: 0, meal: 0 };
    markers.training += 1;
    byDate.set(row.date, markers);
  }
  return byDate;
}

export function recordedJournalForDate(date: string): JournalEntry[] {
  return journalForDate(date).filter((entry) => entry.kind !== 'training' || !entry.payload?.planned);
}

export function journalForDate(date: string): JournalEntry[] {
  const quick = (getDb().prepare('SELECT * FROM journal_entry WHERE date = ?').all(date) as unknown as QuickRow[])
    .filter((row) => row.merged_session_id === null);
  const entries = quick.map((row) => ({ at: row.created_at, entry: serializeQuick(row) }));
  for (const meal of mealsOn(date)) {
    const payload = mealLogPayload(meal);
    entries.push({ at: meal.created_at, entry: {
      id: `meal-${meal.id}`, date, kind: 'meal', title: MEAL_LABEL[meal.meal_type],
      detail: meal.items.map((item) => `${item.name} ${item.grams} g`).join('、'),
      meta: mealNutritionLabel([payload]), time: timeFormatter.format(new Date(meal.created_at)),
      payload,
    } });
  }
  for (const { session, sets, groups } of daySessions(date)) {
    if (!session.ended_at || !sets.length) continue;
    const duration = Math.max(0, Math.round((Date.parse(session.ended_at) - Date.parse(session.started_at)) / 1000));
    const muscles = new Set(groups.flatMap((group) => {
      const exercise = getExercise(group.exercise_id);
      return exercise ? MUSCLES.filter((muscle) => muscleMatchesExercise(muscle, exercise)).map((muscle) => muscle.id)
        : mentionedMuscles(group.exercise_name);
    }));
    const regions = [...new Set(MUSCLES.filter((muscle) => muscles.has(muscle.id)).map((muscle) => muscle.region))];
    const region = regions[0];
    const title = regions.length !== 1 ? '力量训练' : ['手臂', '核心'].includes(region) ? region + '训练' : region + '部训练';
    const exercises = groups.map((group) => {
      const reps = group.sets.map((set) => set.reps).filter((value) => value > 0).join('/');
      const weights = [...new Set(group.sets.map((set) => set.weight).filter((value) => value > 0))];
      const seconds = group.sets.reduce((total, set) => total + (set.duration_sec || 0), 0);
      return {
        name: group.exercise_name,
        sets: group.sets.length,
        reps: reps || undefined,
        weight: weights.length ? `${weights.join('/')} kg` : undefined,
        duration: seconds > 0 ? (seconds < 60 ? `${seconds} 秒` : `${Math.round(seconds / 60)} 分钟`) : undefined,
      };
    });
    entries.push({ at: session.ended_at, entry: {
      id: `session-${session.id}`, date, kind: 'training',
      title,
      detail: groups.map((group) => group.exercise_name).join('、'),
      meta: `共 ${sets.length} 组 · ${duration < 60 ? duration + ' 秒' : Math.round(duration / 60) + ' 分钟'}`,
      note: session.note ?? undefined,
      time: timeFormatter.format(new Date(session.ended_at)),
      muscles: [...muscles], href: `/history/${date}#session-${session.id}`,
      payload: { kind: 'training', exercises, regions },
    } });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at)).map(({ entry }) => entry);
}
