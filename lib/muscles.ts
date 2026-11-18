/**
 * 细分肌肉 → 动作筛选条件 + 3D 模型网格名匹配。
 *
 * 3D 模型来自 Z-Anatomy（CC BY-SA 4.0，经 hpfrei/body-anatomy-3d-viewer 精简为 body.glb），
 * 每块肌肉的 nameDetail 里带有解剖学细名，例如：
 *   Clavicular Head Of Pectoralis Major  → 上胸
 *   Sternocostal Head Of Pectoralis Major → 中胸
 *   Abdominal Part Of Pectoralis Major    → 下胸
 */

export type MuscleId =
  | 'chest_upper'
  | 'chest_mid'
  | 'chest_lower'
  | 'serratus'
  | 'abs'
  | 'obliques'
  | 'delt_front'
  | 'delt_side'
  | 'delt_rear'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'traps'
  | 'lats'
  | 'upperback'
  | 'lowerback'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'calves'
  | 'adductors'
  | 'neck';

export type Region = '胸' | '肩' | '背' | '手臂' | '核心' | '腿' | '颈';

export interface MuscleGroup {
  id: MuscleId;
  label: string;
  region: Region;
  side: 'front' | 'back' | 'both';
  /** 数据集 target 精确匹配 */
  target?: string;
  /** 数据集 body_part 精确匹配 */
  bodyPart?: string;
  include?: RegExp;
  exclude?: RegExp;
  /** 3D 模型里的 nameDetail（小写子串匹配） */
  meshes: string[];
}

