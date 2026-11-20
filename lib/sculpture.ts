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

/**
 * 高亮用的「胶囊」近似：每块肌肉一条线段 + 半径（坐标都以身高为 1）。
 * 只在 +x 侧定义，着色器里会镜像一次，所以左右对称的肌肉只写一条。
 */
export const SCULPTURE_BLOBS: Record<MuscleId, [[number, number, number], [number, number, number], number]> = {
  neck: [[0, 0.88, 0], [0, 0.94, 0], 0.06],
  traps: [[0, 0.8, -0.02], [0.12, 0.76, -0.03], 0.09],
  chest_upper: [[0.05, 0.72, 0.08], [0.15, 0.7, 0.06], 0.08],
  chest_mid: [[0.04, 0.66, 0.09], [0.14, 0.65, 0.07], 0.08],
  chest_lower: [[0.03, 0.6, 0.08], [0.12, 0.59, 0.06], 0.06],
  delt_front: [[0.2, 0.72, 0.05], [0.24, 0.68, 0.02], 0.06],
  delt_side: [[0.24, 0.72, 0], [0.26, 0.68, -0.02], 0.06],
  delt_rear: [[0.2, 0.72, -0.05], [0.23, 0.68, -0.04], 0.06],
  biceps: [[0.22, 0.64, 0.04], [0.25, 0.58, 0.03], 0.05],
  triceps: [[0.22, 0.64, -0.04], [0.25, 0.58, -0.03], 0.05],
  forearms: [[0.26, 0.55, 0.02], [0.29, 0.46, 0.02], 0.05],
  abs: [[0, 0.56, 0.07], [0, 0.47, 0.07], 0.08],
  obliques: [[0.1, 0.55, 0.05], [0.12, 0.47, 0.04], 0.06],
  serratus: [[0.13, 0.58, 0.05], [0.16, 0.54, 0.03], 0.05],
  upperback: [[0.06, 0.74, -0.05], [0.12, 0.7, -0.05], 0.08],
  lats: [[0.1, 0.66, -0.06], [0.16, 0.56, -0.05], 0.09],
  lowerback: [[0, 0.56, -0.06], [0, 0.48, -0.06], 0.07],
  glutes: [[0.07, 0.45, -0.06], [0.09, 0.42, -0.06], 0.07],
  quads: [[0.09, 0.35, 0.05], [0.1, 0.26, 0.04], 0.07],
  hamstrings: [[0.09, 0.35, -0.05], [0.1, 0.26, -0.04], 0.07],
  adductors: [[0.04, 0.36, 0.03], [0.05, 0.3, 0.02], 0.05],
  calves: [[0.08, 0.2, -0.04], [0.08, 0.12, -0.03], 0.055],
};
