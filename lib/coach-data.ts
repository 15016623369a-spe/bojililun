import type { DatabaseSync } from 'node:sqlite';
import dictionary from '../data/exercises-seed.json';
import { RANGE_WORD, avg, bucketsOf, fmt, present } from '../components/review/wall-utils';
import type { CoachChart, CoachProgressChart, CoachSeriesChart } from './coach-types';
import { getExercisePreferences } from './core/exercise-preferences';
import { getTrainingProfile } from './core/training-profile';
import { constraintRulesFor } from './exercise-constraints';
import { listMemories } from './memory';
import { MUSCLES, type Region } from './muscles';
import { GOAL, calcTargets, suggestedMacros, type GoalKey } from './nutrition';
import { addDays } from './period';
import { buildReviewWall, wallStart, type RangeKey, type WallData, type WallDay } from './review-wall';
import { exercisePerformance, muscleActivity, trainingLog, trainingTotals } from './training-log';
import { TRAINING_GOALS, type TrainingGoal } from './training-goals';

/**
 * 教练的数据工具。每个数字都用回顾和训练统计同一套计算（lib/review-wall.ts、lib/training-log.ts、lib/nutrition.ts），
 * 教练说的和页面上显示的一致；有模型时模型按需调用这些工具，只负责解读，没有模型时按同样的数据套本地模板回答。
 * 区间和回顾抽屉一样：近 7 天、近 30 天，「1 年」是最近 12 个自然月（图按月取平均）。
 */

export type CoachRange = RangeKey;
export const COACH_RANGES: CoachRange[] = ['d7', 'd30', 'y1'];

type Tool<F> = { facts: F; chart: CoachChart | null };
type Unavailable = { available: false; missing: string };

