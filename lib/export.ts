import type { DatabaseSync } from "node:sqlite";
import {
  calcMealTotals,
  calcMuscleHeatmap,
  calcWorkoutTotals,
  formatWorkoutSummary,
  type Item,
  type Movement,
  type Metric,
} from "./calculations";
import type { Draft, Source } from "./ledger";
export interface Card extends Draft {
  id: number;
  input_method: Source | null;
  has_photo?: boolean;
  exercises: Movement[];
  items: (Item & { id: number })[];
}
type Measurement = Metric & {
  source: Source | null;
  confidence: string;
  note: string | null;
  body_fat_pct: number | null;
  raw_text: string | null;
  feeling_tags: string[];
};
export function exportJournal(
  db: DatabaseSync,
  user: string,
  start: string,
  end: string,
) {
  for (const d of [start, end])
    if (
      !/^\d{4}-\d\d-\d\d$/.test(d) ||
      new Date(d).toISOString().slice(0, 10) !== d
    )
      throw Error("日期无效");
  if (end < start || Date.parse(end) - Date.parse(start) > 3660 * 86400000)
    throw Error("日期范围无效");
  const rows = db
    .prepare(
      "SELECT id,date,entry_type,logged_at,input_method,confidence,raw_text,summary_title,feeling_tags,note,actions,EXISTS(SELECT 1 FROM ledger_photos WHERE entry_id=entries.id) AS photo_present FROM entries WHERE user_id=? AND is_deleted=0 AND date BETWEEN ? AND ? ORDER BY logged_at,id",
    )
    .all(user, start, end);
  const items = db.prepare(
    "SELECT id,food_name,portion_text,estimated_grams,kcal,protein_g,carbs_g,fat_g,confidence,nutrition_basis FROM meal_items WHERE entry_id=? ORDER BY id",
  );
  const sets = db.prepare(
    "SELECT set_order,weight_kg,reps,duration_sec FROM workout_sets WHERE entry_id=? AND action_index=? ORDER BY set_order",
  );
  const exerciseMetrics = db.prepare(
    "SELECT mechanic,movement_pattern FROM exercises WHERE id=?",
  );
  const cards = rows.map(({ actions, feeling_tags, photo_present, ...r }) => ({
    ...r,
    ...(photo_present ? { has_photo: true } : {}),
    feeling_tags: JSON.parse(String(feeling_tags)),
    items: items.all(r.id).map(({ nutrition_basis, ...item }) => ({
      ...item,
      nutrition_basis: nutrition_basis
        ? JSON.parse(String(nutrition_basis))
        : null,
    })),
    exercises: (JSON.parse(String(actions)) as Movement[]).map((m, i) => ({
      ...m,
      mechanic:
        m.mechanic ?? exerciseMetrics.get(m.exercise_id)?.mechanic ?? null,
      movement_pattern:
        m.movement_pattern ??
        exerciseMetrics.get(m.exercise_id)?.movement_pattern ??
        null,
      sets: sets.all(r.id, i).map((set) => ({ ...set })),
    })),
  })) as unknown as (Card & { date: string })[];
  const metrics = db
    .prepare(
      "SELECT id,date,logged_at,weight_kg,body_fat_pct,source,confidence,note,raw_text,feeling_tags FROM body_metrics WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY logged_at,id",
    )
    .all(user, start, end)
    .map((r) => ({
      ...r,
      feeling_tags: JSON.parse(String(r.feeling_tags)),
    })) as unknown as Measurement[];
  const allMetrics = db
    .prepare(
      "SELECT date, weight_kg FROM body_metrics WHERE user_id=? AND date<=? ORDER BY date,logged_at,id",
    )
    .all(user, end) as { date: string; weight_kg: number }[];
  const hasProfile = !!db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='profile'",
    )
    .get();
  const profile = hasProfile
    ? (db.prepare("SELECT sex,age,height_cm FROM profile WHERE id=1").get() as
        { sex: string; age: number; height_cm: number } | undefined)
    : undefined;
  const latestWeight = allMetrics.at(-1)?.weight_kg;
  const bmr =
    profile && latestWeight && profile.sex !== "unspecified"
      ? Math.round(
          10 * latestWeight +
            6.25 * profile.height_cm -
            5 * profile.age +
            (profile.sex === "male" ? 5 : -161),
        )
      : null;
  const days = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10),
      entries = cards.filter((c) => c.date === date);
    const workouts = entries.filter((e) => e.entry_type === "workout");
    const daily_summary = {
      intake: calcMealTotals(entries.flatMap((c) => c.items)),
      ...calcWorkoutTotals(
        workouts.flatMap((c) => c.exercises.flatMap((m) => m.sets)),
      ),
      muscles_trained: Object.entries(calcMuscleHeatmap(workouts, "day"))
        .filter(([, v]) => v.score > 0)
        .map(([id]) => id),
    };
    const windowStart = new Date(t - 6 * 86400000).toISOString().slice(0, 10);
    const weightWindow = allMetrics.filter(
      (m) => m.date >= windowStart && m.date <= date,
    );
    const average7 = weightWindow.length
      ? Math.round(
          (weightWindow.reduce((sum, m) => sum + m.weight_kg, 0) /
            weightWindow.length) *
            100,
        ) / 100
      : null;
    days.push({
      date,
      body_metrics: metrics.filter((m) => m.date === date),
      entries,
      daily_summary,
      weight_trend: {
        average_7_day_kg: average7,
        measurements_in_window: weightWindow.length,
      },
      energy: {
        bmr_kcal_day: bmr,
        bmr_method: bmr === null ? null : "Mifflin-St Jeor",
        exercise_calories: null,
        exercise_calories_note:
          "未估算单个力量动作或训练组消耗；需心率设备或运动手表数据。",
      },
    });
  }
  return { schema_version: "1.0" as const, days };
}
export function renderMarkdown(book: ReturnType<typeof exportJournal>) {
  const lines = ["# FitCheck 手账", ""];
  for (const day of book.days) {
    lines.push("## " + day.date, "", "### 体征");
    for (const m of day.body_metrics)
      lines.push(
        `- ${m.logged_at} · ${m.weight_kg} kg · 体脂 ${m.body_fat_pct ?? "—"}% · ${m.source ?? "历史来源未知"} / ${m.confidence} · 原话：${m.raw_text ?? "—"} · 体感：${m.feeling_tags.join("、") || "—"} · 备注：${m.note ?? "—"}`,
      );
    lines.push("", "### 吃练时间线");
    for (const c of day.entries) {
      lines.push(
        `- ${c.logged_at} · ${c.summary_title}（${c.input_method ?? "历史来源未知"} / ${c.confidence}）`,
        `  - 原话：${c.raw_text ?? "—"} · 备注：${c.note ?? "—"} · 体感：${c.feeling_tags.join("、") || "—"}`,
      );
      for (const i of c.items)
        lines.push(
          `  - ${i.food_name} · ${i.portion_text ?? "份量未知"} · ${i.kcal ?? "—"} kcal · 蛋白/碳水/脂肪 ${i.protein_g ?? "—"}/${i.carbs_g ?? "—"}/${i.fat_g ?? "—"} g · ${i.confidence}${i.nutrition_basis ? " · " + [i.nutrition_basis.reference ?? "AI 估算", i.nutrition_basis.assumption].filter(Boolean).join(" · ") : ""}`,
        );
      for (const m of c.exercises)
        lines.push(
          "  - " +
            m.exercise_name +
            " · " +
            (formatWorkoutSummary(m.sets) || "组数未记"),
        );
    }
    const s = day.daily_summary,
      n = s.intake;
    lines.push(
      "",
      "|摄入 kcal|蛋白 g|碳水 g|脂肪 g|确认组数|训练容量 kg|7 日体重均线 kg|BMR kcal/日|肌群|",
      "|---:|---:|---:|---:|---:|---:|---:|---:|---|",
      `|${n.kcal ?? "—"}|${n.protein_g ?? "—"}|${n.carbs_g ?? "—"}|${n.fat_g ?? "—"}|${s.totalSets}|${s.totalVolumeKg}|${day.weight_trend.average_7_day_kg ?? "—"}|${day.energy.bmr_kcal_day ?? "—"}|${s.muscles_trained.join("、") || "—"}|`,
      n.hasEstimates ? "含估算值。" : "",
      n.incomplete_fields.length
        ? "仅计已知值：" + n.incomplete_fields.join("、")
        : "",
      "",
    );
  }
  return lines.join("\n");
}
