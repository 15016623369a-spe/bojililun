import type { DatabaseSync } from 'node:sqlite';
import { exportJournal } from './export';
import { addDays } from './period';
import { ACTIVITY, GOAL, bmr as mifflin, suggestedMacros, type ActivityKey, type GoalKey } from './nutrition';
import { daySessions } from './core/workout';
import { muscleActivity, trainingLog, trainingTimeByDay, type LoggedWorkout } from './training-log';
import { getProfileRow } from './core/meals';
import { dayExerciseBurn } from './exercise-burn';
import { calcMealTotals } from './calculations';
import type { MuscleId } from './muscles';

/**
 * 回顾页「数据块墙」的数据。区间都截止到今天：7 天、30 天，以及最近 12 个自然月（「1 年」）。
 * 口径：
 * - 训练（容量、组数、训练天数、时长、肌群分布、个人纪录、容量最高的动作）和训练统计共用 lib/training-log.ts，
 *   只读手账：训练页的训练和语音、文字记的训练都算，每节只算一次；
 * - 摄入、晨重沿用手账（exportJournal），和原来的回顾页一致；
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

/** 今天记下的一餐：「今日饮食」块和抽屉里列出来，点开回到记录页那张卡 */
export type WallMeal = { id: number; title: string; time: string; kcal: number | null; items: string };

export type WallData = {
  today: string;
  days: WallDay[];
  /** 近 30 天每天的每一餐（按时间先后），「饮食」抽屉里点哪天就列哪天 */
  mealsByDay: Record<string, WallMeal[]>;
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
function prTimeline(all: LoggedWorkout[], from: string) {
  const sessions = new Map<string, { id: string; name: string; date: string; value: number; weight: number; reps: number }>();
  const order: string[] = [];
  const ordered = [...all].sort((a, b) => a.date.localeCompare(b.date) || a.startedAt.localeCompare(b.startedAt) || a.id - b.id);
  for (const w of ordered) for (const m of w.moves) for (const { weight, reps } of m.sets) {
    if (!(weight > 0) || reps < 1 || reps > 15) continue;
    const key = `${m.key}:${w.id}`;
    const value = e1rm(weight, reps);
    const cur = sessions.get(key);
    if (!cur) { sessions.set(key, { id: m.key, name: m.name, date: w.date, value, weight, reps }); order.push(key); }
    else if (value > cur.value) Object.assign(cur, { value, weight, reps });
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

function muscleSets(workouts: LoggedWorkout[]): MuscleSets[] {
  const out = new Map<MuscleId, MuscleSets>();
  for (const row of muscleActivity(workouts)) {
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
  // 训练和统计页同一来源；个人纪录要和此前所有训练比，所以从头读
  const history = trainingLog(db, '0000-01-01', today);
  const log = history.filter((w) => w.date >= start);
  const training = new Map<string, { volume: number; sets: number; sessions: Set<number> }>();
  for (const w of log) {
    const day = training.get(w.date) ?? { volume: 0, sets: 0, sessions: new Set<number>() };
    for (const m of w.moves) for (const s of m.sets) { day.volume += s.weight * s.reps; day.sets += 1; }
    if (w.sessionId !== null) day.sessions.add(w.sessionId);
    training.set(w.date, day);
  }
  const minutes = new Map(trainingTimeByDay(log).map((r) => [r.date, r.seconds / 60]));
  const burnWeight = profile?.weight ?? 70;

  let wi = 0;
  let lastWeight: number | null = null;
  const days: WallDay[] = book.days.map((d) => {
    while (wi < weighIns.length && weighIns[wi].date <= d.date) lastWeight = weighIns[wi++].weight_kg;
    const meals = d.entries.filter((e) => e.entry_type === 'meal');
    const trained = training.get(d.date);
    const intake = d.daily_summary.intake;
    const morning = [...d.body_metrics].sort((a, b) => Date.parse(a.logged_at) - Date.parse(b.logged_at))[0];
    const bodyWeight = profile ? lastWeight ?? profile.weight : null;
    const base = profile && bodyWeight ? mifflin({ sex: profile.sex, age: profile.age, height_cm: profile.height, weight_kg: bodyWeight }) : null;
    // 运动消耗只估算这两页算进来的训练：「记录」里移除的训练页训练不再计入
    const burn = trained
      ? dayExerciseBurn(daySessions(d.date).filter((x) => x.sets.length > 0 && trained.sessions.has(x.session.id)).map((x) => x.session), d.entries, burnWeight).kcal
      : 0;
    return {
      date: d.date,
      volume: Math.round(trained?.volume ?? 0),
      sets: trained?.sets ?? 0,
      trained: Boolean(trained),
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

  // 容量最高的动作：实练组「重量 × 次数」累计
  const top = (from: string): TopExercise[] => {
    const sums = new Map<string, { name: string; volume: number }>();
    for (const w of log) {
      if (w.date < from) continue;
      for (const m of w.moves) {
        const v = m.sets.reduce((s, x) => s + x.weight * x.reps, 0);
        if (v > 0) sums.set(m.key, { name: sums.get(m.key)?.name ?? m.name, volume: (sums.get(m.key)?.volume ?? 0) + v });
      }
    }
    return [...sums.values()].map(({ name, volume }) => ({ name, volume: Math.round(volume) })).sort((a, b) => b.volume - a.volume).slice(0, 5);
  };

  const d7 = addDays(today, -6), d30 = addDays(today, -29);
  const prs = prTimeline(history, start);

  // 日视图的柱子：今天每个动作一根
  const moves = new Map<string, { name: string; sets: number; volume: number }>();
  for (const w of log) {
    if (w.date !== today) continue;
    for (const m of w.moves) {
      if (!m.sets.length) continue;
      const cur = moves.get(m.key) ?? { name: m.name, sets: 0, volume: 0 };
      cur.sets += m.sets.length;
      cur.volume += Math.round(m.sets.reduce((s, x) => s + x.weight * x.reps, 0));
      moves.set(m.key, cur);
    }
  }
  const hero = buildHero(period, today, days, [...moves.values()]);

  // 近 30 天每天的每一餐（原来在训练页「今日营养」下面，11 月 24 日挪到回顾；抽屉里点哪天列哪天）
  const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: process.env.APP_TZ || 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const mealsByDay: Record<string, WallMeal[]> = {};
  for (const day of book.days) {
    if (day.date < d30) continue;
    const list = day.entries
      .filter((c) => c.entry_type === 'meal')
      .sort((a, b) => Date.parse(a.logged_at) - Date.parse(b.logged_at))
      .map((c) => {
        const kcal = calcMealTotals(c.items).kcal;
        return {
          id: c.id, title: c.summary_title, time: clock.format(new Date(c.logged_at)),
          kcal: kcal === null || kcal === undefined ? null : Math.round(kcal),
          items: c.items.map((i) => [i.food_name, i.portion_text].filter(Boolean).join(' ')).join('、'),
        };
      });
    if (list.length) mealsByDay[day.date] = list;
  }

  return { hero, wall: {
    today,
    days,
    mealsByDay,
    prs: prs.events,
    prHistory: prs.history,
    muscles: { d7: muscleSets(log.filter((w) => w.date >= d7)), d30: muscleSets(log.filter((w) => w.date >= d30)), y1: muscleSets(log) },
    topExercises: { d7: top(d7), d30: top(d30), y1: top(start) },
    profile,
    band: BAND[profile?.goal ?? 'maintain'],
  } };
}
