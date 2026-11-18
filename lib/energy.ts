/**
 * 训练消耗的「大致估算」+ 肌群热区 —— 纯函数，前后端共用。
 *
 * 口径（刻意做得很粗，是为了不装精确）：
 *   1. 代谢当量 MET 按部位取（力量训练 4~6，有氧 7.5）
 *   2. 强度系数来自「容量密度」= 总容量 kg ÷（时长 min × 体重 kg），再映射到 0.9~1.5
 *   3. 器械系数：自由重量 > 绳索 > 固定器械 > 弹力带（同样的重量，自由重量调动更多稳定肌）
 *   4. kcal = MET × 3.5 × 体重 ÷ 200 × 时长 × 强度 × 器械
 *
 * 所以热量跟「组数 × 次数 × 重量 × 器械 × 时长」都挂钩，
 * 但永远只能当量级参考（±20% 起步），界面上必须写「约」。
 */

import { MUSCLES, type MuscleId } from './muscles';

export interface ExerciseLoad {
  name: string;
  bodyPart: string;
  target: string;
  secondary: string[];
  equipment: string;
  sets: number;
  reps: number;
  weight: number;
}

export interface EnergyBreakdown {
  kcal: number;
  met: number;
  intensity: number;
  equipmentFactor: number;
  volume: number;
  sets: number;
  reps: number;
  minutes: number;
  bodyWeightKg: number;
  density: number;
  /** 容量密度是否超出常理（>8 kg/min/kg 体重） */
  plausible: boolean;
  /** 强度被 1.5 上限截断 */
  intensityCapped: boolean;
}

/** 部位 → MET */
const MET_BY_PART: Record<string, number> = {
  cardio: 7.5,
  'upper legs': 6,
  back: 5.5,
  chest: 5,
  shoulders: 4.6,
  waist: 4.2,
  'upper arms': 4,
  'lower arms': 3.6,
  neck: 3.6,
};

/** 器械 → 系数（自由重量 > 绳索 > 固定器械 > 弹力带） */
const EQUIPMENT_FACTOR: Record<string, number> = {
  barbell: 1.12,
  'olympic barbell': 1.12,
  'ez barbell': 1.08,
  'trap bar': 1.12,
  dumbbell: 1.06,
  kettlebell: 1.1,
  'medicine ball': 1.04,
  cable: 1,
  'smith machine': 1,
  'body weight': 1,
  'leverage machine': 0.94,
  'sled machine': 0.96,
  'stability ball': 0.95,
  band: 0.9,
  'resistance band': 0.9,
};

/** 输入上限：再大就不是人能练出来的，直接当非法值处理 */
export const LIMITS = {
  sets: { min: 1, max: 20 },
  reps: { min: 0, max: 100 },
  weight: { min: 0, max: 500 },
} as const;

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** 把「组数 / 次数 / 重量」夹到合理区间，任何计算都必须先过这一层 */
export function sanitizeSet(n: unknown, kind: 'sets' | 'reps' | 'weight'): number {
  const lim = LIMITS[kind];
  const v = Number(n);
  if (!Number.isFinite(v)) return lim.min;
  return clamp(kind === 'weight' ? v : Math.round(v), lim.min, lim.max);
}

export function equipmentFactor(equipment: string): number {
  return EQUIPMENT_FACTOR[equipment] ?? 1;
}

export function metFor(bodyPart: string): number {
  return MET_BY_PART[bodyPart] ?? 5;
}

