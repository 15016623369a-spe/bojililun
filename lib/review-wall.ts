import type { DatabaseSync } from 'node:sqlite';
import { exportJournal } from './export';
import { addDays } from './period';
import { ACTIVITY, GOAL, bmr as mifflin, suggestedMacros, type ActivityKey, type GoalKey } from './nutrition';
import { daySessions, primaryMuscleActivity, trainingTimeByDate } from './core/workout';
import { getProfileRow } from './core/meals';
import { dayExerciseBurn } from './exercise-burn';
import type { MuscleId } from './muscles';

/**
 * 回顾页「数据块墙」的数据。区间都截止到今天：7 天、30 天，以及最近 12 个自然月（「1 年」）。
 * 口径：
 * - 容量、组数、摄入、晨重沿用手账（exportJournal），和原来的回顾页一致；
 * - 训练时长、肌群分布、个人纪录沿用统计页的训练表口径（trainingTimeByDate、primaryMuscleActivity、估算 1RM）；
 * - 基础代谢用 Mifflin-St Jeor，体重取当天或之前最近一次称重；每日总代谢 = 基础代谢 × 活动系数，
 *   和「我的」算目标热量是同一个数（用户 11 月 23 日确认）；热量缺口 = 每日总代谢 − 当天摄入。
 *   运动消耗只在「能量收支」里作参考，不再叠加进总代谢，避免和活动系数重复计算。
 */

export type WallDay = {
  date: string;
  /** 实练组「重量 × 次数」之和，kg */
  volume: number;
  sets: number;
  trained: boolean;
  /** 训练页记下的训练时长，分钟 */
  minutes: number;
  /** 没记饮食的日子为 null，不按 0 算 */
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** 运动消耗粗估，kcal */
  burn: number;
  /** 当天第一次称重 */
  weight: number | null;
  bmr: number | null;
  tdee: number | null;
  /** 算基础代谢用的体重：当天或之前最近一次称重，没有就用「我的」里的体重 */
  bmrWeight: number | null;
};

export type PrEvent = { date: string; id: string; name: string; value: number; weight: number; reps: number; prev: number };
export type PrPoint = { date: string; value: number; pr: boolean };
export type MuscleSets = { id: MuscleId; sets: number; volume: number };
export type TopExercise = { name: string; volume: number };
export type RangeKey = 'd7' | 'd30' | 'y1';

export type WallProfile = {
  sex: 'male' | 'female';
  age: number;
  height: number;
  /** 「我的」里填的体重；没有称重记录时用它 */
  weight: number;
  activity: ActivityKey;
  activityLabel: string;
  activityDesc: string;
  factor: number;
  goal: GoalKey;
  goalLabel: string;
  targetKcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type HeroPeriod = 'day' | 'week' | 'month';
export type HeroBar = { key: string; label: string; pick: string; value: number; future: boolean };
export type WallHero = {
  period: HeroPeriod;
  title: string;
  bars: HeroBar[];
  /** 默认高亮的那一根（今天）；日视图没有 */
  sel: number;
  total: number;
  pill: string | null;
  reads: { value: number; dec: number; unit: string; label: string }[];
  statsHref: string;
};

export type WallData = {
  today: string;
  days: WallDay[];
  prs: PrEvent[];
  prHistory: Record<string, { name: string; points: PrPoint[] }>;
  muscles: Record<RangeKey, MuscleSets[]>;
  topExercises: Record<RangeKey, TopExercise[]>;
  profile: WallProfile | null;
  /** 热量缺口建议区，随训练目标变化；负数表示盈余 */
  band: [number, number];
};

/** 每天的回顾页只截到今天；「1 年」从 11 个月前的 1 号开始，正好 12 个自然月 */
export function wallStart(today: string) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 11;
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toISOString().slice(0, 10);
}

const BAND: Record<GoalKey, [number, number]> = { cut: [400, 1000], maintain: [-200, 200], bulk: [-400, -150] };
const e1rm = (weight: number, reps: number) => (reps === 1 ? weight : weight * (1 + reps / 30));
const round1 = (n: number) => Math.round(n * 10) / 10;