export const MUSCLES: MuscleGroup[] = [
  // ---------------- 胸 ----------------
  {
    id: 'chest_upper',
    label: '上胸',
    region: '胸',
    side: 'front',
    target: 'pectorals',
    include: /incline|upper (chest|pec)|low.?to.?high/i,
    meshes: ['clavicular head of pectoralis major'],
  },
  {
    id: 'chest_mid',
    label: '中胸',
    region: '胸',
    side: 'front',
    target: 'pectorals',
    exclude: /incline|decline|\bdip\b|upper (chest|pec)|low.?to.?high/i,
    meshes: ['sternocostal head of pectoralis major'],
  },
  {
    id: 'chest_lower',
    label: '下胸',
    region: '胸',
    side: 'front',
    target: 'pectorals',
    include: /decline|\bdip\b|high.?to.?low/i,
    meshes: ['abdominal part of pectoralis major'],
  },
  {
    id: 'serratus',
    label: '前锯肌',
    region: '胸',
    side: 'front',
    target: 'serratus anterior',
    meshes: ['serratus anterior'],
  },
  // ---------------- 肩 ----------------
  {
    id: 'delt_front',
    label: '前束',
    region: '肩',
    side: 'front',
    target: 'delts',
    exclude: /lateral|side|rear|reverse|bent.?over|face pull|upright row/i,
    meshes: ['clavicular part of deltoid'],
  },
  {
    id: 'delt_side',
    label: '中束',
    region: '肩',
    side: 'front',
    target: 'delts',
    include: /lateral|side|upright row/i,
    exclude: /rear|reverse|face pull|bent.?over/i,
    meshes: ['acromial part of deltoid'],
  },
  {
    id: 'delt_rear',
    label: '后束',
    region: '肩',
    side: 'back',
    target: 'delts',
    include: /rear|reverse|face pull|bent.?over/i,
    meshes: ['scapular spinal part of deltoid'],
  },
  // ---------------- 背 ----------------
  {
    id: 'traps',
    label: '斜方肌',
    region: '背',
    side: 'back',
    target: 'traps',
    meshes: [
      'descending part of trapezius',
      'transverse part of trapezius',
      'ascending part of trapezius',
    ],
  },
  {
    id: 'lats',
    label: '背阔肌',
    region: '背',
    side: 'back',
    target: 'lats',
    meshes: ['latissimus dorsi', 'teres major'],
  },
  {
    id: 'upperback',
    label: '上背',
    region: '背',
    side: 'back',
    target: 'upper back',
    meshes: [
      'rhomboid major',
      'rhomboid minor',
      'levator scapulae',
      'infraspinatus',
      'supraspinatus',
      'teres minor',
    ],
  },
  {
    id: 'lowerback',
    label: '下背',
    region: '背',
    side: 'back',
    target: 'spine',
    meshes: [
      'longissimus thoracis',
      'iliocostalis lumborum',
      'spinalis thoracis',
      'quadratus lumborum',
      'multifidus lumborum',
    ],
  },
  // ---------------- 手臂 ----------------
  {
    id: 'biceps',
    label: '肱二头肌',
    region: '手臂',
    side: 'front',
    target: 'biceps',
    meshes: ['long head of biceps brachii', 'short head of biceps brachii', 'brachialis'],
  },
  {
    id: 'triceps',
    label: '肱三头肌',
    region: '手臂',
    side: 'back',
    target: 'triceps',
    meshes: [
      'long head of triceps brachii',
      'lateral head of triceps brachii',
      'medial head of triceps brachii',
      'anconeus',
    ],
  },
  {
    id: 'forearms',
    label: '前臂',
    region: '手臂',
    side: 'both',
    target: 'forearms',
    meshes: [
      'brachioradialis',
      'flexor carpi radialis',
      'flexor carpi ulnaris',
      'extensor carpi radialis longus',
      'extensor carpi radialis brevis',
      'extensor carpi ulnaris',
      'palmaris longus',
      'pronator teres',
      'pronator quadratus',
      'flexor digitorum superficialis',
      'flexor digitorum profundus',
      'extensor digitorum',
      'supinator',
    ],
  },
  // ---------------- 核心 ----------------
  {
    id: 'abs',
    label: '腹直肌',
    region: '核心',
    side: 'front',
    target: 'abs',
    meshes: ['rectus abdominis', 'pyramidalis'],
  },
  {
    id: 'obliques',
    label: '腹斜肌',
    region: '核心',
    side: 'front',
    bodyPart: 'waist',
    include: /twist|oblique|side bend|windmill|russian|side crunch|rotation/i,
    meshes: ['external abdominal oblique', 'internal abdominal oblique'],
  },
  // ---------------- 腿 ----------------
  {
    id: 'glutes',
    label: '臀部',
    region: '腿',
    side: 'back',
    target: 'glutes',
    meshes: ['gluteus maximus', 'gluteus medius', 'gluteus minimus', 'piriformis'],
  },
  {
    id: 'quads',
    label: '股四头',
    region: '腿',
    side: 'front',
    target: 'quads',
    meshes: ['rectus femoris', 'vastus lateralis', 'vastus medialis', 'vastus intermedius', 'sartorius'],
  },
  {
    id: 'hamstrings',
    label: '腘绳肌',
    region: '腿',
    side: 'back',
    target: 'hamstrings',
    meshes: [
      'long head of biceps femoris',
      'short head of biceps femoris',
      'semitendinosus',
      'semimembranosus',
      'popliteus',
    ],
  },
  {
    id: 'calves',
    label: '小腿',
    region: '腿',
    side: 'back',
    target: 'calves',
    meshes: [
      'lateral head of gastrocnemius',
      'medial head of gastrocnemius',
      'soleus',
      'tibialis anterior',
      'tibialis posterior',
      'fibularis longus',
      'fibularis brevis',
    ],
  },
  {
    id: 'adductors',
    label: '内收肌',
    region: '腿',
    side: 'front',
    target: 'adductors',
    meshes: ['adductor brevis', 'adductor longus', 'adductor magnus', 'gracilis', 'pectineus'],
  },
  // ---------------- 颈 ----------------
  {
    id: 'neck',
    label: '颈部',
    region: '颈',
    side: 'both',
    bodyPart: 'neck',
    meshes: [
      'sternocleidomastoid',
      'scalenus anterior',
      'scalenus medius',
      'scalenus posterior',
      'splenius capitis',
      'semispinalis colli',
      'longus colli',
      'longus capitis',
    ],
  },
];

export const REGIONS: Region[] = ['胸', '肩', '背', '手臂', '核心', '腿', '颈'];

export function muscleById(id: string): MuscleGroup | undefined {
  return MUSCLES.find((m) => m.id === id);
}

/** 某个动作是否属于这块肌肉 */
export function muscleMatchesExercise(
  g: MuscleGroup,
  ex: { name: string; target: string; body_part: string },
): boolean {
  if (!g.target && !g.bodyPart) return false;
  if (g.target && ex.target !== g.target) return false;
  if (g.bodyPart && ex.body_part !== g.bodyPart) return false;
  if (g.include && !g.include.test(ex.name)) return false;
  if (g.exclude && g.exclude.test(ex.name)) return false;
  return true;
}

/** 3D 模型网格 → 肌肉组 */
export function groupForMeshName(nameDetail: string): MuscleGroup | undefined {
  const n = nameDetail.toLowerCase();
  return MUSCLES.find((g) => g.meshes.some((m) => n.includes(m)));
}
