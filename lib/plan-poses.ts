import type { MuscleId } from './muscles';

/** 计划页点选肌群后展示的石膏姿势图（public/plan-poses/*.jpg）。女性模型使用 female 子目录中的姿势图。 */
export type PlanPose = 'chest' | 'back' | 'delts' | 'arms' | 'abs' | 'legs' | 'glutes';

export const PLAN_POSES: Record<PlanPose, { label: string; pose: string }> = {
  chest: { label: '胸部', pose: '侧展胸' },
  back: { label: '背部', pose: '背面双二头' },
  delts: { label: '肩部', pose: '侧平举定格' },
  arms: { label: '手臂', pose: '正面双二头' },
  abs: { label: '腹部', pose: '双手叉腰' },
  legs: { label: '腿部', pose: '前点步 · 股四头' },
  glutes: { label: '臀部', pose: '背面后点步' },
};

const BY_MUSCLE: Record<MuscleId, PlanPose> = {
  chest_upper: 'chest', chest_mid: 'chest', chest_lower: 'chest', serratus: 'chest',
  delt_front: 'delts', delt_side: 'delts', delt_rear: 'delts',
  traps: 'back', lats: 'back', upperback: 'back', lowerback: 'back', neck: 'back',
  biceps: 'arms', triceps: 'arms', forearms: 'arms',
  abs: 'abs', obliques: 'abs',
  quads: 'legs', adductors: 'legs', calves: 'legs',
  glutes: 'glutes', hamstrings: 'glutes',
};

export function planPoseFor(muscle: MuscleId): PlanPose {
  return BY_MUSCLE[muscle] ?? 'chest';
}
