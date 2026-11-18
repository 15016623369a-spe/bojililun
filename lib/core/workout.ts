import { getDb } from '../db';
import { todayKey } from '../date';
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
    ex.name,
    ex.body_part,
    ex.target,
    ex.equipment,
    opts.sets ?? 4,
    opts.reps ?? 10,
    opts.weight ?? 0,
    opts.restSec ?? 90,
    pos,
    nowIso(),
  );
  return plain(
    db.prepare('SELECT * FROM plan_item WHERE date = ? ORDER BY id DESC LIMIT 1').get(date) as unknown as PlanItem,
  );
}

export function updatePlanItem(
  id: number,
  patch: { sets?: number; reps?: number; weight?: number; restSec?: number; done?: number },
): void {
  const cur = getDb().prepare('SELECT * FROM plan_item WHERE id = ?').get(id) as PlanItem | undefined;
  if (!cur) return;
  const clamp = (v: unknown, min: number, max: number, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
  };
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

export function startSession(note?: string): SessionRow {
  const db = getDb();
  db.prepare('INSERT INTO session (date, started_at, note) VALUES (?, ?, ?)').run(
    todayStr(),
    nowIso(),
    note ?? null,
  );
  return plain(db.prepare('SELECT * FROM session ORDER BY id DESC LIMIT 1').get() as unknown as SessionRow);
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
  getDb().prepare('UPDATE session SET ended_at = ? WHERE id = ?').run(nowIso(), id);
}

export function getSessionSets(sessionId: number): SetRow[] {
  return plainAll(
    getDb()
      .prepare('SELECT * FROM session_set WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId) as unknown as SetRow[],
  );
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
      `SELECT COUNT(*) AS sessions, COUNT(DISTINCT date) AS days,
              COALESCE(SUM(CASE WHEN ended_at IS NOT NULL
                THEN (julianday(ended_at) - julianday(started_at)) * 24 * 60 ELSE 0 END), 0) AS minutes
       FROM session WHERE date BETWEEN ? AND ?`,
    )
    .get(start, end) as { sessions: number; days: number; minutes: number };

  return {
    sets: row.sets,
    volume: Math.round(row.volume),
    sessions: se.sessions,
    days: se.days,
    durationMin: Math.round(se.minutes),
  };
}

export function muscleStats(start: string, end: string): MuscleStat[] {
  return getDb()
    .prepare(
      `SELECT s.body_part AS body_part,
              COALESCE(SUM(s.weight * s.reps), 0) AS volume,
              COUNT(*) AS sets
       FROM session_set s JOIN session se ON se.id = s.session_id
       WHERE se.date BETWEEN ? AND ?
       GROUP BY s.body_part ORDER BY volume DESC`,
    )
    .all(start, end) as unknown as MuscleStat[];
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
  return { sets, volume, sessions: details.length, days, durationMin };
}
