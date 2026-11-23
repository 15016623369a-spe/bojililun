import type { DatabaseSync } from 'node:sqlite';
import dictionary from '../data/exercises-seed.json';
import { idsForTarget } from './energy';
import { mentionedMuscles } from './journal';
import { MUSCLES, muscleMatchesExercise, type MuscleId } from './muscles';
import type { ExercisePerformance, TrendPoint, VolumeStats } from './types';

/**
 * 回顾页和训练统计共用的训练数据，只读手账（entries + workout_sets）。
 * - 训练页练的每一节同步进手账（request_key 为 legacy/workout/<session id>/0），语音、文字记的训练和旧的快速记录也在手账里，
 *   每节只有一份，两页数的是同一批训练。「记录」里移除的卡片（is_deleted）两页都不算。
 * - 一节训练：训练页的一节，或语音、文字的一次提交（一句话拆成几张卡也算一次）。
 * - 时长只有训练表有：按同步键里的 session id 取开始到结束；语音、文字训练没有时长。
 * - 每个动作只归入一个主要肌群（primaryMuscle）。同步来的动作带着训练页动作库的 id（library_id），词典里的动作按 legacy_id
 *   对到动作库的同一条，所以语音记的深蹲和训练页的深蹲归到同一个肌群、同一条 PR 曲线。
 */

export type LoggedSet = { weight: number; reps: number; seconds: number };
export type LoggedMove = {
  /** 动作库 id；动作库里没有的动作用词典 id 或名称 */
  key: string;
  name: string;
  image: string | null;
  muscle: MuscleId | null;
  sets: LoggedSet[];
};
export type LoggedWorkout = {
  /** 这节训练第一张手账卡片的 id */
  id: number;
  date: string;
  startedAt: string;
  /** 训练页的那一节；语音、文字记录为 null */
  sessionId: number | null;
  /** 训练页记下的时长（秒，未取整）；没有时长为 0 */
  seconds: number;
  moves: LoggedMove[];
};
export type MuscleActivity = { id: MuscleId; date: string; sessionId: number; volume: number; sets: number; seconds: number };

/** 动作 → 一个主要肌群：按动作库的 target / body_part 匹配，再退到动作名里提到的部位。统计、回顾和旧训练同步共用这条判定。 */
export function primaryMuscle(ex: { name: string; target: string; body_part: string }, ...names: string[]): MuscleId | undefined {
  const matches = MUSCLES.filter((muscle) => muscleMatchesExercise(muscle, ex));
  const candidates = idsForTarget(ex.target);
  return matches.find((muscle) => muscle.include)?.id ?? matches[0]?.id
    ?? (candidates.includes('delt_side') ? 'delt_side' : candidates[0])
    ?? names.map((name) => mentionedMuscles(name)[0]).find(Boolean);
}

type Action = { exercise_id: string | null; exercise_name: string; primary_muscles?: string[]; library_id?: string | null };
type LibraryRow = { name: string; target: string; body_part: string; image: string };

const DICT = new Map(dictionary.map((e) => [e.id, e]));
const MUSCLE_IDS = new Set<string>(MUSCLES.map((m) => m.id));
const SESSION_KEY = /^legacy\/workout\/(\d+)$/;

