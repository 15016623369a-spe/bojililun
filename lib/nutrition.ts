/**
 * 热量与宏量营养计算 —— 纯函数，前后端共用。
 * 设计原则：AI 只负责“认出吃了什么”，所有数字都由这里的确定性公式算出来。
 */

export type Sex = 'male' | 'female';
export type ActivityKey = 'sedentary' | 'light' | 'moderate' | 'active';
export type GoalKey = 'cut' | 'maintain' | 'bulk';

export const ACTIVITY: Record<ActivityKey, { label: string; desc: string; factor: number }> = {
  sedentary: { label: '久坐', desc: '几乎不运动', factor: 1.2 },
  light: { label: '轻度', desc: '每周 1–3 次训练', factor: 1.375 },
  moderate: { label: '中度', desc: '每周 3–5 次训练', factor: 1.55 },
  active: { label: '高强度', desc: '每周 6–7 次训练', factor: 1.725 },
};

export const GOAL: Record<GoalKey, { label: string; desc: string; delta: number; protein: number }> = {
  cut: { label: '减脂', desc: '热量缺口约 400 kcal/天', delta: -400, protein: 2.0 },
  maintain: { label: '维持', desc: '保持当前体重', delta: 0, protein: 1.8 },
  bulk: { label: '增肌', desc: '热量盈余约 250 kcal/天', delta: 250, protein: 1.8 },
};

export interface ProfileInput {
  name: string;
  sex: Sex;
  age: number;
  height_cm: number;
  weight_kg: number;
  activity: ActivityKey;
  goal: GoalKey;
  protein_per_kg: number;
}

export interface Profile extends ProfileInput {
  id: 1;
  target_kcal: number;
  target_protein: number;
  updated_at: string;
}

export interface Macros {
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
}

export const EMPTY_MACROS: Macros = { kcal: 0, protein: 0, carb: 0, fat: 0 };

/** Mifflin-St Jeor 基础代谢 */
export function bmr(p: Pick<ProfileInput, 'sex' | 'weight_kg' | 'height_cm' | 'age'>): number {
  const base = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age;
  return Math.round(base + (p.sex === 'male' ? 5 : -161));
}

export function tdee(p: Pick<ProfileInput, 'sex' | 'weight_kg' | 'height_cm' | 'age' | 'activity'>): number {
  return Math.round(bmr(p) * ACTIVITY[p.activity].factor);
}

export interface Targets {
  bmr: number;
  tdee: number;
  target_kcal: number;
  target_protein: number;
}

/** 减脂时热量目标的下限：不低于基础代谢，也不低于女性 1200 / 男性 1500 kcal（但不高于每日总代谢） */
const KCAL_FLOOR = { female: 1200, male: 1500 } as const;

export function calcTargets(p: ProfileInput): Targets {
  const b = bmr(p);
  const t = Math.round(b * ACTIVITY[p.activity].factor);
  // 未满 18 岁不按减脂扣热量
  const delta = p.age < 18 && GOAL[p.goal].delta < 0 ? 0 : GOAL[p.goal].delta;
  const floor = Math.min(t, Math.max(b, p.sex === 'female' ? KCAL_FLOOR.female : KCAL_FLOOR.male));
  return {
    bmr: b,
    tdee: t,
    // 目标热量向下取整到 10，避免出现 2237 这种假精确
    target_kcal: Math.round((delta < 0 ? Math.max(t + delta, floor) : t + delta) / 10) * 10,
    target_protein: Math.round(p.weight_kg * (p.protein_per_kg || GOAL[p.goal].protein)),
  };
}

/** 按 kcal 目标给出推荐的碳水/脂肪分配（蛋白优先锁死） */
export function suggestedMacros(targetKcal: number, proteinG: number) {
  const proteinKcal = proteinG * 4;
  const fatKcal = Math.round(targetKcal * 0.27);
  const carbKcal = Math.max(0, targetKcal - proteinKcal - fatKcal);
  return {
    protein: proteinG,
    fat: Math.round(fatKcal / 9),
    carb: Math.round(carbKcal / 4),
  };
}

export function sumMacros(list: Macros[]): Macros {
  return list.reduce(
    (acc, m) => ({
      kcal: acc.kcal + (m.kcal || 0),
      protein: acc.protein + (m.protein || 0),
      carb: acc.carb + (m.carb || 0),
      fat: acc.fat + (m.fat || 0),
    }),
    { ...EMPTY_MACROS },
  );
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 按克数 + 每 100g 营养值算出一条食物的营养 */
export function macrosFor(
  grams: number,
  per100: { kcal: number; protein: number; carb: number; fat: number },
): Macros {
  const k = grams / 100;
  return {
    kcal: Math.round(per100.kcal * k),
    protein: Math.round(per100.protein * k * 10) / 10,
    carb: Math.round(per100.carb * k * 10) / 10,
    fat: Math.round(per100.fat * k * 10) / 10,
  };
}
