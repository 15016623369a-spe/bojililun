import type { MealType } from '../date';

export interface RawItem {
  name: string;
  grams: number;
  kcal_100g?: number;
  protein_100g?: number;
  carb_100g?: number;
  fat_100g?: number;
  confidence?: number;
}

export type Recognition =
  | { kind: 'food'; items: RawItem[]; mealType?: MealType; note?: string }
  | { kind: 'equipment'; name: string; note?: string }
  | { kind: 'other'; text: string };

export interface RecognizeInput {
  text?: string;
  imageDataUrl?: string;
  /** 已确认的记忆，作为识别与回复的上下文 */
  memoryBlock?: string;
}

export interface VisionProvider {
  name: string;
  recognize(input: RecognizeInput): Promise<Recognition>;
}