export function trainingLog(db: DatabaseSync, start: string, end: string, user = 'local'): LoggedWorkout[] {
  const entries = db.prepare(`
    SELECT id, date, logged_at, actions, request_key FROM entries
    WHERE user_id = ? AND entry_type = 'workout' AND is_deleted = 0 AND date BETWEEN ? AND ?
    ORDER BY logged_at, id
  `).all(user, start, end) as { id: number; date: string; logged_at: string; actions: string; request_key: string }[];
  const setRows = db.prepare(`
    SELECT s.entry_id, s.action_index, s.weight_kg, s.reps, s.duration_sec
    FROM workout_sets s JOIN entries e ON e.id = s.entry_id
    WHERE e.user_id = ? AND e.entry_type = 'workout' AND e.is_deleted = 0 AND e.date BETWEEN ? AND ?
    ORDER BY s.entry_id, s.action_index, s.set_order
  `).all(user, start, end) as { entry_id: number; action_index: number; weight_kg: number | null; reps: number | null; duration_sec: number | null }[];
  const sets = new Map<string, LoggedSet[]>();
  for (const s of setRows) {
    const key = `${s.entry_id}:${s.action_index}`;
    const list = sets.get(key) ?? [];
    list.push({ weight: s.weight_kg ?? 0, reps: s.reps ?? 0, seconds: s.duration_sec ?? 0 });
    sets.set(key, list);
  }

  const library = db.prepare('SELECT name, target, body_part, image FROM exercise WHERE id = ?');
  const resolved = new Map<string, Omit<LoggedMove, 'sets'>>();
  const resolve = (a: Action): Omit<LoggedMove, 'sets'> => {
    const cacheKey = `${a.library_id ?? ''}|${a.exercise_id ?? ''}|${a.exercise_name}`;
    const hit = resolved.get(cacheKey);
    if (hit) return hit;
    const dict = a.exercise_id ? DICT.get(a.exercise_id) : undefined;
    const libraryId = a.library_id ?? dict?.legacy_id ?? null;
    const lib = libraryId ? library.get(libraryId) as LibraryRow | undefined : undefined;
    const listed = a.primary_muscles?.find((id) => MUSCLE_IDS.has(id)) as MuscleId | undefined;
    const muscle = (lib && primaryMuscle({ name: lib.name || a.exercise_name, target: lib.target, body_part: lib.body_part }, lib.name, a.exercise_name))
      ?? listed ?? mentionedMuscles(a.exercise_name)[0] ?? null;
    const move = {
      key: lib ? libraryId! : a.exercise_id ?? `name:${a.exercise_name}`,
      name: a.exercise_name,
      image: lib?.image || null,
      muscle,
    };
    resolved.set(cacheKey, move);
    return move;
  };

  const workouts = new Map<string, LoggedWorkout>();
  for (const e of entries) {
    const key = e.request_key.replace(/\/\d+$/, '');
    let workout = workouts.get(key);
    if (!workout) {
      const session = key.match(SESSION_KEY);
      workout = { id: e.id, date: e.date, startedAt: e.logged_at, sessionId: session ? Number(session[1]) : null, seconds: 0, moves: [] };
      workouts.set(key, workout);
    }
    const actions = JSON.parse(e.actions) as Action[];
    for (const [i, a] of actions.entries()) workout.moves.push({ ...resolve(a), sets: sets.get(`${e.id}:${i}`) ?? [] });
  }

  const list = [...workouts.values()];
  const ids = list.flatMap((w) => (w.sessionId === null ? [] : [w.sessionId]));
  if (ids.length) {
    const spans = db.prepare(`
      SELECT id, (julianday(ended_at) - julianday(started_at)) * 86400 AS seconds FROM session
      WHERE id IN (${ids.map(() => '?').join(',')}) AND julianday(ended_at) > julianday(started_at)
    `).all(...ids) as { id: number; seconds: number }[];
    const byId = new Map(spans.map((s) => [s.id, s.seconds]));
    for (const w of list) if (w.sessionId !== null) w.seconds = byId.get(w.sessionId) ?? 0;
  }
  return list;
}

const volumeOf = (sets: LoggedSet[]) => sets.reduce((sum, s) => sum + s.weight * s.reps, 0);

/** 总览：容量、组数、训练次数和天数、时长。没有任何组的记录（例如只说了「练了胸」）计入次数和天数，另记为 quickSessions。 */
export function trainingTotals(workouts: LoggedWorkout[]): VolumeStats {
  let sets = 0, volume = 0, seconds = 0, quickSessions = 0;
  for (const w of workouts) {
    const all = w.moves.flatMap((m) => m.sets);
    sets += all.length;
    volume += volumeOf(all);
    seconds += w.seconds;
    if (!all.length) quickSessions++;
  }
  return {
    sets,
    volume: Math.round(volume),
    sessions: workouts.length,
    quickSessions,
    days: new Set(workouts.map((w) => w.date)).size,
    durationMin: Math.round(seconds / 60),
  };
}