function readProfile(): WallProfile | null {
  const row = getProfileRow();
  if (!row) return null;
  const sex = row.sex === 'male' || row.sex === 'female' ? row.sex : null;
  const activity = (row.activity in ACTIVITY ? row.activity : 'moderate') as ActivityKey;
  const goal = (row.goal in GOAL ? row.goal : 'maintain') as GoalKey;
  if (!sex || !(row.age > 0) || !(row.height_cm > 0) || !(row.weight_kg > 0) || !(row.target_kcal > 0)) return null;
  const macros = suggestedMacros(row.target_kcal, row.target_protein);
  return {
    sex, age: row.age, height: row.height_cm, weight: row.weight_kg,
    activity, activityLabel: ACTIVITY[activity].label, activityDesc: ACTIVITY[activity].desc, factor: ACTIVITY[activity].factor,
    goal, goalLabel: GOAL[goal].label,
    targetKcal: row.target_kcal, protein: macros.protein, carbs: macros.carb, fat: macros.fat,
  };
}

/** 个人纪录突破：同一动作每节训练取最高估算 1RM，超过此前所有训练的最高值记一次；第一次练只记基线 */
function prTimeline(db: DatabaseSync, from: string, today: string) {
  const rows = db.prepare(`
    SELECT s.exercise_id AS id, s.exercise_name AS name, s.weight, s.reps, se.date, se.id AS sessionId
    FROM session_set s JOIN session se ON se.id = s.session_id
    WHERE se.date <= ? AND s.weight > 0 AND s.reps BETWEEN 1 AND 15
    ORDER BY se.date, se.started_at, se.id, s.id
  `).all(today) as { id: string; name: string; weight: number; reps: number; date: string; sessionId: number }[];
  const sessions = new Map<string, { id: string; name: string; date: string; value: number; weight: number; reps: number }>();
  const order: string[] = [];
  for (const r of rows) {
    const key = `${r.id}:${r.sessionId}`;
    const value = e1rm(r.weight, r.reps);
    const cur = sessions.get(key);
    if (!cur) { sessions.set(key, { id: r.id, name: r.name, date: r.date, value, weight: r.weight, reps: r.reps }); order.push(key); }
    else if (value > cur.value) Object.assign(cur, { value, weight: r.weight, reps: r.reps });
  }
  const best = new Map<string, number>();
  const events: PrEvent[] = [];
  const history: WallData['prHistory'] = {};
  for (const key of order) {
    const s = sessions.get(key)!;
    const prev = best.get(s.id);
    const value = round1(s.value);
    const pr = prev !== undefined && value > prev;
    if (pr && s.date >= from) events.push({ date: s.date, id: s.id, name: s.name, value, weight: s.weight, reps: s.reps, prev: prev! });
    if (prev === undefined || value > prev) best.set(s.id, value);
    (history[s.id] ??= { name: s.name, points: [] }).points.push({ date: s.date, value, pr });
  }
  // 只留这一年里有突破的动作，曲线保留最近 16 节
  const keep = new Set(events.map((e) => e.id));
  for (const id of Object.keys(history)) {
    if (!keep.has(id)) delete history[id];
    else history[id].points = history[id].points.slice(-16);
  }
  return { events, history };
}

function muscleSets(start: string, end: string): MuscleSets[] {
  const out = new Map<MuscleId, MuscleSets>();
  for (const row of primaryMuscleActivity(start, end)) {
    const cur = out.get(row.id) ?? { id: row.id, sets: 0, volume: 0 };
    cur.sets += row.sets;
    cur.volume += row.volume || 0;
    out.set(row.id, cur);
  }
  return [...out.values()].map((m) => ({ ...m, volume: Math.round(m.volume) })).sort((a, b) => b.sets - a.sets || b.volume - a.volume);
}

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const weekday = (date: string) => `周${WEEK[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]}`;
const short = (date: string) => `${date.slice(5, 7)}.${date.slice(8)}`;

