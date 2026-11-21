import snapshot from '../data/nutrition-catalog.json';
import type { Item, Nutrition } from './calculations';

export type FoodState = 'raw' | 'cooked' | 'unknown';
export type WeightBasis = 'edible' | 'bone_in' | 'unknown';
export interface NutritionBasis {
  source: 'tfda' | 'usda' | 'ai';
  reference: string | null;
  measured_grams: number | null;
  food_state: FoodState;
  weight_basis: WeightBasis;
  assumption: string | null;
}
export type NutritionEdit = Pick<NutritionBasis, 'measured_grams' | 'food_state' | 'weight_basis'>;

type Food = Required<Nutrition> & {
  name: string;
  state: FoodState;
  aliases: string[];
  refuse: number | null;
};
const foods: Record<string, Food> = snapshot.foods as Record<string, Food>;
const families = Object.values(snapshot.families) as [
  string[],
  string | null,
  string | null,
  string | null,
][];
const normalized = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s/g, '');
const keys = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;
const unknownNutrition = { kcal: null, protein_g: null, carbs_g: null, fat_g: null };

function lookup(name: string, state: FoodState) {
  const key = normalized(name)
    .replace(/^(?:生的?|熟的?|带骨|帶骨|去骨|无骨|無骨)+/, '')
    .replace(/(?:带骨|帶骨|去骨|无骨|無骨)$/, '');
  const family = families.find(([aliases]) => aliases.some((a) => normalized(a) === key));
  if (family) {
    const [, raw, cooked, refuse] = family;
    const reference = state === 'raw' ? raw : state === 'cooked' ? cooked : (cooked ?? raw);
    return reference
      ? { reference, food: foods[reference], refuse: refuse ? foods[refuse].refuse : null }
      : null;
  }
  const matches = Object.entries(foods).filter(
    ([, f]) =>
      [f.name, ...f.aliases].some((a) => normalized(a) === key) && (state === 'unknown' || f.state === state),
  );
  if (matches.length !== 1) return null;
  const [reference, food] = matches[0];
  return { reference, food, refuse: food.refuse };
}

function localNutrition(item: Item, input: NutritionEdit): Item | null {
  const match = lookup(item.food_name, input.food_state);
  if (!match || input.measured_grams == null) return null;
  const { reference, food, refuse } = match;
  // The same refuse ratio across raw and cooked weights is an approximation.
  const discard = input.weight_basis === 'bone_in' ? (refuse && refuse > 0 ? refuse : 30) : 0;
  const grams = input.measured_grams * (1 - discard / 100);
  const state = food.state === 'raw' ? '生重' : food.state === 'cooked' ? '熟重' : '称量重';
  const assumption = [
    discard
      ? `带骨 ${input.measured_grams} g，按 ${discard}% 不可食部分折算${refuse ? '' : '（默认估计）'}`
      : input.weight_basis === 'unknown'
        ? '暂按所报重量为可食重量'
        : null,
    `${state}可食部分约 ${Math.round(grams * 10) / 10} g`,
  ]
    .filter(Boolean)
    .join(' · ');
  const basis: NutritionBasis = {
    ...input,
    source: reference.startsWith('tfda:') ? 'tfda' : 'usda',
    reference,
    assumption,
  };
  return {
    ...item,
    ...Object.fromEntries(
      keys.map((key) => [
        key,
        food[key] === null
          ? null
          : Math.round(((food[key] * grams) / 100) * (key === 'kcal' ? 1 : 1000)) /
            (key === 'kcal' ? 1 : 1000),
      ]),
    ),
    estimated_grams: Math.round(grams * 1000) / 1000,
    confidence: 'estimated',
    nutrition_basis: basis,
  };
}

export function estimateNutrition(item: Item, fromAI: boolean, scaleWeight?: number | null): Item {
  const input: NutritionEdit = {
    measured_grams: item.estimated_grams,
    food_state: item.food_state ?? 'unknown',
    weight_basis: item.weight_basis ?? 'unknown',
  };
  const local = localNutrition(item, { ...input, measured_grams: scaleWeight ?? input.measured_grams });
  if (local) return local;
  if (!fromAI) return item;
  let kcal = item.kcal;
  const { protein_g: p, carbs_g: c, fat_g: f } = item;
  let assumption = item.portion_text;
  if (p !== null && c !== null && f !== null) {
    const macroKcal = Math.round(4 * p + 4 * c + 9 * f);
    if (kcal === null || Math.abs(kcal - macroKcal) > Math.max(20, macroKcal * 0.2)) {
      kcal = macroKcal;
      assumption = [assumption, '热量按碳蛋脂 4-4-9 换算'].filter(Boolean).join(' · ');
    }
  }
  return {
    ...item,
    kcal,
    confidence: 'estimated',
    nutrition_basis: { ...input, source: 'ai', reference: null, assumption },
  };
}

export function editNutrition(item: Item, input: NutritionEdit): Item {
  if (
    (input.measured_grams !== null &&
      (!Number.isFinite(input.measured_grams) || input.measured_grams <= 0 || input.measured_grams > 1e6)) ||
    !['raw', 'cooked', 'unknown'].includes(input.food_state) ||
    !['edible', 'bone_in', 'unknown'].includes(input.weight_basis)
  )
    throw Error('份量或食物状态无效');
  const updated = {
    ...item,
    portion_text: input.measured_grams === null ? null : `${input.measured_grams} 克`,
  };
  const local = localNutrition(updated, input);
  if (local) return local;
  const old = item.nutrition_basis;
  if (
    old?.source === 'ai' &&
    old.measured_grams &&
    input.measured_grams &&
    old.food_state === input.food_state &&
    old.weight_basis === input.weight_basis
  ) {
    const scale = input.measured_grams / old.measured_grams;
    return {
      ...updated,
      ...Object.fromEntries(
        keys.map((k) => [
          k,
          item[k] === null
            ? null
            : Math.round(item[k] * scale * (k === 'kcal' ? 1 : 1000)) / (k === 'kcal' ? 1 : 1000),
        ]),
      ),
      estimated_grams: input.measured_grams,
      nutrition_basis: { ...old, ...input, assumption: '按原 AI 估值等比例换算' },
    };
  }
  return {
    ...updated,
    ...unknownNutrition,
    estimated_grams: null,
    nutrition_basis: undefined,
    confidence: 'estimated',
  };
}
