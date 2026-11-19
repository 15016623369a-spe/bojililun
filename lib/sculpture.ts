import type { MuscleId } from './muscles';

/**
 * 雕塑模型（tripo）是整块网格、没有分区标签，所以按模型位置估算肌群。
 * 阈值按 1.0 归一化身高取的人体比例：肩 0.82、乳头 0.72、肚脐 0.60、髂嵴 0.55、膝 0.27、踝 0.05。
 * 这是「训练导航用的近似区域」，不代表精确解剖边界。
 */
export const SCULPTURE_ORDER: MuscleId[] = [
  'neck', 'traps', 'chest_upper', 'chest_mid', 'chest_lower', 'delt_front', 'delt_side', 'delt_rear',
  'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'serratus', 'upperback', 'lats', 'lowerback',
  'glutes', 'quads', 'hamstrings', 'adductors', 'calves',
];

export function muscleAt(x: number, y: number, z: number, front: boolean): MuscleId | null {
  const side = Math.abs(x);
  const h = y;
  if (h > 0.87) return 'neck';
  if (side > 0.26 && h > 0.4 && h < 0.73) return h > 0.6 ? (front ? 'biceps' : 'triceps') : 'forearms';
  if (side > 0.3 && h <= 0.4) return 'forearms';
  if (front) {
    if (h > 0.78) return side > 0.2 ? 'traps' : 'neck';
    if (h > 0.7) return side > 0.22 ? 'delt_front' : 'chest_upper';
    if (h > 0.63) return side > 0.22 ? 'delt_front' : 'chest_mid';
    if (h > 0.56) return side > 0.19 ? 'obliques' : 'chest_lower';
    if (h > 0.47) return side > 0.17 ? 'obliques' : 'abs';
    if (h > 0.4) return side > 0.16 ? 'obliques' : 'abs';
    if (h > 0.27) return side > 0.17 ? 'quads' : 'adductors';
    if (h > 0.12) return side > 0.12 ? 'calves' : 'quads';
    return 'calves';
  }
  if (h > 0.8) return side > 0.2 ? 'traps' : 'neck';
  if (h > 0.7) return side > 0.23 ? 'delt_rear' : 'upperback';
  if (h > 0.6) return side > 0.23 ? 'lats' : 'upperback';
  if (h > 0.5) return side > 0.19 ? 'lats' : 'lowerback';
  if (h > 0.42) return side > 0.18 ? 'glutes' : 'lowerback';
  if (h > 0.3) return side > 0.16 ? 'hamstrings' : 'glutes';
  return 'calves';
}