/** 每天的容量和组数，只列有组的日子 */
export function dailyVolume(workouts: LoggedWorkout[]): TrendPoint[] {
  const out = new Map<string, TrendPoint>();
  for (const w of workouts) {
    const all = w.moves.flatMap((m) => m.sets);
    if (!all.length) continue;
    const day = out.get(w.date) ?? { date: w.date, volume: 0, sets: 0 };
    day.volume += volumeOf(all);
    day.sets += all.length;
    out.set(w.date, day);
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 每天训练页记下的时长（秒）和有时长的训练节数 */
export function trainingTimeByDay(workouts: LoggedWorkout[]) {
  const out = new Map<string, { date: string; sessions: number; seconds: number }>();
  for (const w of workouts) {
    if (!(w.seconds > 0)) continue;
    const day = out.get(w.date) ?? { date: w.date, sessions: 0, seconds: 0 };
    day.sessions += 1;
    day.seconds += Math.round(w.seconds);
    out.set(w.date, day);
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 每节训练里每个动作的组数、容量和组时长，记在它的主要肌群上 */
export function muscleActivity(workouts: LoggedWorkout[]): MuscleActivity[] {
  return workouts.flatMap((w) => w.moves.flatMap((m) => (m.muscle && m.sets.length ? [{
    id: m.muscle, date: w.date, sessionId: w.id,
    volume: volumeOf(m.sets), sets: m.sets.length, seconds: m.sets.reduce((sum, s) => sum + s.seconds, 0),
  }] : [])));
}

/** 每个动作（LoggedMove.key）归入的主要肌群；统计页用它把动作表现挂到肌群下 */
export function exerciseMuscles(workouts: LoggedWorkout[]): Record<string, MuscleId> {
  const out: Record<string, MuscleId> = {};
  for (const w of workouts) for (const m of w.moves) if (m.muscle && m.sets.length && !out[m.key]) out[m.key] = m.muscle;
  return out;
}

/**
 * 动作表现：PR 对 1–15 次的负重组取最高估算 1RM（单次用实举重量，其余 重量 × (1 + 次数 / 30)）；
 * 8–12 RM、12–15 RM 取对应次数范围内实际完成的最重一组，12 次计入两档。从最近一节往前看，同值时保留较近的一组。
 */
export function exercisePerformance(workouts: LoggedWorkout[]): ExercisePerformance[] {
  const ordered = [...workouts].sort((a, b) => b.date.localeCompare(a.date) || b.startedAt.localeCompare(a.startedAt) || b.id - a.id);
  const exercises = new Map<string, ExercisePerformance>();
  const sessionsByExercise = new Map<string, Map<number, ExercisePerformance['sessions'][number]>>();
  for (const w of ordered) {
    for (const m of [...w.moves].reverse()) {
      for (const { weight, reps } of [...m.sets].reverse()) {
        let exercise = exercises.get(m.key);
        let sessions = sessionsByExercise.get(m.key);
        if (!exercise || !sessions) {
          exercise = { id: m.key, name: m.name, image: m.image, pr: null, growth: null, endurance: null, sessions: [] };
          exercises.set(m.key, exercise);
          sessions = new Map();
          sessionsByExercise.set(m.key, sessions);
        }
        let session = sessions.get(w.id);
        if (!session) {
          session = { id: w.id, date: w.date, pr: null, growth: null, endurance: null, weights: {} };
          sessions.set(w.id, session);
          exercise.sessions.push(session);
        }
        if (reps > 0) session.weights[reps] = Math.max(session.weights[reps] ?? 0, weight);
        if (reps <= 0 || reps > 15) continue;
        if (weight > 0) {
          const estimate = reps === 1 ? weight : weight * (1 + reps / 30);
          const best = { value: estimate, weight, reps, date: w.date };
          if (exercise.pr === null || estimate > exercise.pr.value) exercise.pr = best;
          if (session.pr === null || estimate > session.pr.value) session.pr = best;
        }
        if (reps >= 8 && reps <= 12) {
          const best = { value: weight, weight, reps, date: w.date };
          if (!exercise.growth || weight > exercise.growth.value) exercise.growth = best;
          if (!session.growth || weight > session.growth.value) session.growth = best;
        }
        if (reps >= 12) {
          const best = { value: weight, weight, reps, date: w.date };
          if (!exercise.endurance || weight > exercise.endurance.value) exercise.endurance = best;
          if (!session.endurance || weight > session.endurance.value) session.endurance = best;
        }
      }
    }
  }
  return [...exercises.values()];
}
