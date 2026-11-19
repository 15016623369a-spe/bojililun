import { getDb } from '../db';
import { DEFAULT_TZ, MEAL_LABEL } from '../date';
import { getExercise } from '../exercise';
import { canonicalExercise, coreOf, prefixOf, rootOf, spokenExercisePhrase } from '../exercise-words';
import { mentionedMuscles, negatedMuscles, type JournalEntry, type QuickPayload } from '../journal';
import { MUSCLES, muscleMatchesExercise, type MuscleId, type Region } from '../muscles';
import { addDays } from '../period';
import { parseQuickPayload } from '../quick-parse';
import { fixSpeechText } from '../speech-fix';
import type { MealRecord, PlanItem, SessionRow } from '../types';
import { mealsOn } from './meals';
import { daySessions, getPlan, nowIso, todayStr, type SessionDetail } from './workout';

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

function plannedMuscles(date: string): Set<MuscleId> {
  const muscles = new Set<MuscleId>();
  for (const item of getPlan(date)) {
    for (const muscle of exerciseMuscles(item.exercise_id, item.name)) muscles.add(muscle);
  }
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
    .replace(/^(?:前天|昨天|今天)(?=\S)/, '').replace(/^[\s，,：:]+|[。！!]+$/g, '');
  if (ate) {
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

function payloadOf(row: QuickRow): QuickPayload {
  if (row.payload_json) {
    try { return JSON.parse(row.payload_json) as QuickPayload; } catch { /* 损坏时重新解析 */ }
  }
  return parseQuickPayload(row.source_text, row.kind, row.detail, row.title);
}

function serializeQuick(row: QuickRow): JournalEntry {
  const payload = payloadOf(row);
  // 饮食分量可编辑：为每行食物带上回写来源（语音记录 id + 行号）
  if (payload.kind === 'meal' && payload.items?.length) {
    payload.items = payload.items.map((item, index) => ({ ...item, src: { kind: 'quick', quickId: row.id, index } }));
  }
  return {
    id: `quick-${row.id}`, quickId: row.id, date: row.date, kind: row.kind, title: row.title,
    detail: row.detail, source: row.source_text, createdAt: row.created_at,
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
      src: { kind: 'meal', mealId: meal.id, index },
    })),
  };
}

/** 修改语音饮食记录某一行食物的分量（标准化 payload，不改原话） */
export function updateQuickMealAmount(quickId: number, index: number, amount: string): string {
  const db = getDb();
  const row = db.prepare('SELECT * FROM journal_entry WHERE id = ?').get(quickId) as QuickRow | undefined;
  if (!row || row.kind !== 'meal') throw new Error('记录不存在');
  const value = amount.trim();
  if (!value || value.length > 30) throw new Error('分量不能为空，且不超过 30 个字');
  const payload = payloadOf(row);
  const item = payload.items?.[index];
  if (!item) throw new Error('记录不存在');
  item.amount = value;
  db.prepare('UPDATE journal_entry SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), quickId);
  return value;
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
    db.prepare('UPDATE journal_entry SET date = ?, kind = ?, title = ?, detail = ?, source_text = ?, payload_json = ? WHERE id = ?')
      .run(changedDate ? parsed.date : row.date, parsed.kind, parsed.title, parsed.detail, source,
        JSON.stringify(parseQuickPayload(source, parsed.kind, parsed.detail, parsed.title)), id);
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
  const rows = getDb().prepare(`
    SELECT date, kind, count(*) AS count
    FROM (
      SELECT date, kind FROM journal_entry WHERE date BETWEEN $start AND $end AND merged_session_id IS NULL
      UNION ALL
      SELECT date, 'meal' FROM meal_log WHERE date BETWEEN $start AND $end
      UNION ALL
      SELECT date, 'training' FROM session
      WHERE date BETWEEN $start AND $end AND ended_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM session_set WHERE session_id = session.id)
    )
    GROUP BY date, kind
  `).all({ $start: start, $end: end }) as Array<{ date: string; kind: JournalEntry['kind']; count: number }>;
  const byDate = new Map<string, { training: number; meal: number }>();
  for (const { date, kind, count } of rows) {
    if (kind !== 'training' && kind !== 'meal') continue; // 睡眠和普通笔记不参与训练/饮食标记
    const markers = byDate.get(date) ?? { training: 0, meal: 0 };
    markers[kind] = count;
    byDate.set(date, markers);
  }
  return byDate;
}

export function journalForDate(date: string): JournalEntry[] {
  const quick = (getDb().prepare('SELECT * FROM journal_entry WHERE date = ?').all(date) as unknown as QuickRow[])
    .filter((row) => row.merged_session_id === null);
  const entries = quick.map((row) => ({ at: row.created_at, entry: serializeQuick(row) }));
  for (const meal of mealsOn(date)) {
    entries.push({ at: meal.created_at, entry: {
      id: `meal-${meal.id}`, date, kind: 'meal', title: MEAL_LABEL[meal.meal_type],
      detail: meal.items.map((item) => `${item.name} ${item.grams} g`).join('、'),
      meta: meal.kcal > 0 ? `约 ${meal.kcal} kcal` : undefined,
      payload: mealLogPayload(meal),
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
      time: timeFormatter.format(new Date(session.ended_at)),
      muscles: [...muscles], href: `/history/${date}#session-${session.id}`,
      payload: { kind: 'training', exercises, regions },
    } });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at)).map(({ entry }) => entry);
}
