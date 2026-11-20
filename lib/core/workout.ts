import { getDb } from '../db';
import { todayKey } from '../date';
import { idsForTarget } from '../energy';
import { mentionedMuscles } from '../journal';
import { MUSCLES, muscleMatchesExercise, type MuscleId } from '../muscles';
import type { ExerciseRow } from '../exercise';
import type {
  ExerciseStat,
  MuscleStat,
  PlanItem,
  SessionRow,
  SetRow,
  TrendPoint,
  VolumeStats,
} from '../types';

const TZ = process.env.APP_TZ || 'Asia/Shanghai';

/** node:sqlite 返回的是 null 原型对象，传给 Client Component 前必须转成普通对象 */
function plain<T extends object>(row: T): T {
  return { ...row };
}
function plainAll<T extends object>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r }));
}

export function todayStr(): string {
  return todayKey(TZ);
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

export function addPlanItem(
  ex: ExerciseRow,
  opts: { sets?: number; reps?: number; weight?: number; restSec?: number; date?: string } = {},
): PlanItem {
  const db = getDb();
  const date = opts.date ?? todayStr();
  const pos =
    ((db.prepare('SELECT MAX(position) AS m FROM plan_item WHERE date = ?').get(date) as { m: number | null }).m ??
      0) + 1;
  db.prepare(
    `INSERT INTO plan_item (date, exercise_id, name, body_part, target, equipment, sets, reps, weight, rest_sec, position, done, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
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

export function startSession(note?: string, firstPlanItemId?: number, guided = false): SessionRow {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const active = guided ? activeTraining() : null;
    if (active) {
      db.exec('COMMIT');
      return active;
    }

    const date = todayStr();
    let queue: PlanItem[] | null = null;
    if (guided) {
      const pending = getPlan(date).filter((item) => !item.done);
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

export function exerciseStats(start: string, end: string, limit = 6): ExerciseStat[] {
  return getDb()
    .prepare(
      `SELECT s.exercise_id AS exercise_id,
              MAX(s.exercise_name) AS exercise_name,
              COALESCE(SUM(s.weight * s.reps), 0) AS volume,
              COUNT(*) AS sets,
              MAX(s.weight) AS best_weight,
              MAX(s.reps) AS best_reps
       FROM session_set s JOIN session se ON se.id = s.session_id
       WHERE se.date BETWEEN ? AND ?
       GROUP BY s.exercise_id ORDER BY volume DESC LIMIT ?`,
    )
    .all(start, end, limit) as unknown as ExerciseStat[];
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
