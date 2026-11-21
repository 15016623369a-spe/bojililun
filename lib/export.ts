import type { DatabaseSync } from 'node:sqlite';
import {
  calcMealTotals,
  calcMuscleHeatmap,
  calcWorkoutTotals,
  formatWorkoutSummary,
  type Item,
  type Movement,
  type Metric,
} from './calculations';
import type { Draft, Source } from './ledger';
export interface Card extends Draft {
  id: number;
  input_method: Source | null;
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
export function exportJournal(db: DatabaseSync, user: string, start: string, end: string) {
  for (const d of [start, end])
    if (!/^\d{4}-\d\d-\d\d$/.test(d) || new Date(d).toISOString().slice(0, 10) !== d) throw Error('日期无效');
  if (end < start || Date.parse(end) - Date.parse(start) > 3660 * 86400000) throw Error('日期范围无效');
  const rows = db
    .prepare(
      'SELECT id,date,entry_type,logged_at,input_method,confidence,raw_text,summary_title,feeling_tags,note,actions FROM entries WHERE user_id=? AND is_deleted=0 AND date BETWEEN ? AND ? ORDER BY logged_at,id',
    )
    .all(user, start, end);
  const items = db.prepare(
    'SELECT id,food_name,portion_text,estimated_grams,kcal,protein_g,carbs_g,fat_g,confidence,nutrition_basis FROM meal_items WHERE entry_id=? ORDER BY id',
  );
  const sets = db.prepare(
    'SELECT set_order,weight_kg,reps,duration_sec FROM workout_sets WHERE entry_id=? AND action_index=? ORDER BY set_order',
  );
  const cards = rows.map(({ actions, feeling_tags, ...r }) => ({
    ...r,
    feeling_tags: JSON.parse(String(feeling_tags)),
    items: items
      .all(r.id)
      .map(({ nutrition_basis, ...item }) => ({
        ...item,
        nutrition_basis: nutrition_basis ? JSON.parse(String(nutrition_basis)) : null,
      })),
    exercises: (JSON.parse(String(actions)) as Movement[]).map((m, i) => ({
      ...m,
      sets: sets.all(r.id, i).map((set) => ({ ...set })),
    })),
  })) as unknown as (Card & { date: string })[];
  const metrics = db
    .prepare(
      'SELECT id,date,logged_at,weight_kg,body_fat_pct,source,confidence,note,raw_text,feeling_tags FROM body_metrics WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY logged_at,id',
    )
    .all(user, start, end)
    .map((r) => ({ ...r, feeling_tags: JSON.parse(String(r.feeling_tags)) })) as unknown as Measurement[];
  const days = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10),
      entries = cards.filter((c) => c.date === date);
    const workouts = entries.filter((e) => e.entry_type === 'workout');
    const daily_summary = {
      intake: calcMealTotals(entries.flatMap((c) => c.items)),
      ...calcWorkoutTotals(workouts.flatMap((c) => c.exercises.flatMap((m) => m.sets))),
      muscles_trained: Object.entries(calcMuscleHeatmap(workouts, 'day'))
        .filter(([, v]) => v.score > 0)
        .map(([id]) => id),
    };
    days.push({ date, body_metrics: metrics.filter((m) => m.date === date), entries, daily_summary });
  }
  return { schema_version: '1.0' as const, days };
}
export function renderMarkdown(book: ReturnType<typeof exportJournal>) {
  const lines = ['# FitCheck 手账', ''];
  for (const day of book.days) {
    lines.push('## ' + day.date, '', '### 体征');
    for (const m of day.body_metrics)
      lines.push(
        `- ${m.logged_at} · ${m.weight_kg} kg · 体脂 ${m.body_fat_pct ?? '—'}% · ${m.source ?? '历史来源未知'} / ${m.confidence} · 原话：${m.raw_text ?? '—'} · 体感：${m.feeling_tags.join('、') || '—'} · 备注：${m.note ?? '—'}`,
      );
    lines.push('', '### 吃练时间线');
    for (const c of day.entries) {
      lines.push(
        `- ${c.logged_at} · ${c.summary_title}（${c.input_method ?? '历史来源未知'} / ${c.confidence}）`,
        `  - 原话：${c.raw_text ?? '—'} · 备注：${c.note ?? '—'} · 体感：${c.feeling_tags.join('、') || '—'}`,
      );
      for (const i of c.items)
        lines.push(
          `  - ${i.food_name} · ${i.portion_text ?? '份量未知'} · ${i.kcal ?? '—'} kcal · 蛋白/碳水/脂肪 ${i.protein_g ?? '—'}/${i.carbs_g ?? '—'}/${i.fat_g ?? '—'} g · ${i.confidence}${i.nutrition_basis ? ' · ' + [i.nutrition_basis.reference ?? 'AI 估算', i.nutrition_basis.assumption].filter(Boolean).join(' · ') : ''}`,
        );
      for (const m of c.exercises)
        lines.push('  - ' + m.exercise_name + ' · ' + (formatWorkoutSummary(m.sets) || '组数未记'));
    }
    const s = day.daily_summary,
      n = s.intake;
    lines.push(
      '',
      '|摄入 kcal|蛋白 g|碳水 g|脂肪 g|确认组数|肌群|',
      '|---:|---:|---:|---:|---:|---|',
      `|${n.kcal ?? '—'}|${n.protein_g ?? '—'}|${n.carbs_g ?? '—'}|${n.fat_g ?? '—'}|${s.totalSets}|${s.muscles_trained.join('、') || '—'}|`,
      n.hasEstimates ? '含估算值。' : '',
      n.incomplete_fields.length ? '仅计已知值：' + n.incomplete_fields.join('、') : '',
      '',
    );
  }
  return lines.join('\n');
}
