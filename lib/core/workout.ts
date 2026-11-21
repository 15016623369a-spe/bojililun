import { getDb } from '../db';
import { DEFAULT_TZ, todayKey } from '../date';
import { idsForTarget } from '../energy';
import { mentionedMuscles } from '../journal';
import { MUSCLES, muscleMatchesExercise, type MuscleId } from '../muscles';
import type { ExerciseRow } from '../exercise';
import type {
  ExercisePerformance,
  MuscleStat,
  PlanItem,
  SessionRow,
  SetRow,
  TrendPoint,
  VolumeStats,
} from '../types';

export const WORKOUT_TIME_ZONE = process.env.APP_TZ || DEFAULT_TZ;

/** node:sqlite 返回的是 null 原型对象，传给 Client Component 前必须转成普通对象 */
function plain<T extends object>(row: T): T {
  return { ...row };
}
function plainAll<T extends object>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r }));
}

export function todayStr(): string {
  return todayKey(WORKOUT_TIME_ZONE);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------ 今日清单 ------------------------------ */

export function getPlan(date = todayStr()): PlanItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM plan_item WHERE date = ? ORDER BY position ASC, id ASC')
    .all(date) as unknown as PlanItem[];
  return plainAll(rows);
}

/** 按仍然保留的实练组数计算计划进度。 */
export function getPlanProgress(date: string): PlanItem[] {
  const completed = getDb().prepare(
    `SELECT ss.plan_item_id AS id, COUNT(*) AS sets
     FROM session_set ss JOIN session s ON s.id = ss.session_id
     WHERE s.date = ? AND ss.plan_item_id IS NOT NULL
     GROUP BY ss.plan_item_id`,
  ).all(date) as { id: number; sets: number }[];
  const setsByItem = new Map(completed.map(({ id, sets }) => [id, sets]));
  return getPlan(date).map((item) => ({
    ...item,
    done: item.done || (setsByItem.get(item.id) ?? 0) >= item.sets ? 1 : 0,
  }));
}