function timeRead(min: number) {
  return min >= 60 ? { value: Math.round(min / 6) / 10, dec: 1, unit: '小时', label: '训练时长' } : { value: Math.round(min), dec: 0, unit: '分钟', label: '训练时长' };
}

/** 主块：本日 / 本周 / 本月的容量。对比取上一周期的同样天数（「同期」），整周期结束后直接比上一周期 */
function buildHero(period: HeroPeriod, today: string, days: WallDay[], todayMoves: { name: string; sets: number; volume: number }[]): WallHero {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const statsHref = `/stats?period=${period === 'month' ? 'month' : 'week'}`;
  if (period === 'day') {
    const d = byDate.get(today);
    const sets = d?.sets ?? 0;
    return {
      period, title: '今日训练容量', statsHref, sel: -1,
      bars: todayMoves.map((m, i) => ({ key: `${i}`, label: m.name, pick: `${m.name} · ${m.sets} 组`, value: m.volume, future: false })),
      total: d?.volume ?? 0,
      pill: todayMoves.length ? `${todayMoves.length} 个动作` : null,
      reads: [{ value: todayMoves.length, dec: 0, unit: '个', label: '动作' }, { value: sets, dec: 0, unit: '组', label: '完成组数' }, timeRead(d?.minutes ?? 0)],
    };
  }
  const start = period === 'week' ? addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)) : `${today.slice(0, 7)}-01`;
  const end = period === 'week' ? addDays(start, 6) : new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  const past = dates.filter((d) => d <= today).map((d) => byDate.get(d)).filter((d): d is WallDay => Boolean(d));
  const total = past.reduce((s, d) => s + d.volume, 0);
  const elapsed = past.length;
  const prevStart = period === 'week' ? addDays(start, -7)
    : new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  const prevEndFull = addDays(start, -1);
  const prevEnd = addDays(prevStart, elapsed - 1) < prevEndFull ? addDays(prevStart, elapsed - 1) : prevEndFull;
  const prev = days.filter((d) => d.date >= prevStart && d.date <= prevEnd).reduce((s, d) => s + d.volume, 0);
  const word = period === 'week' ? '上周' : '上月';
  const complete = today === end;
  const pct = prev > 0 ? Math.round(((total - prev) / prev) * 100) : null;
  const pill = pct === null ? null : `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct)}% 较${word}${complete ? '' : '同期'}`;
  return {
    period, title: period === 'week' ? '本周训练容量' : '本月训练容量', statsHref, sel: dates.indexOf(today),
    bars: dates.map((date) => {
      const day = Number(date.slice(8));
      const label = period === 'week' ? weekday(date) : [1, 8, 15, 22, 29].includes(day) ? String(day) : '';
      return { key: date, label, pick: `${weekday(date)} · ${short(date)}`, value: byDate.get(date)?.volume ?? 0, future: date > today };
    }),
    total,
    pill,
    reads: [
      { value: past.filter((d) => d.trained || d.volume > 0).length, dec: 0, unit: '天', label: '训练天数' },
      { value: past.reduce((s, d) => s + d.sets, 0), dec: 0, unit: '组', label: '完成组数' },
      timeRead(past.reduce((s, d) => s + d.minutes, 0)),
    ],
  };
}

