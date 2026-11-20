/** 前后端共用的纯类型（不 import 任何 Node 模块） */

import type { Macros } from './nutrition';
import type { MealType } from './date';

export interface FoodItem {
  name: string;
  grams: number;
  kcal_100g: number;
  protein_100g: number;
  carb_100g: number;
  fat_100g: number;
  /** 是否命中内置食物库（否则数字来自模型估算，需提示用户） */
  matched: boolean;
  confidence?: number;
}

export type MemoryKind = 'constraint' | 'preference' | 'fact' | 'goal' | 'equipment';

export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  constraint: '约束',
  preference: '偏好',
  fact: '事实',
  goal: '目标',
  equipment: '器械',
};

export const MEMORY_KIND_HINT: Record<MemoryKind, string> = {
  constraint: '伤病、禁忌、不能做的动作——永远参与决策',
  preference: '口味、习惯、喜欢的训练方式',
  fact: '身体数据、生活作息等客观信息',
  goal: '目标及其变化（减脂 / 增肌 / 备赛）',
  equipment: '家里 / 健身房可用的器械',
};

export interface Memory {
  id: number;
  kind: MemoryKind;
  key: string;
  content: string;
  importance: number;
  source: string;
  confidence: number;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface CandidateMemory {
  kind: MemoryKind;
  key: string;
  content: string;
  importance: number;
}

export interface MealRecord {
  id: number;
  date: string;
  meal_type: MealType;
  photo_path: string | null;
  items: FoodItem[];
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
  created_at: string;
}

export type AssistantReply =
  | { kind: 'text'; text: string }
  | {
      kind: 'food_card';
      draftId: string;
      mealType: MealType;
      items: FoodItem[];
      photoUrl?: string;
      note?: string;
    }
  | { kind: 'memory_proposal'; candidates: CandidateMemory[] }
  | { kind: 'summary'; text: string; consumed: Macros; remainingKcal: number };

export interface ChatResponse {
  replies: AssistantReply[];
}

export interface TodayPayload {
  date: string;
  profile: {
    name: string;
    sex: string;
    age: number;
    height_cm: number;
    weight_kg: number;
    activity: string;
    goal: string;
    target_kcal: number;
    target_protein: number;
  } | null;
  consumed: Macros;
  quickMealCount: number;
  pendingQuickMealItems: number;
  remainingKcal: number;
  remainingProtein: number;
  meals: MealRecord[];
  pendingDraft: {
    draftId: string;
    mealType: MealType;
    items: FoodItem[];
    photoUrl?: string;
    note?: string;
  } | null;
  memories: Memory[];
}

/* ------------------------------ 训练 ------------------------------ */

export interface PlanItem {
  id: number;
  date: string;
  exercise_id: string;
  name: string;
  body_part: string;
  target: string;
  equipment: string;
  sets: number;
  reps: number;
  weight: number;
  rest_sec: number;
  position: number;
  done: number;
  supplemental?: number;
  created_at: string;
}

export interface SupplementalExercise {
  exerciseId: string;
  sets: number;
  reps: number;
  weight: number;
  restSec: number;
}

export interface SessionRow {
  id: number;
  date: string;
  started_at: string;
  ended_at: string | null;
  plan_json: string | null;
  note: string | null;
  photo_path?: string | null;
}

export interface SetRow {
  id: number;
  session_id: number;
  plan_item_id: number | null;
  exercise_id: string;
  exercise_name: string;
  body_part: string;
  target: string;
  set_index: number;
  weight: number;
  reps: number;
  duration_sec: number;
  /** 本组结束后的计划休息时间，用于训练中的倒计时 */
  rest_sec: number;
  /** 本组结束后到下一组开始前的实际休息；旧记录或最后一组可能未记录 */
  actual_rest_sec: number | null;
  created_at: string;
}

export interface VolumeStats {
  sets: number;
  volume: number;
  sessions: number;
  /** 只有文字、没有逐组明细的训练记录数，已包含在 sessions 中 */
  quickSessions: number;
  days: number;
  durationMin: number;
}

export interface MuscleStat {
  body_part: string;
  volume: number;
  sets: number;
  /** 该部位的语音/文字训练记录数，不换算为容量或组数 */
  records: number;
}

export interface ExerciseStat {
  exercise_id: string;
  exercise_name: string;
  volume: number;
  sets: number;
  best_weight: number;
  best_reps: number;
}

export interface TrendPoint {
  date: string;
  volume: number;
  sets: number;
}

/* ------------------------------ 记录时间线 ------------------------------ */

export interface TimelineMeal {
  kind: 'meal';
  id: number;
  /** HH:MM */
  time: string;
  label: string;
  title: string;
  meta: string;
  kcal: number;
  items: string[];
  /** 照片（/api/uploads/xxx） */
  photo?: string;
}

export interface TimelineTraining {
  kind: 'training';
  id: number;
  /** HH:MM */
  time: string;
  label: string;
  title: string;
  exercises: string[];
  minutes: number;
  region: string;
  bodyPart: string;
  note?: string;
  /** 照片（/api/uploads/xxx） */
  photo?: string;
}

export type TimelineEntry = TimelineMeal | TimelineTraining;

export interface ReviewDay {
  date: string;
  /** 11月18日 周三 */
  label: string;
  weekday: string;
  entries: TimelineEntry[];
}

export interface ReviewPayload {
  start: string;
  end: string;
  label: string;
  bodyParts: string[];
  days: ReviewDay[];
}
