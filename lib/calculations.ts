import type {
  NutritionBasis,
  FoodState,
  WeightBasis,
} from "./ledger-nutrition";
import { MUSCLES } from "./muscles";
export type Confidence = "estimated" | "exact";
export type Nutrition = Record<
  "kcal" | "protein_g" | "carbs_g" | "fat_g",
  number | null
>;
export type Item = Nutrition & {
  food_name: string;
  food_state?: FoodState;
  weight_basis?: WeightBasis;
  nutrition_basis?: NutritionBasis;
  portion_text: string | null;
  estimated_grams: number | null;
  confidence: Confidence;
};
export interface SetDetail {
  weight_kg: number | null;
  reps: number | null;
  duration_sec: number | null;
}
export interface Movement {
  exercise_id: string | null;
  /** 训练页动作库（exercise 表）的 id，只有训练页同步来的动作有 */
  library_id?: string | null;
  exercise_name: string;
  sets: SetDetail[];
  primary_muscles: string[];
  secondary_muscles: string[];
  mechanic?: string | null;
  movement_pattern?: string | null;
  skipped?: boolean;
}
export interface Metric {
  date: string;
  logged_at: string;
  weight_kg: number;
}
export function calcMealTotals(
  items: (Nutrition & { confidence: Confidence })[],
) {
  const incomplete_fields: string[] = [];
  const total = (key: keyof Nutrition) => {
    const values = items.map((i) => i[key]).filter((v) => v !== null);
    if (values.length < items.length) incomplete_fields.push(key);
    return values.length || !items.length
      ? values.reduce((sum, v) => sum + Math.round(v * 1000), 0) / 1000
      : null;
  };
  return {
    kcal: total("kcal"),
    protein_g: total("protein_g"),
    carbs_g: total("carbs_g"),
    fat_g: total("fat_g"),
    hasEstimates: items.some((i) => i.confidence === "estimated"),
    incomplete_fields,
  };
}
export const formatDisplayKcal = (kcal: number | null) =>
  kcal === null ? "" : `≈ ${Math.round(kcal / 10) * 10} 千卡`;
export function calcWorkoutTotals(sets: SetDetail[]) {
  return {
    totalSets: sets.length,
    totalVolumeKg:
      sets.reduce(
        (sum, s) => sum + Math.round((s.weight_kg ?? 0) * 1000) * (s.reps ?? 0),
        0,
      ) / 1000,
  };
}
export function formatWorkoutSummary(sets: SetDetail[], name = "") {
  const runs: { label: string; n: number }[] = [];
  for (const s of sets) {
    const label = [
      s.weight_kg === null ? "" : s.weight_kg + "kg",
      s.reps === null
        ? ""
        : String(s.reps) + (s.weight_kg === null ? "次" : ""),
      s.duration_sec === null ? "" : s.duration_sec + "秒",
    ]
      .filter(Boolean)
      .join(" × ");
    const prev = runs.at(-1);
    if (prev?.label === label) prev.n++;
    else runs.push({ label, n: 1 });
  }
  if (!runs.length) return name;
  if (runs.length === 1)
    return [runs[0].label, sets.length + "组"].filter(Boolean).join(" · ");
  return runs
    .map((r) =>
      r.label
        ? r.label.replaceAll(" × ", "×") + (r.n > 1 ? "×" + r.n : "")
        : r.n + "组",
    )
    .join(" / ");
}
export function calcMuscleHeatmap(
  workouts: {
    entry_type: string;
    is_deleted?: boolean;
    exercises: Movement[];
  }[],
  range: "day" | "week" | "month",
) {
  const scores: Record<string, number> = Object.fromEntries(
    MUSCLES.map((m) => [m.id, 0]),
  );
  for (const w of workouts)
    if (w.entry_type === "workout" && !w.is_deleted)
      for (const m of w.exercises) {
        const n = m.sets.length || 3;
        for (const id of new Set(m.primary_muscles))
          scores[id] = (scores[id] ?? 0) + 10 * n;
        for (const id of new Set(m.secondary_muscles))
          if (!m.primary_muscles.includes(id))
            scores[id] = (scores[id] ?? 0) + 4 * n;
      }
  const [low, high] = { day: [10, 30], week: [30, 80], month: [80, 200] }[
    range
  ];
  return Object.fromEntries(
    Object.entries(scores).map(([id, v]) => [
      id,
      { score: v / 10, level: v >= high ? 3 : v >= low ? 2 : v > 0 ? 1 : 0 },
    ]),
  );
}
export function calcWeightTrend(
  metrics: Metric[],
  start = "0000-01-01",
  end = "9999-12-31",
) {
  const daily = new Map<string, number>();
  for (const m of [...metrics].sort(
    (a, b) => Date.parse(a.logged_at) - Date.parse(b.logged_at),
  ))
    if (!daily.has(m.date)) daily.set(m.date, m.weight_kg);
  const points = [...daily]
    .filter(([d]) => d >= start && d <= end)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, weight_kg]) => {
      const values = [...daily].filter(
        ([d]) => d <= date && Date.parse(date) - Date.parse(d) < 7 * 86400000,
      );
      return {
        date,
        weight_kg,
        days: values.length,
        average7:
          Math.round(
            (values.reduce((s, [, v]) => s + v, 0) / values.length) * 1000,
          ) / 1000,
      };
    });
  const latest = points.at(-1)?.weight_kg ?? null;
  return {
    latest,
    change:
      latest === null
        ? null
        : Math.round((latest - points[0].weight_kg) * 1000) / 1000,
    points,
  };
}