export function buildReviewWall(db: DatabaseSync, today: string, period: HeroPeriod = 'week'): { wall: WallData; hero: WallHero } {
  const start = wallStart(today);
  const book = exportJournal(db, 'local', start, today);
  const profile = readProfile();

  // 每天的体重：当天或之前最近一次称重，用来算当天的基础代谢
  const weighIns = db.prepare('SELECT date, weight_kg FROM body_metrics WHERE user_id = ? AND date <= ? ORDER BY date, logged_at, id')
    .all('local', today) as { date: string; weight_kg: number }[];
  const sessionDates = new Set((db.prepare(`SELECT DISTINCT se.date FROM session se WHERE se.date BETWEEN ? AND ?
    AND EXISTS (SELECT 1 FROM session_set WHERE session_id = se.id)`).all(start, today) as { date: string }[]).map((r) => r.date));
  const minutes = new Map(trainingTimeByDate(start, today).map((r) => [r.date, r.seconds / 60]));
  const burnWeight = profile?.weight ?? 70;

  let wi = 0;
  let lastWeight: number | null = null;
  const days: WallDay[] = book.days.map((d) => {
    while (wi < weighIns.length && weighIns[wi].date <= d.date) lastWeight = weighIns[wi++].weight_kg;
    const meals = d.entries.filter((e) => e.entry_type === 'meal');
    const workouts = d.entries.filter((e) => e.entry_type === 'workout');
    const intake = d.daily_summary.intake;
    const morning = [...d.body_metrics].sort((a, b) => Date.parse(a.logged_at) - Date.parse(b.logged_at))[0];
    const bodyWeight = profile ? lastWeight ?? profile.weight : null;
    const base = profile && bodyWeight ? mifflin({ sex: profile.sex, age: profile.age, height_cm: profile.height, weight_kg: bodyWeight }) : null;
    const burn = workouts.length || sessionDates.has(d.date)
      ? dayExerciseBurn(daySessions(d.date).filter((x) => x.sets.length > 0).map((x) => x.session), d.entries, burnWeight).kcal
      : 0;
    return {
      date: d.date,
      volume: Math.round(d.daily_summary.totalVolumeKg),
      sets: d.daily_summary.totalSets,
      trained: workouts.length > 0,
      minutes: Math.round(minutes.get(d.date) ?? 0),
      kcal: meals.length && intake.kcal !== null ? Math.round(intake.kcal) : null,
      protein: meals.length && intake.protein_g !== null ? round1(intake.protein_g) : null,
      carbs: meals.length && intake.carbs_g !== null ? round1(intake.carbs_g) : null,
      fat: meals.length && intake.fat_g !== null ? round1(intake.fat_g) : null,
      burn,
      weight: morning ? morning.weight_kg : null,
      bmr: base,
      tdee: base === null || !profile ? null : Math.round(base * profile.factor),
      bmrWeight: bodyWeight,
    };
  });

  // 容量最高的动作：手账里实练组「重量 × 次数」累计
  const top = (from: string): TopExercise[] => {
    const sums = new Map<string, number>();
    for (const d of book.days) {
      if (d.date < from) continue;
      for (const e of d.entries) {
        if (e.entry_type !== 'workout') continue;
        for (const m of e.exercises) {
          const v = m.sets.reduce((s, x) => s + (x.weight_kg ?? 0) * (x.reps ?? 0), 0);
          if (v > 0) sums.set(m.exercise_name, (sums.get(m.exercise_name) ?? 0) + v);
        }
      }
    }
    return [...sums].map(([name, volume]) => ({ name, volume: Math.round(volume) })).sort((a, b) => b.volume - a.volume).slice(0, 5);
  };

  const d7 = addDays(today, -6), d30 = addDays(today, -29);
  const { events, history } = prTimeline(db, start, today);

  // 日视图的柱子：今天每个动作一根
  const moves = new Map<string, { name: string; sets: number; volume: number }>();
  for (const e of book.days.at(-1)?.entries ?? []) {
    if (e.entry_type !== 'workout') continue;
    for (const m of e.exercises) {
      if (!m.sets.length) continue;
      const cur = moves.get(m.exercise_name) ?? { name: m.exercise_name, sets: 0, volume: 0 };
      cur.sets += m.sets.length;
      cur.volume += Math.round(m.sets.reduce((s, x) => s + (x.weight_kg ?? 0) * (x.reps ?? 0), 0));
      moves.set(m.exercise_name, cur);
    }
  }
  const hero = buildHero(period, today, days, [...moves.values()]);

  return { hero, wall: {
    today,
    days,
    prs: events,
    prHistory: history,
    muscles: { d7: muscleSets(d7, today), d30: muscleSets(d30, today), y1: muscleSets(start, today) },
    topExercises: { d7: top(d7), d30: top(d30), y1: top(start) },
    profile,
    band: BAND[profile?.goal ?? 'maintain'],
  } };
}