const NEED_PROFILE = '「我的」里的性别、年龄、身高、体重和活动量';
const round1 = (n: number) => Math.round(n * 10) / 10;
const signed = (n: number, dec = 0) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(Math.abs(n), dec)}`;
const dateWord = (date: string) => `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日`;

function windowDays(wall: WallData, range: CoachRange): WallDay[] {
  return range === 'y1' ? wall.days : wall.days.slice(range === 'd7' ? -7 : -30);
}

function rangeStart(today: string, range: CoachRange) {
  return range === 'y1' ? wallStart(today) : addDays(today, range === 'd7' ? -6 : -29);
}

/** 柱状图、折线的横轴：和回顾抽屉一样，7 天和 30 天每天一格，1 年每月一格 */
function axis(wall: WallData, range: CoachRange) {
  const buckets = bucketsOf(wall.days, range);
  return { buckets, labels: buckets.map((b) => b.label), picks: buckets.map((b) => b.pick) };
}

const lastIndex = (values: (number | null)[]) => values.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);

/* ---------------- 问句里的区间和目标 ---------------- */

/** 「最近这一段时间」按 30 天，「这周」按 7 天，「今年 / 半年」按 12 个月 */
export function rangeIn(question: string, fallback: CoachRange): CoachRange {
  if (/今年|一年|全年|12\s*个月|十二个月|半年|几个月|长期/.test(question)) return 'y1';
  if (/这周|本周|这一周|一周|7\s*天|七天|这几天|最近几天/.test(question)) return 'd7';
  if (/这个月|本月|一个月|30\s*天|三十天|一段时间|这段时间|最近/.test(question)) return 'd30';
  return fallback;
}

const CUT_WORD = /减脂|减肥|减重|刷脂|瘦身|控制体重|掉秤/;
const BULK_WORD = /增肌|增重|长肌肉|练大|变壮/;

/** 问句里明确说的营养目标；没说为 null */
export function goalMentioned(question: string): GoalKey | null {
  if (CUT_WORD.test(question)) return 'cut';
  if (BULK_WORD.test(question)) return 'bulk';
  if (/维持|保持体重|不胖不瘦/.test(question)) return 'maintain';
  return null;
}

/** 营养目标：问句里说了就按问句，否则按「我的」 */
export function goalIn(question: string, fallback: GoalKey): GoalKey {
  return goalMentioned(question) ?? fallback;
}

/* ---------------- 代谢 ---------------- */

type WeightSource = { kind: 'weighIn'; date: string } | { kind: 'older' } | { kind: 'profile' };
export type MetabolismFacts = Unavailable | {
  available: true;
  range: string;
  today: { date: string; bmr: number; tdee: number; weight: number };
  weightSource: WeightSource;
  formula: string;
  person: { sex: '男' | '女'; age: number; height: number };
  activity: { label: string; desc: string; factor: number };
  average: { bmr: number; tdee: number };
  start: { date: string; bmr: number; weight: number };
  change: { bmr: number; weight: number };
  weighIns: number;
  rule: string;
};

export function metabolism(wall: WallData, range: CoachRange): Tool<MetabolismFacts> {
  const p = wall.profile;
  const today = wall.days.at(-1);
  if (!p || !today || today.bmr === null || today.tdee === null || today.bmrWeight === null) {
    return { facts: { available: false, missing: NEED_PROFILE }, chart: null };
  }
  const days = windowDays(wall, range);
  const first = days.find((d) => d.bmr !== null && d.bmrWeight !== null) ?? today;
  const lastWeigh = wall.days.findLast((d) => d.weight !== null);
  const weightSource: WeightSource = lastWeigh ? { kind: 'weighIn', date: lastWeigh.date }
    : today.bmrWeight !== p.weight ? { kind: 'older' } : { kind: 'profile' };
  const facts: MetabolismFacts = {
    available: true,
    range: RANGE_WORD[range],
    today: { date: today.date, bmr: today.bmr, tdee: today.tdee, weight: today.bmrWeight },
    weightSource,
    formula: `10 × ${today.bmrWeight} + 6.25 × ${p.height} − 5 × ${p.age} ${p.sex === 'male' ? '+ 5' : '− 161'}`,
    person: { sex: p.sex === 'male' ? '男' : '女', age: p.age, height: p.height },
    activity: { label: p.activityLabel, desc: p.activityDesc, factor: p.factor },
    average: { bmr: Math.round(avg(present(days.map((d) => d.bmr)))), tdee: Math.round(avg(present(days.map((d) => d.tdee)))) },
    start: { date: first.date, bmr: first.bmr!, weight: first.bmrWeight! },
    change: { bmr: today.bmr - first.bmr!, weight: round1(today.bmrWeight - first.bmrWeight!) },
    weighIns: days.filter((d) => d.weight !== null).length,
    rule: 'Mifflin-St Jeor；体重取当天或之前最近一次称重，没有称重用「我的」里的体重。每日总代谢 = 基础代谢 × 活动系数，训练已算在活动系数里，不再叠加运动消耗',
  };
  const { buckets, labels, picks } = axis(wall, range);
  const mean = (vals: (number | null)[], dec = 0) => {
    const v = present(vals);
    return v.length ? (dec ? round1(avg(v)) : Math.round(avg(v))) : null;
  };
  const chart: CoachSeriesChart = {
    id: `metabolism-${range}`, kind: 'line', tone: 'mist', title: `${RANGE_WORD[range]} · 代谢与体重`,
    labels, picks,
    series: [
      { key: 'bmr', name: '基础代谢', unit: 'kcal', dec: 0, values: buckets.map((b) => mean(b.days.map((d) => d.bmr))) },
      { key: 'tdee', name: '每日总代谢', unit: 'kcal', dec: 0, values: buckets.map((b) => mean(b.days.map((d) => d.tdee))) },
      { key: 'weight', name: '晨重', unit: 'kg', dec: 1, values: buckets.map((b) => mean(b.days.map((d) => d.weight), 1)) },
    ],
    note: `每日总代谢 = 基础代谢 × ${p.factor}（${p.activityLabel}）。体重每变 1 kg，基础代谢约变 10 kcal。`,
  };
  return { facts, chart };
}

export function metabolismReply(f: MetabolismFacts, question: string) {
  if (!f.available) return `算基础代谢需要${f.missing}。补全后我就按你的称重算出来，还能画出它随体重的变化。`;
  const src = f.weightSource.kind === 'weighIn' ? ` ${dateWord(f.weightSource.date)}称的体重 ${f.today.weight} kg`
    : f.weightSource.kind === 'older' ? `最近一次称的体重 ${f.today.weight} kg` : `「我的」里的体重 ${f.today.weight} kg（还没有称重记录）`;
  const lead = `${f.range}你的基础代谢平均 ${fmt(f.average.bmr)} kcal，今天是 ${fmt(f.today.bmr)} kcal：按${src}、身高 ${f.person.height} cm、${f.person.age} 岁${f.person.sex}性，用 Mifflin-St Jeor 公式 ${f.formula} ≈ ${fmt(f.today.bmr)}。`;
  const total = `每日总代谢 = 基础代谢 × ${f.activity.factor}（${f.activity.label} · ${f.activity.desc}）≈ ${fmt(f.today.tdee)} kcal，训练已经算在活动系数里，不再另加。`;
  const change = f.change.weight !== 0
    ? `这段时间体重从 ${f.start.weight} kg 到 ${f.today.weight} kg（${signed(f.change.weight, 1)} kg），基础代谢跟着${f.change.bmr >= 0 ? '多了' : '少了'} ${fmt(Math.abs(f.change.bmr))} kcal。体重每变 1 kg，基础代谢约变 10 kcal，所以它短期内不会大起大落。`
    : f.weighIns ? '这段时间体重基本没变，基础代谢也稳定。' : '这段时间没有新的称重，基础代谢没变；记下晨重后会按实际体重更新。';
  return /体重|晨重|称重|掉秤|胖了|瘦了/.test(question) ? [change, lead, total].join('\n') : [lead, total, change].join('\n');
}

/* ---------------- 热量缺口与摄入 ---------------- */

export type EnergyFacts = Unavailable | {
  available: true;
  range: string;
  goal: string;
  goalKey: GoalKey;
  band: [number, number];
  bandText: string;
  loggedDays: number;
  days: number;
  average: { intake: number; tdee: number; deficit: number } | null;
  daysInBand: number;
  today: { intake: number; tdee: number; deficit: number; partial: true } | null;
  macros: { target: { kcal: number; protein: number; carbs: number; fat: number }; average: { protein: number; carbs: number; fat: number } | null; completion: { protein: number; carbs: number; fat: number } | null };
  rule: string;
};

function bandText(goal: GoalKey, [lo, hi]: [number, number]) {
  return goal === 'bulk' ? `盈余 ${-hi}–${-lo} kcal` : goal === 'maintain' ? `±${hi} kcal` : `缺口 ${lo}–${hi} kcal`;
}

export function energy(wall: WallData, range: CoachRange): Tool<EnergyFacts> {
  const p = wall.profile;
  if (!p) return { facts: { available: false, missing: NEED_PROFILE }, chart: null };
  const days = windowDays(wall, range);
  const logged = days.filter((d) => d.kcal !== null && d.tdee !== null);
  const [lo, hi] = wall.band;
  const gaps = logged.map((d) => d.tdee! - d.kcal!);
  const today = wall.days.at(-1)!;
  const target = { kcal: p.targetKcal, protein: p.protein, carbs: p.carbs, fat: p.fat };
  const mean = (key: 'protein' | 'carbs' | 'fat') => round1(avg(logged.map((d) => d[key] ?? 0)));
  // 完成度和回顾「三大营养完成度」同一算法：每天的完成率再取平均
  const rate = (key: 'protein' | 'carbs' | 'fat') => Math.round(avg(logged.map((d) => (d[key] ?? 0) / target[key])) * 100);
  const facts: EnergyFacts = {
    available: true,
    range: RANGE_WORD[range],
    goal: p.goalLabel,
    goalKey: p.goal,
    band: wall.band,
    bandText: bandText(p.goal, wall.band),
    loggedDays: logged.length,
    days: days.length,
    average: logged.length ? {
      intake: Math.round(avg(logged.map((d) => d.kcal!))),
      tdee: Math.round(avg(logged.map((d) => d.tdee!))),
      deficit: Math.round(avg(gaps)),
    } : null,
    daysInBand: gaps.filter((g) => g >= lo && g <= hi).length,
    today: today.kcal !== null && today.tdee !== null ? { intake: today.kcal, tdee: today.tdee, deficit: today.tdee - today.kcal, partial: true } : null,
    macros: {
      target,
      average: logged.length ? { protein: mean('protein'), carbs: mean('carbs'), fat: mean('fat') } : null,
      completion: logged.length ? { protein: rate('protein'), carbs: rate('carbs'), fat: rate('fat') } : null,
    },
    rule: '热量缺口 = 每日总代谢 − 当天摄入，没记饮食的日子不计；建议区随训练目标：减脂缺口 400–1000，维持 ±200，增肌盈余 150–400。今天还没过完，只算截至现在',
  };
  if (!logged.length) return { facts, chart: null };
  const { buckets, labels, picks } = axis(wall, range);
  const values = buckets.map((b) => {
    const l = b.days.filter((d) => d.kcal !== null && d.tdee !== null);
    return l.length ? Math.round(avg(l.map((d) => d.tdee! - d.kcal!))) : null;
  });
  const chart: CoachSeriesChart = {
    id: `energy-${range}`, kind: 'bars', tone: 'coral', title: `${RANGE_WORD[range]} · 热量缺口`,
    labels, picks, index: lastIndex(values),
    series: [{ key: 'deficit', name: '热量缺口', unit: 'kcal', dec: 0, values }],
    band: { from: lo, to: hi, label: '建议区' },
    note: `热量缺口 = 每日总代谢 − 摄入，负数是盈余。${p.goalLabel}的建议区：${bandText(p.goal, wall.band)}。`,
  };
  return { facts, chart };
}

export function energyReply(f: EnergyFacts) {
  if (!f.available) return `算热量缺口需要${f.missing}，再加上每天记下吃了什么。`;
  if (!f.average) return `${f.range}还没记饮食，热量缺口没法算。拍照或说一句吃了什么，我就按每日总代谢算出每天的缺口。`;
  const { intake, tdee, deficit } = f.average;
  const [lo, hi] = f.band;
  const judge = deficit >= lo && deficit <= hi ? '平均值在建议区内，节奏合适'
    : f.goalKey === 'bulk' ? (deficit > hi ? '盈余不够，增肌会慢' : '盈余偏多，容易长脂肪')
      : f.goalKey === 'maintain' ? (deficit > hi ? '吃得偏少，体重会往下走' : '吃得偏多，体重会往上走')
        : deficit < lo ? '缺口偏小，体重会降得慢' : '缺口偏大，容易掉肌肉、也难坚持';
  const lines = [
    `${f.range}记了 ${f.loggedDays} 天饮食，平均每天摄入 ${fmt(intake)} kcal，每日总代谢约 ${fmt(tdee)} kcal，平均${deficit >= 0 ? `缺口 ${fmt(deficit)}` : `盈余 ${fmt(-deficit)}`} kcal。`,
    `你的目标是${f.goal}，建议区是${f.bandText}，有 ${f.daysInBand} 天在建议区内；${judge}。`,
  ];
  const c = f.macros.completion;
  if (c) lines.push(`三大营养平均完成度：蛋白 ${c.protein}%、碳水 ${c.carbs}%、脂肪 ${c.fat}%（90%–110% 算达标）。`);
  if (f.today) lines.push(`今天还没过完，截至现在吃了 ${fmt(f.today.intake)} kcal。`);
  return lines.join('\n');
}

/* ---------------- 三大营养目标 ---------------- */

type MacroSplit = { kcal: number; protein: number; carbs: number; fat: number };
export type MacroFacts = Unavailable | {
  available: true;
  goal: string;
  goalKey: GoalKey;
  weight: number;
  bmr: number;
  tdee: number;
  factor: number;
  activity: string;
  /** 目标增减：planned 是目标本来的增减，applied 是实际用的（减脂有下限、未满 18 岁不扣） */
  delta: { planned: number; applied: number };
  floor: number | null;
  minor: boolean;
  targetKcal: number;
  protein: { grams: number; perKg: number; kcal: number };
  fat: { grams: number; share: number; kcal: number };
  carbs: { grams: number; kcal: number };
  /** 过去 7 个完整日子（不含今天）的日均摄入 */
  recent: (MacroSplit & { days: number }) | null;
  profile: MacroSplit & { goal: string; goalKey: GoalKey; weight: number };
  others: (MacroSplit & { goal: string })[];
};

export function macroPlan(db: DatabaseSync, wall: WallData, goal: GoalKey): Tool<MacroFacts> {
  const p = wall.profile;
  const today = wall.days.at(-1);
  if (!p || !today) return { facts: { available: false, missing: NEED_PROFILE }, chart: null };
  const stored = db.prepare('SELECT protein_per_kg FROM profile WHERE id = 1').get() as { protein_per_kg: number } | undefined;
  const weight = today.bmrWeight ?? p.weight;
  // 和「我的」同一个 calcTargets；当前目标沿用「我的」里的蛋白系数，换目标时用那个目标的默认系数
  const perKgOf = (g: GoalKey) => (g === p.goal && stored?.protein_per_kg ? stored.protein_per_kg : GOAL[g].protein);
  const plan = (g: GoalKey) => {
    const t = calcTargets({ name: '我', sex: p.sex, age: p.age, height_cm: p.height, weight_kg: weight, activity: p.activity, goal: g, protein_per_kg: perKgOf(g) });
    const m = suggestedMacros(t.target_kcal, t.target_protein);
    return { ...t, protein: m.protein, carbs: m.carb, fat: m.fat };
  };
  const t = plan(goal);
  const proteinKcal = t.protein * 4;
  const fatKcal = Math.round(t.target_kcal * 0.27);
  const planned = GOAL[goal].delta;
  const minor = planned < 0 && p.age < 18;
  const floor = Math.min(t.tdee, Math.max(t.bmr, p.sex === 'female' ? 1200 : 1500));
  // 今天还没过完，和过去 7 个完整的日子比
  const recentDays = wall.days.slice(-8, -1).filter((d) => d.kcal !== null);
  const mean = (key: 'kcal' | 'protein' | 'carbs' | 'fat') => Math.round(avg(recentDays.map((d) => d[key] ?? 0)));
  const facts: MacroFacts = {
    available: true,
    goal: GOAL[goal].label,
    goalKey: goal,
    weight,
    bmr: t.bmr,
    tdee: t.tdee,
    factor: p.factor,
    activity: p.activityLabel,
    delta: { planned, applied: t.target_kcal - t.tdee },
    floor: planned < 0 && !minor && t.tdee + planned < floor ? floor : null,
    minor,
    targetKcal: t.target_kcal,
    protein: { grams: t.protein, perKg: perKgOf(goal), kcal: proteinKcal },
    fat: { grams: t.fat, share: 0.27, kcal: fatKcal },
    carbs: { grams: t.carbs, kcal: Math.max(0, t.target_kcal - proteinKcal - fatKcal) },
    recent: recentDays.length ? { days: recentDays.length, kcal: mean('kcal'), protein: mean('protein'), carbs: mean('carbs'), fat: mean('fat') } : null,
    profile: { goal: p.goalLabel, goalKey: p.goal, weight: p.weight, kcal: p.targetKcal, protein: p.protein, carbs: p.carbs, fat: p.fat },
    others: (['cut', 'maintain', 'bulk'] as GoalKey[]).filter((g) => g !== goal).map((g) => {
      const o = plan(g);
      return { goal: GOAL[g].label, kcal: o.target_kcal, protein: o.protein, carbs: o.carbs, fat: o.fat };
    }),
  };
  const chart: CoachProgressChart = {
    id: `macros-${goal}`, kind: 'progress', tone: 'lemon', title: `${GOAL[goal].label} · 每天 ${fmt(t.target_kcal)} kcal`,
    valueLabel: facts.recent ? `过去 7 天日均（记了 ${facts.recent.days} 天，不含今天）` : '过去 7 天还没记饮食',
    rows: [
      { key: 'protein', name: '蛋白质', value: facts.recent?.protein ?? null, target: t.protein, unit: 'g' },
      { key: 'carbs', name: '碳水', value: facts.recent?.carbs ?? null, target: t.carbs, unit: 'g' },
      { key: 'fat', name: '脂肪', value: facts.recent?.fat ?? null, target: t.fat, unit: 'g' },
    ],
    note: `蛋白质 ${fmt(perKgOf(goal), 1)} g/kg 优先，脂肪约占 27%，其余给碳水；和「我的」算目标热量同一个公式。`,
  };
  return { facts, chart };
}

export function macroReply(f: MacroFacts, goalAsked: boolean) {
  if (!f.available) return `算三大营养需要${f.missing}。补全后我按你的每日总代谢和目标算出每天的克数。`;
  const delta = f.minor ? '（未满 18 岁不按减脂扣热量）'
    : f.floor !== null ? `减 400 kcal 会低于下限，按下限 ${fmt(f.floor)} kcal 算（不低于基础代谢，也不低于男性 1500 / 女性 1200 kcal）`
      : f.delta.planned < 0 ? `减 ${-f.delta.planned} kcal 缺口` : f.delta.planned > 0 ? `加 ${f.delta.planned} kcal 盈余` : '不增不减';
  const lines = [
    `按${f.goal}算，你每天大约吃 ${fmt(f.targetKcal)} kcal：蛋白质 ${f.protein.grams} g、碳水 ${f.carbs.grams} g、脂肪 ${f.fat.grams} g。`,
    `怎么算的：每日总代谢 ${fmt(f.tdee)} kcal（基础代谢 ${fmt(f.bmr)} × ${f.factor}）${delta}，取整约 ${fmt(f.targetKcal)} kcal；蛋白质按体重 ${f.weight} kg × ${fmt(f.protein.perKg, 1)} g/kg ≈ ${f.protein.grams} g（${fmt(f.protein.kcal)} kcal）；脂肪占总热量 27%，${fmt(f.fat.kcal)} kcal ÷ 9 ≈ ${f.fat.grams} g；剩下 ${fmt(f.carbs.kcal)} kcal 给碳水，÷ 4 ≈ ${f.carbs.grams} g。`,
  ];
  if (f.recent) {
    const gaps = [
      { name: '蛋白质', diff: f.recent.protein - f.protein.grams, rel: (f.recent.protein - f.protein.grams) / f.protein.grams },
      { name: '碳水', diff: f.recent.carbs - f.carbs.grams, rel: (f.recent.carbs - f.carbs.grams) / f.carbs.grams },
      { name: '脂肪', diff: f.recent.fat - f.fat.grams, rel: (f.recent.fat - f.fat.grams) / f.fat.grams },
    ].sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel));
    const top = gaps[0];
    const advice = Math.abs(top.rel) < 0.1 ? '和目标差不多，保持就好'
      : top.name === '蛋白质' && top.diff < 0 ? `蛋白质还差约 ${Math.round(-top.diff)} g，可以每餐多一份瘦肉、鱼虾、蛋奶或豆制品`
        : `${top.name}${top.diff < 0 ? '少了' : '多了'}约 ${Math.round(Math.abs(top.diff))} g，最需要调整`;
    lines.push(`过去 7 天（不含今天）你记了 ${f.recent.days} 天饮食，平均每天 ${fmt(f.recent.kcal)} kcal：蛋白质 ${f.recent.protein} g、碳水 ${f.recent.carbs} g、脂肪 ${f.recent.fat} g，${advice}。`);
  }
  if (f.profile.goalKey !== f.goalKey) {
    const diff = f.targetKcal - f.profile.kcal;
    lines.push(`你在「我的」里的目标是${f.profile.goal}（每天 ${fmt(f.profile.kcal)} kcal），换成${f.goal}每天${diff < 0 ? '少' : '多'}吃 ${fmt(Math.abs(diff))} kcal；要换目标去「我的」改。`);
  } else if (f.profile.kcal !== f.targetKcal) {
    lines.push(`「我的」里存的目标还是按 ${f.profile.weight} kg 算的 ${fmt(f.profile.kcal)} kcal，去「我的」更新体重后会一致。`);
  } else {
    lines.push('这和「我的」里的目标一致。');
  }
  if (!goalAsked) lines.push(`换成${f.others.map((o) => `${o.goal}约 ${fmt(o.kcal)} kcal`).join('、')}。`);
  return lines.join('\n');
}

/* ---------------- 训练分布与建议 ---------------- */

const REGION_ORDER: Region[] = ['胸', '背', '肩', '腿', '手臂', '核心'];
const MAJOR: Region[] = ['胸', '背', '肩', '腿'];
const REGION_OF = new Map<string, Region>(MUSCLES.map((m) => [m.id, m.region]));
export type TrainingFocus = 'muscle' | 'cut' | 'strength';

export type TrainingFacts = {
  range: string;
  totals: { sessions: number; days: number; sets: number; volume: number; durationMin: number };
  daysPerWeek: number;
  regions: { region: Region; sets: number; weeklySets: number; timesPerWeek: number }[];
  weak: Region[];
  repShare6to12: number | null;
  prs: { count: number; list: { date: string; name: string; e1rm: number; prev: number; weight: number; reps: number }[] };
  progress: { name: string; sessions: number; first: number; last: number; best: number }[];
  topExercises: { name: string; volume: number }[];
  goal: string | null;
  constraints: string[];
  avoid: string[];
  liked: string[];
  disliked: string[];
  suggestions: { region: Region; exercises: string[] }[];
  guideline: string;
};

/** 训练目标、伤病限制和动作偏好，教练和训练建议共用 */
export function trainingPreferences(db: DatabaseSync) {
  const memories = listMemories();
  const prefs = getExercisePreferences();
  const named = (want: 'liked' | 'disliked') => [...prefs].filter(([, p]) => p === want).flatMap(([id]) => {
    const row = db.prepare('SELECT zh_name, name FROM exercise WHERE id = ?').get(id) as { zh_name: string; name: string } | undefined;
    return row ? [{ id, name: row.zh_name || row.name }] : [];
  });
  const goal = getTrainingProfile().goal;
  return {
    goal: goal ? TRAINING_GOALS[goal] : null,
    goalKey: goal,
    constraints: memories.filter((m) => m.kind === 'constraint').map((m) => m.content),
    rules: constraintRulesFor(memories),
    liked: named('liked'),
    disliked: named('disliked'),
  };
}

export function training(db: DatabaseSync, today: string, wall: WallData, range: CoachRange, focus: TrainingFocus): Tool<TrainingFacts> {
  const from = rangeStart(today, range);
  const log = trainingLog(db, from, today);
  const totals = trainingTotals(log);
  const weeks = (Date.parse(today) - Date.parse(from)) / 86_400_000 / 7 + 1 / 7;
  const byRegion = new Map<Region, { sets: number; dates: Set<string> }>();
  for (const a of muscleActivity(log)) {
    const region = REGION_OF.get(a.id);
    if (!region) continue;
    const cur = byRegion.get(region) ?? { sets: 0, dates: new Set<string>() };
    cur.sets += a.sets;
    cur.dates.add(a.date);
    byRegion.set(region, cur);
  }
  const regions = REGION_ORDER.filter((r) => MAJOR.includes(r) || byRegion.has(r)).map((region) => {
    const r = byRegion.get(region);
    return { region, sets: r?.sets ?? 0, weeklySets: round1((r?.sets ?? 0) / weeks), timesPerWeek: round1((r?.dates.size ?? 0) / weeks) };
  });
  const weak = regions.filter((r) => MAJOR.includes(r.region) && r.weeklySets < 10).sort((a, b) => a.weeklySets - b.weeklySets).map((r) => r.region);
  const reps = log.flatMap((w) => w.moves.flatMap((m) => m.sets.map((s) => s.reps))).filter((n) => n > 0);
  const prs = wall.prs.filter((e) => e.date >= from);
  const progress = exercisePerformance(log)
    .map((e) => ({ e, points: [...e.sessions].reverse().flatMap((s) => (s.pr ? [s.pr.value] : [])) }))
    .filter(({ points }) => points.length >= 2)
    .sort((a, b) => b.points.length - a.points.length || Math.max(...b.points) - Math.max(...a.points))
    .slice(0, 3)
    .map(({ e, points }) => ({ name: e.name, sessions: points.length, first: round1(points[0]), last: round1(points.at(-1)!), best: round1(Math.max(...points)) }));
  const prefs = trainingPreferences(db);

  // 补弱的动作：词典里这个部位的动作，先放喜欢的、练过的，跳过不喜欢的和伤病限制要避开的
  const everDone = new Set(trainingLog(db, wallStart(today), today).flatMap((w) => w.moves.map((m) => m.name)));
  const liked = new Set(prefs.liked.map((x) => x.id));
  const disliked = new Set(prefs.disliked.map((x) => x.id));
  const suggestions = weak.slice(0, 2).map((region) => ({
    region,
    exercises: dictionary
      .filter((e) => REGION_OF.get(e.primary_muscles[0]) === region && !disliked.has(e.legacy_id ?? '')
        && !prefs.rules.some((r) => r.exclude.test(`${e.name_zh} ${e.aliases.join(' ')}`)))
      .map((e, i) => ({ name: e.name_zh, score: (liked.has(e.legacy_id ?? '') ? 2 : 0) + (everDone.has(e.name_zh) ? 1 : 0) - i / 100 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((e) => e.name),
  })).filter((s) => s.exercises.length);

  const facts: TrainingFacts = {
    range: RANGE_WORD[range],
    totals: { sessions: totals.sessions, days: totals.days, sets: totals.sets, volume: totals.volume, durationMin: totals.durationMin },
    daysPerWeek: round1(totals.days / weeks),
    regions,
    weak,
    repShare6to12: reps.length ? Math.round((reps.filter((n) => n >= 6 && n <= 12).length / reps.length) * 100) : null,
    prs: { count: prs.length, list: prs.slice(-6).map((e) => ({ date: e.date, name: e.name, e1rm: e.value, prev: e.prev, weight: e.weight, reps: e.reps })) },
    progress,
    topExercises: wall.topExercises[range],
    goal: prefs.goal,
    constraints: prefs.constraints,
    avoid: prefs.rules.map((r) => r.label),
    liked: prefs.liked.map((x) => x.name),
    disliked: prefs.disliked.map((x) => x.name),
    suggestions,
    guideline: focus === 'strength'
      ? '力量：主项每组 3–6 次、组间休息 2–3 分钟，辅助动作 8–12 次；每个大肌群每周仍要 10 组左右'
      : focus === 'cut'
        ? '减脂期保肌：大肌群每周仍保持 10 组左右、重量尽量不降，配合每天 8000 步以上或每周 2–3 次有氧'
        : '增肌：每个大肌群每周 10–20 组、每周练到 2 次，每组 6–12 次、留 1–2 次余力，次数做到上限再加重量',
  };
  if (!totals.sets) return { facts, chart: null };
  const values = regions.map((r) => r.weeklySets);
  const majorIdx = regions.map((r, i) => ({ r, i })).filter(({ r }) => MAJOR.includes(r.region));
  const chart: CoachSeriesChart = {
    id: `training-${range}`, kind: 'bars', tone: 'lemon', title: `${RANGE_WORD[range]} · 各部位每周组数`,
    labels: regions.map((r) => r.region),
    picks: regions.map((r) => `${r.region} · ${RANGE_WORD[range]}共 ${r.sets} 组，每周练 ${r.timesPerWeek} 次`),
    index: majorIdx.sort((a, b) => a.r.weeklySets - b.r.weeklySets)[0]?.i ?? 0,
    series: [{ key: 'sets', name: '每周组数', unit: '组', dec: 1, values }],
    band: { from: 10, to: 20, label: '建议 10–20 组' },
    note: '每个动作只算进一个主要肌群，和训练统计同一口径。',
  };
  return { facts, chart };
}

export function trainingReply(f: TrainingFacts, focus: TrainingFocus) {
  const guide = focus === 'strength' ? '提升力量的常用做法是主项每组 3–6 次、组间休息 2–3 分钟，辅助动作 8–12 次，每个大肌群每周仍要 10 组左右。'
    : focus === 'cut' ? '减脂期练力量是为了保住肌肉：大肌群每周仍保持 10 组左右、重量尽量不降。'
      : '增肌常用的标准是每个大肌群每周 10–20 组、每周练到 2 次。';
  if (!f.totals.sets) {
    return `${f.range}还没有训练记录。${guide}可以从每周 3 天全身训练开始，每次胸、背、腿各 1–2 个动作，每组 6–12 次；记下几次训练后，我就能按你的实际情况调整。`;
  }
  const lines = [
    `${f.range}你练了 ${f.totals.days} 天（平均每周 ${f.daysPerWeek} 天），共 ${fmt(f.totals.sets)} 组、容量 ${fmt(f.totals.volume)} kg。`,
    `${guide}你现在每周：${f.regions.filter((r) => MAJOR.includes(r.region)).map((r) => `${r.region} ${r.weeklySets} 组`).join('、')}${f.weak.length === MAJOR.length ? `，都还不到 10 组，${f.weak.slice(0, 2).join('和')}最少`
      : f.weak.length ? `，${f.weak.join('、')}还不够` : '，都在建议区里'}。`,
  ];
  const freq = f.daysPerWeek < 3 ? '每周练 3–4 天，按「上肢 / 下肢」或「推 / 拉 / 腿」轮换，让每个部位一周练到 2 次' : '保持现在的训练天数，让每个部位一周练到 2 次';
  const fill = f.suggestions.length
    ? `先把${f.suggestions.map((s) => `${s.region}（${s.exercises.join('、')}）`).join('、')}加到每周 10 组左右`
    : f.weak.length ? `先把${f.weak.join('、')}加到每周 10 组左右` : '组数保持住';
  const repNote = f.repShare6to12 === null || focus === 'strength' ? ''
    : f.repShare6to12 >= 60 ? `你 ${f.repShare6to12}% 的组在 6–12 次，这个范围很合适；` : `你只有 ${f.repShare6to12}% 的组在 6–12 次，可以多放在这个范围；`;
  const tail = focus === 'strength' ? '主项次数做到上限再加重量。'
    : focus === 'cut' ? '每组留 1–2 次余力，再配合每天 8000 步以上或每周 2–3 次有氧。'
      : '每组留 1–2 次余力，次数做到上限再加重量。';
  lines.push(`建议：${freq}；${fill}；${repNote}${tail}`);
  const best = f.progress.find((p) => p.last > p.first);
  if (best) lines.push(`进步：${best.name}估算 1RM 从 ${best.first} kg 到 ${best.last} kg${f.prs.count ? `，${f.range}一共破了 ${f.prs.count} 次个人纪录` : ''}，照这个节奏练。`);
  else if (f.progress[0]) lines.push(`${f.progress[0].name}最近 ${f.progress[0].sessions} 次估算 1RM 在 ${f.progress[0].first}–${f.progress[0].best} kg，暂时持平，可以先把次数做上去。`);
  const care: string[] = [];
  if (f.constraints.length) care.push(`你记过「${f.constraints.join('；')}」，${f.avoid.length ? `${f.avoid.join('、')}先避开，` : ''}以上建议已经跳过相关动作`);
  if (f.disliked.length) care.push(`不喜欢的${f.disliked.join('、')}没有放进建议`);
  if (care.length) lines.push(`${care.join('；')}。`);
  return lines.join('\n');
}

/** 问句里的训练方向：说了增肌 / 减脂 / 力量就按问句，否则按训练档案的目标 */
export function trainingFocusIn(question: string, goal: TrainingGoal | null): TrainingFocus {
  if (BULK_WORD.test(question)) return 'muscle';
  if (CUT_WORD.test(question)) return 'cut';
  if (/力量|变强|大重量|1RM|极限/i.test(question)) return 'strength';
  return goal === 'weight' ? 'cut' : goal === 'strength' ? 'strength' : 'muscle';
}

/* ---------------- 档案 ---------------- */

export function profileFacts(db: DatabaseSync, wall: WallData) {
  const p = wall.profile;
  const prefs = trainingPreferences(db);
  return {
    trainingGoal: prefs.goal,
    nutrition: p ? {
      sex: p.sex === 'male' ? '男' : '女', age: p.age, height: p.height, weight: p.weight,
      activity: `${p.activityLabel}（${p.activityDesc}，系数 ${p.factor}）`,
      goal: p.goalLabel, targetKcal: p.targetKcal, protein: p.protein, carbs: p.carbs, fat: p.fat,
    } : { missing: NEED_PROFILE },
    constraints: prefs.constraints,
    liked: prefs.liked.map((x) => x.name),
    disliked: prefs.disliked.map((x) => x.name),
  };
}

/* ---------------- 一次提问里共用的数据 ---------------- */

/** 回顾的数据只算一次：同一轮里本地回答和模型调用的工具读的是同一份 */
export function coachData(db: DatabaseSync, today: string) {
  let cached: WallData | null = null;
  const wall = () => (cached ??= buildReviewWall(db, today).wall);
  return {
    today,
    metabolism: (range: CoachRange) => metabolism(wall(), range),
    energy: (range: CoachRange) => energy(wall(), range),
    macros: (goal: GoalKey) => macroPlan(db, wall(), goal),
    training: (range: CoachRange, focus: TrainingFocus) => training(db, today, wall(), range, focus),
    profile: () => profileFacts(db, wall()),
    profileGoal: (): GoalKey => wall().profile?.goal ?? 'maintain',
    trainingGoal: () => getTrainingProfile().goal,
  };
}
export type CoachData = ReturnType<typeof coachData>;