/** 估算一次训练消耗的千卡（粗略） */
export function estimateEnergy(
  exercises: ExerciseLoad[],
  minutes: number,
  bodyWeightKg: number,
): EnergyBreakdown {
  const bw = clamp(bodyWeightKg > 0 ? bodyWeightKg : 70, 30, 200);
  const mins = clamp(minutes, 1, 600);

  let sets = 0;
  let reps = 0;
  let volume = 0;
  let metWeighted = 0;
  let equipWeighted = 0;

  for (const e of exercises) {
    const s = sanitizeSet(e.sets, 'sets');
    const r = sanitizeSet(e.reps, 'reps');
    const w = sanitizeSet(e.weight, 'weight');
    sets += s;
    reps += s * r;
    volume += s * r * w;
    metWeighted += metFor(e.bodyPart) * s;
    equipWeighted += equipmentFactor(e.equipment) * s;
  }

  const met = sets > 0 ? metWeighted / sets : 5;
  const equip = sets > 0 ? equipWeighted / sets : 1;
  const density = volume / (mins * bw);
  const rawIntensity = 0.9 + (density - 2) * 0.05;
  const intensity = clamp(rawIntensity, 0.9, 1.5);

  const kcal = (met * 3.5 * bw) / 200 * mins * intensity * equip;

  return {
    kcal: Math.round(kcal),
    met: Math.round(met * 10) / 10,
    intensity: Math.round(intensity * 100) / 100,
    equipmentFactor: Math.round(equip * 100) / 100,
    volume: Math.round(volume),
    sets,
    reps,
    minutes: Math.round(mins),
    bodyWeightKg: Math.round(bw),
    density: Math.round(density * 100) / 100,
    plausible: density <= 8,
    intensityCapped: rawIntensity > 1.5,
  };
}

/* ------------------------------ 肌群热区 ------------------------------ */

/** 数据集 target → 3D 模型肌肉组（覆盖 dataset 里会出现的写法） */
const TARGET_IDS: Record<string, MuscleId[]> = {
  pectorals: ['chest_upper', 'chest_mid', 'chest_lower'],
  'serratus anterior': ['serratus'],
  lats: ['lats'],
  'upper back': ['upperback', 'traps'],
  traps: ['traps'],
  rhomboids: ['upperback'],
  spine: ['lowerback'],
  'lower back': ['lowerback'],
  delts: ['delt_front', 'delt_side', 'delt_rear'],
  deltoids: ['delt_front', 'delt_side', 'delt_rear'],
  shoulders: ['delt_side'],
  'rear deltoids': ['delt_rear'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  forearms: ['forearms'],
  abs: ['abs'],
  core: ['abs'],
  obliques: ['obliques'],
  glutes: ['glutes'],
  quads: ['quads'],
  quadriceps: ['quads'],
  hamstrings: ['hamstrings'],
  calves: ['calves'],
  adductors: ['adductors'],
  abductors: ['adductors'],
  'hip flexors': ['quads'],
  neck: ['neck'],
  'levator scapulae': ['neck'],
  'cardiovascular system': [],
};

export function idsForTarget(target: string): MuscleId[] {
  const t = String(target || '').trim().toLowerCase();
  if (!t) return [];
  if (TARGET_IDS[t]) return TARGET_IDS[t];
  return MUSCLES.filter((m) => m.target === t).map((m) => m.id);
}

export interface MuscleHeat {
  id: MuscleId;
  label: string;
  /** 0~1，相对最热的肌群 */
  level: number;
  /** 累计努力量（组数 × 重量 × 次数） */
  load: number;
}

/** 把一次训练摊到肌群上：主动发力 ×1，协同发力 ×0.4，按最热的归一化 */
export function muscleHeat(exercises: ExerciseLoad[], bodyWeightKg: number): MuscleHeat[] {
  const bw = bodyWeightKg > 0 ? bodyWeightKg : 70;
  const load = new Map<MuscleId, number>();

  const add = (ids: MuscleId[], amount: number) => {
    for (const id of ids) load.set(id, (load.get(id) ?? 0) + amount);
  };

  for (const e of exercises) {
    const reps = sanitizeSet(e.reps, 'reps') || 8; // 没填次数时按 8 次估
    const weight = sanitizeSet(e.weight, 'weight') > 0 ? sanitizeSet(e.weight, 'weight') : bw * 0.5; // 自重按体重一半计
    const effort = sanitizeSet(e.sets, 'sets') * reps * weight;

    add(idsForTarget(e.target), effort);
    for (const s of e.secondary) add(idsForTarget(s), effort * 0.4);
  }

  const max = Math.max(0, ...load.values());
  const out: MuscleHeat[] = [];
  for (const [id, value] of load) {
    const g = MUSCLES.find((m) => m.id === id);
    if (!g) continue;
    out.push({
      id,
      label: `${g.region}·${g.label}`,
      level: max > 0 ? Math.round((value / max) * 100) / 100 : 0,
      load: Math.round(value),
    });
  }
  return out.sort((a, b) => b.level - a.level);
}
