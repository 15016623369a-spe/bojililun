import seed from '@/data/exercises-seed.json';
import { EQUIPMENT_LABEL, TARGET_LABEL } from './exercise-label';

export interface ExerciseMetricInput {
  id: string;
  name: string;
  zh_name?: string;
  body_part: string;
  equipment: string;
  target: string;
  secondary_muscles?: string | string[];
  mechanic?: string;
  movement_pattern?: string;
  metabolic_demand?: string;
  met_range?: string;
  fatigue_level?: string;
  recommended_rep_range?: string;
}

export interface LevelReading {
  label: string;
  level: number;
}

export interface ExerciseMetricSummary {
  repRange: string;
  repIsDuration: boolean;
  repCaption: string;
  restRange: string;
  restCaption: string;
  mechanicLabel: string;
  mechanicSub: string;
  patternLabel: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  demand: LevelReading;
  fatigue: LevelReading;
  metRange: string;
  kfLabels: [string, string, string, string];
}

const SEED_BY_LEGACY_ID = new Map(
  seed.flatMap((item) => (item.legacy_id ? [[item.legacy_id, item] as const] : [])),
);

const SEED_MUSCLE_ZH: Record<string, string> = {
  chest_mid: '胸大肌',
  chest_upper: '上胸大肌',
  chest_lower: '下胸大肌',
  lats: '背阔肌',
  upperback: '上背肌群',
  quads: '股四头肌',
  hamstrings: '腘绳肌',
  glutes: '臀大肌',
  delt_front: '三角肌前束',
  delt_side: '三角肌中束',
  delt_rear: '三角肌后束',
  traps: '斜方肌',
  biceps: '肱二头肌',
  triceps: '肱三头肌',
  forearms: '前臂肌群',
  abs: '腹直肌',
  obliques: '腹斜肌',
};

const PATTERN_ZH: Record<string, string> = {
  horizontal_push: '水平推',
  vertical_push: '垂直推',
  horizontal_pull: '水平拉',
  vertical_pull: '垂直拉',
  squat: '下肢蹲起',
  hinge: '髋部铰链',
  lunge: '单腿弓步',
  carry: '负重稳姿',
  core_anti_extension: '核心抗伸',
  core_anti_rotation: '核心抗旋',
  core_lateral_stability: '核心侧稳',
  core_flexion: '核心屈曲',
  水平推: '水平推',
  垂直推: '垂直推',
  水平拉: '水平拉',
  垂直拉: '垂直拉',
  '蹲／弓步': '下肢蹲起',
  髋铰链: '髋部铰链',
  核心旋转: '核心旋转',
  核心屈曲: '核心屈曲',
  核心稳定: '核心稳定',
  '单关节外展／飞鸟': '弧线外展',
  单关节屈伸: '孤立屈伸',
};

function parseSecondaryList(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeLevel(raw: string | undefined): LevelReading {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'very_high' || v === '高强度' || v === '极高') return { label: '高强度', level: 5 };
  if (v === 'high' || v === '高' || v === '较高') return { label: '较高', level: 4 };
  if (v === 'low' || v === '低' || v === '轻松') return { label: '轻松', level: 2 };
  return { label: '适中', level: 3 };
}

function normalizePattern(raw: string | undefined, bodyPart: string, isCompound: boolean): string {
  const key = String(raw || '').trim();
  if (PATTERN_ZH[key]) return PATTERN_ZH[key];
  const lower = key.toLowerCase();
  if (PATTERN_ZH[lower]) return PATTERN_ZH[lower];
  if (key && lower !== 'other' && key !== '其他') return key;
  if (bodyPart === 'waist') return '核心控制';
  if (bodyPart === 'cardio') return '心肺耐力';
  return isCompound ? '复合协同' : '孤立强化';
}

export function formatExerciseMetrics(ex: ExerciseMetricInput): ExerciseMetricSummary {
  const isCompound = ex.mechanic !== 'isolation' && ex.mechanic !== '单关节';
  const equipZh = EQUIPMENT_LABEL[ex.equipment] ?? ex.equipment;
  const seedEntry = SEED_BY_LEGACY_ID.get(ex.id);

  const primaryRaw = seedEntry?.primary_muscles?.[0];
  const primaryMuscle =
    (primaryRaw ? SEED_MUSCLE_ZH[primaryRaw] ?? TARGET_LABEL[primaryRaw] : undefined) ||
    TARGET_LABEL[ex.target] ||
    ex.target ||
    '目标肌群';

  const secRaw = seedEntry?.secondary_muscles?.length
    ? seedEntry.secondary_muscles
    : parseSecondaryList(ex.secondary_muscles);

  const secondaryMuscles: string[] = [];
  for (const m of secRaw) {
    const label = SEED_MUSCLE_ZH[m] ?? TARGET_LABEL[m] ?? m;
    if (label && label !== primaryMuscle && !secondaryMuscles.includes(label)) {
      secondaryMuscles.push(label);
    }
    if (secondaryMuscles.length >= 3) break;
  }

  const demand = normalizeLevel(ex.metabolic_demand);
  const fatigue = normalizeLevel(ex.fatigue_level);
  const rawReps = String(ex.recommended_rep_range || '').trim();
  const repRange = rawReps || (isCompound ? '8–12' : '10–15');
  const repIsDuration = repRange.startsWith('按');
  const repCaption = repIsDuration ? '按稳定时长' : isCompound ? '建议区间' : '塑形控制';

  const heavyCompound =
    /squat|deadlift|深蹲|硬拉/i.test(`${ex.name} ${ex.zh_name || ''}`) || fatigue.level >= 4;
  const restRange = repIsDuration ? '45–60' : heavyCompound ? '120–150' : isCompound ? '90–120' : '60–90';
  const restCaption = '组间恢复';

  const patternLabel = normalizePattern(ex.movement_pattern, ex.body_part, isCompound);

  return {
    repRange,
    repIsDuration,
    repCaption,
    restRange,
    restCaption,
    mechanicLabel: isCompound ? '多关节' : '单关节',
    mechanicSub: `${isCompound ? '复合' : '孤立'}${equipZh ? ` · ${equipZh}` : ''}`,
    patternLabel,
    primaryMuscle,
    secondaryMuscles,
    demand,
    fatigue,
    metRange: ex.met_range || '3.5–6.0',
    kfLabels: ['准备', '启动', '推进', '顶峰'],
  };
}