/** 用户确认按今天的计划练完。已记录的组保留，只补齐剩余组数。 */
export function completePlannedExercise(id: number): void {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const date = todayStr();
    const item = getPlan(date).find((entry) => entry.id === id);
    if (!item) throw new Error('今日计划里已没有这个动作');
    const already = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(MAX(ss.set_index), 0) AS last
      FROM session_set ss JOIN session s ON s.id = ss.session_id
      WHERE ss.plan_item_id = ? AND s.date = ?
    `).get(id, date) as { count: number; last: number };
    if (already.count < item.sets) {
      if (activeTraining()) throw new Error('有训练正在进行，请先结束该节训练');
      const now = nowIso();
      const { lastInsertRowid } = db.prepare('INSERT INTO session (date, started_at, ended_at) VALUES (?, ?, ?)')
        .run(date, now, now);
      for (let offset = 0; offset < item.sets - already.count; offset++) {
        addSet(Number(lastInsertRowid), {
          planItemId: id, exerciseId: item.exercise_id, exerciseName: item.name,
          bodyPart: item.body_part, target: item.target,
          setIndex: already.last + offset + 1, weight: item.weight, reps: item.reps,
          durationSec: 0, restSec: item.rest_sec,
        });
      }
      markPlanDone(id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function addPlanItem(
  ex: ExerciseRow,
  opts: { sets?: number; reps?: number; weight?: number; restSec?: number; date?: string; supplemental?: boolean } = {},
): PlanItem {
  const db = getDb();
  const date = opts.date ?? todayStr();
  const pos =
    ((db.prepare('SELECT MAX(position) AS m FROM plan_item WHERE date = ?').get(date) as { m: number | null }).m ??
      0) + 1;
  db.prepare(
    `INSERT INTO plan_item (date, exercise_id, name, body_part, target, equipment, sets, reps, weight, rest_sec, position, done, supplemental, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    date,
    ex.id,
    ex.zh_name || ex.name,
    ex.body_part,
    ex.target,
    ex.equipment,
    Math.round(clamp(opts.sets, 1, 20, 4)),
    Math.round(clamp(opts.reps, 1, 100, 10)),
    clamp(opts.weight, 0, 1000, 0),
    Math.round(clamp(opts.restSec, 0, 600, 90)),
    pos,
    opts.supplemental ? 1 : 0,
    nowIso(),
  );
  return plain(
    db.prepare('SELECT * FROM plan_item WHERE date = ? ORDER BY id DESC LIMIT 1').get(date) as unknown as PlanItem,
  );
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function addPlanExercises(date: string, exercises: ExerciseRow[]): PlanItem[] {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (date !== todayStr()) throw new Error('日期已变化，请刷新今日计划后再选择');
    const existing = new Set(getPlan(date).map((item) => item.exercise_id));
    for (const exercise of exercises) {
      if (existing.has(exercise.id)) continue;
      addPlanItem(exercise, { date });
      existing.add(exercise.id);
    }
    const items = getPlan(date);
    db.exec('COMMIT');
    return items;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function updatePlanItem(
  id: number,
  patch: { sets?: number; reps?: number; weight?: number; restSec?: number; done?: number },
): void {
  const cur = getDb().prepare('SELECT * FROM plan_item WHERE id = ?').get(id) as PlanItem | undefined;
  if (!cur) return;
  getDb()
    .prepare('UPDATE plan_item SET sets = ?, reps = ?, weight = ?, rest_sec = ?, done = ? WHERE id = ?')
    .run(
      patch.sets === undefined ? cur.sets : Math.round(clamp(patch.sets, 1, 20, cur.sets)),
      patch.reps === undefined ? cur.reps : Math.round(clamp(patch.reps, 1, 100, cur.reps)),
      patch.weight === undefined ? cur.weight : clamp(patch.weight, 0, 1000, cur.weight),
      patch.restSec === undefined ? cur.rest_sec : Math.round(clamp(patch.restSec, 0, 600, cur.rest_sec)),
      patch.done === undefined ? cur.done : patch.done ? 1 : 0,
      id,
    );
}

export function deletePlanItem(id: number): void {
  getDb().prepare('DELETE FROM plan_item WHERE id = ?').run(id);
}

export function clearPlan(date = todayStr()): void {
  getDb().prepare('DELETE FROM plan_item WHERE date = ?').run(date);
}

/* ------------------------------ 训练会话 ------------------------------ */

export function activeTraining(): SessionRow | null {
  const row = getDb()
    .prepare('SELECT * FROM session WHERE ended_at IS NULL AND plan_json IS NOT NULL ORDER BY id DESC LIMIT 1')
    .get() as SessionRow | undefined;
  return row ? plain(row) : null;
}

export function sessionPlan(session: SessionRow): PlanItem[] {
  return session.plan_json ? JSON.parse(session.plan_json) as PlanItem[] : getPlan(session.date);
}

export function startSession({
  note, firstPlanItemId, guided = false, usePlanProgress = false, supplemental,
}: {
  note?: string;
  firstPlanItemId?: number;
  guided?: boolean;
  usePlanProgress?: boolean;
  supplemental?: { exercise: ExerciseRow; sets: number; reps: number; weight: number; restSec: number }[];
} = {}): SessionRow {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const active = guided || supplemental ? activeTraining() : null;
    if (active) {
      if (supplemental) throw new Error('已有训练进行中，请先完成该节训练');
      db.exec('COMMIT');
      return active;
    }

    const date = todayStr();
    let queue: PlanItem[] | null = null;
    if (supplemental) {
      queue = supplemental.map(({ exercise, ...config }) => addPlanItem(exercise, { ...config, date, supplemental: true }));
    } else if (guided) {
      const plan = usePlanProgress ? getPlanProgress(date) : getPlan(date);
      const pending = plan.filter((item) => !item.done);
      const first = pending.find((item) => item.id === firstPlanItemId);
      if (firstPlanItemId !== undefined && !first) throw new Error('这个动作已完成或已从清单移除');
      queue = first ? [first, ...pending.filter((item) => item.id !== first.id)] : pending;
      if (!queue.length) throw new Error('请先在计划中加入待练动作');
    }

    const { lastInsertRowid } = db.prepare(
      'INSERT INTO session (date, started_at, note, plan_json) VALUES (?, ?, ?, ?)',
    ).run(date, nowIso(), note ?? null, queue && JSON.stringify(queue));
    const session = getSession(Number(lastInsertRowid))!;
    db.exec('COMMIT');
    return session;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getSession(id: number): SessionRow | null {
  const row = getDb().prepare('SELECT * FROM session WHERE id = ?').get(id) as SessionRow | undefined;
  return row ? plain(row) : null;
}

export function addSet(
  sessionId: number,
  d: {
    planItemId?: number | null;
    exerciseId: string;
    exerciseName: string;
    bodyPart?: string;
    target?: string;
    setIndex: number;
    weight: number;
    reps: number;
    durationSec: number;
    restSec: number;
  },
): void {
  getDb()
    .prepare(
      `INSERT INTO session_set (session_id, plan_item_id, exercise_id, exercise_name, body_part, target, set_index, weight, reps, duration_sec, rest_sec, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      d.planItemId ?? null,
      d.exerciseId,
      d.exerciseName,
      d.bodyPart ?? '',
      d.target ?? '',
      d.setIndex,
      Math.max(0, d.weight),
      Math.max(0, Math.round(d.reps)),
      Math.max(0, Math.round(d.durationSec)),
      Math.max(0, Math.round(d.restSec)),
      nowIso(),
    );
}

export function markPlanDone(planItemId: number): void {
  getDb().prepare('UPDATE plan_item SET done = 1 WHERE id = ?').run(planItemId);
}

export function finishSession(id: number): void {
  getDb().prepare('UPDATE session SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(nowIso(), id);
}

export function getSessionSets(sessionId: number): SetRow[] {
  return plainAll(
    getDb()
      .prepare('SELECT * FROM session_set WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId) as unknown as SetRow[],
  );
}

/** 历史记录只允许修正这一组的重量和次数，统计会基于新值重新计算。 */
export function updateSessionSet(id: number, patch: { weight?: number; reps?: number }): SetRow {
  const db = getDb();
  const current = db.prepare('SELECT * FROM session_set WHERE id = ?').get(id) as SetRow | undefined;
  if (!current) throw new Error('训练组不存在');
  const weight = patch.weight === undefined ? current.weight : clamp(patch.weight, 0, 1000, current.weight);
  const reps = patch.reps === undefined ? current.reps : Math.round(clamp(patch.reps, 1, 1000, current.reps));
  db.prepare('UPDATE session_set SET weight = ?, reps = ? WHERE id = ?').run(weight, reps, id);
  return plain(db.prepare('SELECT * FROM session_set WHERE id = ?').get(id) as unknown as SetRow);
}

/** 历史记录里给某个动作末尾补一组，默认沿用该动作上一组的重量与次数。 */
export function appendSessionSet(
  sessionId: number,
  exerciseId: string,
  patch: { weight?: number; reps?: number } = {},
): SetRow[] {
  const db = getDb();
  if (!getSession(sessionId)) throw new Error('训练不存在');
  const group = plainAll(
    db
      .prepare('SELECT * FROM session_set WHERE session_id = ? AND exercise_id = ? ORDER BY id ASC')
      .all(sessionId, exerciseId) as unknown as SetRow[],
  );
  const last = group.at(-1);
  if (!last) throw new Error('该动作没有可追加的训练组');
  const nextIndex = Math.max(...group.map((set) => set.set_index)) + 1;
  const weight = patch.weight === undefined ? last.weight : clamp(patch.weight, 0, 1000, last.weight);
  const reps = patch.reps === undefined ? last.reps : Math.round(clamp(patch.reps, 1, 1000, last.reps));
  db.prepare(
    `INSERT INTO session_set (session_id, plan_item_id, exercise_id, exercise_name, body_part, target, set_index, weight, reps, duration_sec, rest_sec, actual_rest_sec, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)`,
  ).run(
    sessionId,
    last.plan_item_id,
    last.exercise_id,
    last.exercise_name,
    last.body_part,
    last.target,
    nextIndex,
    weight,
    reps,
    nowIso(),
  );
  return plainAll(
    db
      .prepare('SELECT * FROM session_set WHERE session_id = ? AND exercise_id = ? ORDER BY id ASC')
      .all(sessionId, exerciseId) as unknown as SetRow[],
  );
}

/** 删除一组，并把同一动作剩下的组号重新编号；返回该动作剩余的组。 */
export function deleteSessionSet(id: number): { sets: SetRow[]; exerciseId: string; sessionId: number } {
  const db = getDb();
  const current = db.prepare('SELECT * FROM session_set WHERE id = ?').get(id) as SetRow | undefined;
  if (!current) throw new Error('训练组不存在');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM session_set WHERE id = ?').run(id);
    const rest = plainAll(
      db
        .prepare('SELECT * FROM session_set WHERE session_id = ? AND exercise_id = ? ORDER BY id ASC')
        .all(current.session_id, current.exercise_id) as unknown as SetRow[],
    );
    rest.forEach((set, index) => {
      if (set.set_index === index + 1) return;
      db.prepare('UPDATE session_set SET set_index = ? WHERE id = ?').run(index + 1, set.id);
      set.set_index = index + 1;
    });
    db.exec('COMMIT');
    return { sets: rest, exerciseId: current.exercise_id, sessionId: current.session_id };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function saveGuidedSet(
  sessionId: number,
  data: {
    planItemId: number;
    setIndex: number;
    weight: number;
    reps: number;
    durationSec: number;
    restSec: number;
    previousSetId?: number;
    previousRestSec?: number;
  },
): { ended: boolean; sets: SetRow[] } {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const session = getSession(sessionId);
    if (!session?.plan_json) throw new Error('训练不存在');
    const plan = sessionPlan(session);
    const sets = getSessionSets(sessionId);
    const alreadySaved = sets.some((set) => set.plan_item_id === data.planItemId && set.set_index === data.setIndex);
    if (!alreadySaved) {
      if (session.ended_at) throw new Error('训练已经结束');
      const completed = new Map<number, number>();
      for (const set of sets) {
        if (set.plan_item_id !== null) completed.set(set.plan_item_id, (completed.get(set.plan_item_id) ?? 0) + 1);
      }
      const item = plan.find((entry) => (completed.get(entry.id) ?? 0) < entry.sets);
      if (item?.id !== data.planItemId || data.setIndex !== (completed.get(item.id) ?? 0) + 1) {
        throw new Error('训练进度已更新，请刷新后继续');
      }
      const previous = sets.at(-1);
      if (previous && data.previousSetId === previous.id && data.previousRestSec !== undefined) {
        db.prepare('UPDATE session_set SET actual_rest_sec = ? WHERE id = ? AND session_id = ?')
          .run(Math.round(clamp(data.previousRestSec, 0, 86400, 0)), previous.id, sessionId);
      }
      addSet(sessionId, {
        ...data,
        exerciseId: item.exercise_id,
        exerciseName: item.name,
        bodyPart: item.body_part,
        target: item.target,
      });
      completed.set(item.id, data.setIndex);
      if (data.setIndex === item.sets) markPlanDone(item.id);
      if (plan.every((entry) => (completed.get(entry.id) ?? 0) >= entry.sets)) finishSession(sessionId);
    }
    const result = { ended: Boolean(getSession(sessionId)?.ended_at), sets: getSessionSets(sessionId) };
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/* ------------------------------ 统计 ------------------------------ */

export function volumeStats(start: string, end: string): VolumeStats {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS sets, COALESCE(SUM(s.weight * s.reps), 0) AS volume
       FROM session_set s JOIN session se ON se.id = s.session_id
       WHERE se.date BETWEEN ? AND ?`,
    )
    .get(start, end) as { sets: number; volume: number };

  const se = db
    .prepare(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(CASE WHEN ended_at IS NOT NULL
                THEN (julianday(ended_at) - julianday(started_at)) * 24 * 60 ELSE 0 END), 0) AS minutes
       FROM session WHERE date BETWEEN ? AND ?`,
    )
    .get(start, end) as { sessions: number; minutes: number };
  const quick = db
    .prepare("SELECT COUNT(*) AS sessions FROM journal_entry WHERE kind = 'training' AND merged_session_id IS NULL AND date NOT IN (SELECT date FROM session) AND date BETWEEN ? AND ?")
    .get(start, end) as { sessions: number };
  const days = db
    .prepare(
      `SELECT COUNT(*) AS count FROM (
         SELECT date FROM session WHERE date BETWEEN ? AND ?
         UNION
         SELECT date FROM journal_entry WHERE kind = 'training' AND date BETWEEN ? AND ?
       )`,
    )
    .get(start, end, start, end) as { count: number };

  return {
    sets: row.sets,
    volume: Math.round(row.volume),
    sessions: se.sessions + quick.sessions,
    quickSessions: quick.sessions,
    days: days.count,
    durationMin: Math.round(se.minutes),
  };
}

const QUICK_BODY_PART: Record<MuscleId, string> = {
  chest_upper: 'chest', chest_mid: 'chest', chest_lower: 'chest', serratus: 'chest',
  abs: 'waist', obliques: 'waist',
  delt_front: 'shoulders', delt_side: 'shoulders', delt_rear: 'shoulders',
  biceps: 'upper arms', triceps: 'upper arms', forearms: 'lower arms',
  traps: 'back', lats: 'back', upperback: 'back', lowerback: 'back',
  glutes: 'upper legs', quads: 'upper legs', hamstrings: 'upper legs', adductors: 'upper legs',
  calves: 'lower legs', neck: 'neck',
};

export function muscleStats(start: string, end: string): MuscleStat[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.body_part AS body_part,
              COALESCE(SUM(s.weight * s.reps), 0) AS volume,
              COUNT(*) AS sets
       FROM session_set s JOIN session se ON se.id = s.session_id
       WHERE se.date BETWEEN ? AND ?
       GROUP BY s.body_part`,
    )
    .all(start, end) as unknown as Array<Omit<MuscleStat, 'records'>>;
  const merged = new Map(rows.map((row) => [row.body_part, { ...row, records: 0 }]));
  const quick = db
    .prepare("SELECT detail FROM journal_entry WHERE kind = 'training' AND merged_session_id IS NULL AND date NOT IN (SELECT date FROM session) AND date BETWEEN ? AND ?")
    .all(start, end) as unknown as Array<{ detail: string }>;
  for (const entry of quick) {
    const bodyParts = new Set(mentionedMuscles(entry.detail).map((muscle) => QUICK_BODY_PART[muscle]));
    for (const bodyPart of bodyParts) {
      const stat = merged.get(bodyPart) ?? { body_part: bodyPart, volume: 0, sets: 0, records: 0 };
      stat.records += 1;
      merged.set(bodyPart, stat);
    }
  }
  return [...merged.values()].sort((a, b) => b.volume - a.volume || b.records - a.records);
}

/** 每个动作的容量只计入一个主要目标肌群。 */
export function primaryMuscleActivity(start: string, end: string) {
  const rows = getDb().prepare(`
    SELECT se.date, se.id AS sessionId, COALESCE(NULLIF(e.name, ''), s.exercise_name) AS name,
      COALESCE(NULLIF(e.target, ''), s.target) AS target,
      COALESCE(NULLIF(e.body_part, ''), s.body_part) AS body_part,
      SUM(s.weight * s.reps) AS volume, COUNT(*) AS sets, SUM(s.duration_sec) AS seconds
    FROM session_set s JOIN session se ON se.id = s.session_id
    LEFT JOIN exercise e ON e.id = s.exercise_id
    WHERE se.date BETWEEN ? AND ?
    GROUP BY 1, 2, 3, 4, 5
  `).all(start, end) as { date: string; sessionId: number; name: string; target: string; body_part: string; volume: number; sets: number; seconds: number }[];
  const activity: { id: MuscleId; date: string; sessionId: number; volume: number; sets: number; seconds: number }[] = [];
  for (const row of rows) {
    const matches = MUSCLES.filter((muscle) => muscleMatchesExercise(muscle, row));
    const candidates = idsForTarget(row.target);
    const id = matches.find((muscle) => muscle.include)?.id ?? matches[0]?.id
      ?? (candidates.includes('delt_side') ? 'delt_side' : candidates[0])
      ?? mentionedMuscles(row.name)[0];
    if (!id) continue;
    activity.push({ id, date: row.date, sessionId: row.sessionId, volume: row.volume, sets: row.sets, seconds: row.seconds });
  }
  return activity;
}

/** Same session/date scope as muscleStats, including zero-weight recorded sets. */
export function recordedMuscles(start: string, end: string): MuscleId[] {
  const rows = getDb().prepare(`SELECT DISTINCT COALESCE(e.name, s.exercise_name) AS name,
    COALESCE(NULLIF(e.target, ''), s.target) AS target,
    COALESCE(NULLIF(e.body_part, ''), s.body_part) AS body_part,
    COALESCE(e.secondary_muscles, '[]') AS secondary
    FROM session_set s JOIN session se ON se.id = s.session_id
    LEFT JOIN exercise e ON e.id = s.exercise_id WHERE se.date BETWEEN ? AND ?`)
    .all(start, end) as unknown as Array<{ name: string; target: string; body_part: string; secondary: string }>;
  const recorded = new Set<MuscleId>();
  for (const row of rows) {
    const matched = MUSCLES.filter((muscle) => muscleMatchesExercise(muscle, row)).map((muscle) => muscle.id);
    for (const id of [...matched, ...idsForTarget(row.target), ...mentionedMuscles(row.name)]) recorded.add(id);
    try {
      const secondary = JSON.parse(row.secondary);
      if (Array.isArray(secondary)) for (const target of secondary) for (const id of idsForTarget(String(target))) recorded.add(id);
    } catch { /* An absent secondary list does not invalidate primary-muscle records. */ }
  }
  return [...recorded];
}

export function exercisePerformance(start: string, end: string): ExercisePerformance[] {
  const rows = getDb().prepare(`
    SELECT s.exercise_id AS id, s.exercise_name AS name, e.image,
      s.weight, s.reps, se.date, se.id AS sessionId
    FROM session_set s JOIN session se ON se.id = s.session_id
    LEFT JOIN exercise e ON e.id = s.exercise_id
    WHERE se.date BETWEEN ? AND ?
    ORDER BY se.date DESC, se.started_at DESC, se.id DESC, s.id DESC
  `).all(start, end) as { id: string; name: string; image: string | null; weight: number; reps: number; date: string; sessionId: number }[];
  const exercises = new Map<string, ExercisePerformance>();
  const sessionsByExercise = new Map<string, Map<number, ExercisePerformance['sessions'][number]>>();

  for (const { id, name, image, weight, reps, date, sessionId } of rows) {
    let exercise = exercises.get(id);
    let sessions = sessionsByExercise.get(id);
    if (!exercise || !sessions) {
      exercise = { id, name, image, pr: null, growth: null, endurance: null, sessions: [] };
      exercises.set(id, exercise);
      sessions = new Map();
      sessionsByExercise.set(id, sessions);
    }
    let session = sessions.get(sessionId);
    if (!session) {
      session = { id: sessionId, date, pr: null, growth: null, endurance: null, weights: {} };
      sessions.set(sessionId, session);
      exercise.sessions.push(session);
    }
    if (reps > 0) session.weights[reps] = Math.max(session.weights[reps] ?? 0, weight);
    if (reps <= 0 || reps > 15) continue;

    if (weight > 0) {
      const estimate = reps === 1 ? weight : weight * (1 + reps / 30);
      const best = { value: estimate, weight, reps, date };
      if (exercise.pr === null || estimate > exercise.pr.value) exercise.pr = best;
      if (session.pr === null || estimate > session.pr.value) session.pr = best;
    }
    // 12 次属于两个区间。每档保留该范围内实际完成的最重一组。
    if (reps >= 8 && reps <= 12) {
      const best = { value: weight, weight, reps, date };
      if (!exercise.growth || weight > exercise.growth.value) exercise.growth = best;
      if (!session.growth || weight > session.growth.value) session.growth = best;
    }
    if (reps >= 12) {
      const best = { value: weight, weight, reps, date };
      if (!exercise.endurance || weight > exercise.endurance.value) exercise.endurance = best;
      if (!session.endurance || weight > session.endurance.value) session.endurance = best;
    }
  }
  return [...exercises.values()];
}

export function trendStats(start: string, end: string): TrendPoint[] {
  return getDb()
    .prepare(
      `SELECT se.date AS date,
              COALESCE(SUM(s.weight * s.reps), 0) AS volume,
              COUNT(*) AS sets
       FROM session_set s JOIN session se ON se.id = s.session_id
       WHERE se.date BETWEEN ? AND ?
       GROUP BY se.date ORDER BY se.date ASC`,
    )
    .all(start, end) as unknown as TrendPoint[];
}

export function trainingTimeByDate(start: string, end: string) {
  return getDb().prepare(`
    SELECT s.date, COUNT(*) AS sessions,
      SUM(ROUND((julianday(s.ended_at) - julianday(s.started_at)) * 86400)) AS seconds
    FROM session s
    WHERE s.date BETWEEN ? AND ? AND julianday(s.ended_at) > julianday(s.started_at)
      AND EXISTS (SELECT 1 FROM session_set WHERE session_id = s.id)
    GROUP BY s.date ORDER BY s.date
  `).all(start, end) as { date: string; sessions: number; seconds: number }[];
}

/* ------------------------------ 历史 ------------------------------ */

export interface DayOverview {
  date: string;
  volume: number;
  sets: number;
  sessions: number;
  kcal: number;
}

export function monthOverview(month: string): Map<string, DayOverview> {
  const db = getDb();
  const out = new Map<string, DayOverview>();
  const workouts = db
    .prepare(
      `SELECT se.date AS date,
              COALESCE(SUM(s.weight * s.reps), 0) AS volume,
              COUNT(s.id) AS sets,
              COUNT(DISTINCT se.id) AS sessions
       FROM session se LEFT JOIN session_set s ON s.session_id = se.id
       WHERE substr(se.date, 1, 7) = ?
       GROUP BY se.date`,
    )
    .all(month) as unknown as Array<{ date: string; volume: number; sets: number; sessions: number }>;

  for (const w of workouts) {
    out.set(w.date, { date: w.date, volume: Math.round(w.volume), sets: w.sets, sessions: w.sessions, kcal: 0 });
  }

  const meals = db
    .prepare(
      `SELECT date, COALESCE(SUM(kcal), 0) AS kcal FROM meal_log
       WHERE substr(date, 1, 7) = ? GROUP BY date`,
    )
    .all(month) as unknown as Array<{ date: string; kcal: number }>;

  for (const m of meals) {
    const cur = out.get(m.date) ?? { date: m.date, volume: 0, sets: 0, sessions: 0, kcal: 0 };
    cur.kcal = Math.round(m.kcal);
    out.set(m.date, cur);
  }

  return out;
}

export interface SessionDetail {
  session: SessionRow;
  sets: SetRow[];
  groups: Array<{ exercise_id: string; exercise_name: string; body_part: string; sets: SetRow[]; volume: number }>;
}

export function daySessions(date: string): SessionDetail[] {
  const db = getDb();
  const sessions = db
    .prepare('SELECT * FROM session WHERE date = ? ORDER BY started_at ASC')
    .all(date) as unknown as SessionRow[];

  return sessions.map((session) => {
    const sets = getSessionSets(session.id);
    const map = new Map<string, SessionDetail['groups'][number]>();
    for (const s of sets) {
      let g = map.get(s.exercise_id);
      if (!g) {
        g = { exercise_id: s.exercise_id, exercise_name: s.exercise_name, body_part: s.body_part, sets: [], volume: 0 };
        map.set(s.exercise_id, g);
      }
      g.sets.push(s);
      g.volume += s.weight * s.reps;
    }
    return { session, sets, groups: [...map.values()].map((g) => ({ ...g, volume: Math.round(g.volume) })) };
  });
}

export function sessionTotals(details: SessionDetail[]): VolumeStats {
  const sets = details.reduce((a, d) => a + d.sets.length, 0);
  const volume = Math.round(details.reduce((a, d) => a + d.sets.reduce((x, s) => x + s.weight * s.reps, 0), 0));
  const days = new Set(details.map((d) => d.session.date)).size;
  const durationMin = Math.round(
    details.reduce((a, d) => {
      if (!d.session.ended_at) return a;
      return a + (new Date(d.session.ended_at).getTime() - new Date(d.session.started_at).getTime()) / 60000;
    }, 0),
  );
  return { sets, volume, sessions: details.length, quickSessions: 0, days, durationMin };
}
