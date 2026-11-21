import { calcMealTotals, type Item } from './calculations';
import { editNutrition, type NutritionEdit } from './ledger-nutrition';

export type MealPatch = Partial<NutritionEdit> & { item_index: number };
export interface MealPick {
  kind: 'meal';
  question: string;
  options: { label: string; edits: MealPatch[] }[];
}
export interface WorkoutPick {
  kind: 'workout';
  question: string;
  exercise_index: number;
  options: { label: string; sets: number }[];
}
export type QuickPick = MealPick | WorkoutPick;

export function applyMealOption(items: Item[], edits: MealPatch[]) {
  const indices = new Set<number>();
  return edits.map(({ item_index, ...patch }) => {
    const item = items[item_index];
    if (!Number.isInteger(item_index) || !item || indices.has(item_index)) throw Error('食物快选范围无效');
    indices.add(item_index);
    const basis = item.nutrition_basis;
    const input = {
      measured_grams: patch.measured_grams ?? basis?.measured_grams ?? item.estimated_grams,
      food_state: patch.food_state ?? basis?.food_state ?? 'unknown',
      weight_basis: patch.weight_basis ?? basis?.weight_basis ?? 'unknown',
    };
    if (input.measured_grams === 0) {
      return {
        index: item_index,
        item: {
          ...item,
          portion_text: '未食用',
          estimated_grams: 0,
          kcal: 0,
          protein_g: 0,
          carbs_g: 0,
          fat_g: 0,
          nutrition_basis: basis && { ...basis, ...input, assumption: '按所选口径未食用' },
        },
      };
    }
    const updated = editNutrition(item, input);
    if (
      !updated.nutrition_basis ||
      (['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const).some((k) => item[k] != null && updated[k] == null)
    ) {
      throw Error('此选项缺少可用的营养基准');
    }
    return { index: item_index, item: updated };
  });
}

export function prepareMealPick(pick: MealPick, items: Item[]): MealPick | null {
  if (pick.options.length < 2 || pick.options.length > 4) return null;
  const baseline = calcMealTotals(items);
  const options: MealPick['options'] = [];
  const totals = [baseline];
  const labels = new Set<string>();
  for (const option of pick.options) {
    const label = option.label.trim();
    if (!label || label.length > 28 || labels.has(label)) continue;
    try {
      const revised = [...items];
      for (const update of applyMealOption(items, option.edits)) revised[update.index] = update.item;
      totals.push(calcMealTotals(revised));
      labels.add(label);
      options.push({ ...option, label });
    } catch {
      // A model suggestion without a usable calculation path must not affect saving.
    }
  }
  const thresholds = { kcal: 75, protein_g: 12, carbs_g: 12, fat_g: 8 } as const;
  const significant = (Object.keys(thresholds) as (keyof typeof thresholds)[]).some((key) => {
    const values = totals.map((t) => t[key]).filter((v): v is number => v !== null);
    return values.length > 1 && Math.max(...values) - Math.min(...values) >= thresholds[key];
  });
  const question = pick.question.trim();
  return significant && options.length >= 2 && question && question.length <= 85
    ? { kind: 'meal', question, options }
    : null;
}
