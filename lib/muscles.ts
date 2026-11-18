/** 3D 人体上可点的肌肉 → 动作库筛选条件 */

export type MuscleId =
  | 'chest'
  | 'abs'
  | 'delts'
  | 'biceps'
  | 'forearms'
  | 'quads'
  | 'traps'
  | 'lats'
  | 'upperback'
  | 'lowerback'
  | 'triceps'
  | 'glutes'
  | 'hamstrings'
  | 'calves'
  | 'neck';

export interface MuscleDef {
  id: MuscleId;
  label: string;
  side: 'front' | 'back' | 'both';
  /** 数据集 target 字段 */
  target?: string;
  /** 数据集 body_part 字段 */
  bodyPart?: string;
}

export const MUSCLES: MuscleDef[] = [
  { id: 'chest', label: '胸大肌', side: 'front', target: 'pectorals' },
  { id: 'abs', label: '腹部', side: 'front', target: 'abs' },
  { id: 'delts', label: '三角肌', side: 'both', target: 'delts' },
  { id: 'biceps', label: '肱二头肌', side: 'front', target: 'biceps' },
  { id: 'forearms', label: '前臂', side: 'both', target: 'forearms' },
  { id: 'quads', label: '股四头肌', side: 'front', target: 'quads' },
  { id: 'traps', label: '斜方肌', side: 'back', target: 'traps' },
  { id: 'lats', label: '背阔肌', side: 'back', target: 'lats' },
  { id: 'upperback', label: '上背', side: 'back', target: 'upper back' },
  { id: 'lowerback', label: '下背', side: 'back', target: 'spine' },
  { id: 'triceps', label: '肱三头肌', side: 'back', target: 'triceps' },
  { id: 'glutes', label: '臀大肌', side: 'back', target: 'glutes' },
  { id: 'hamstrings', label: '腘绳肌', side: 'back', target: 'hamstrings' },
  { id: 'calves', label: '小腿', side: 'back', target: 'calves' },
  { id: 'neck', label: '颈部', side: 'both', bodyPart: 'neck' },
];

export function muscleById(id: string): MuscleDef | undefined {
  return MUSCLES.find((m) => m.id === id);
}
