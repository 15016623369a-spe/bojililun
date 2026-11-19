'use client';

import Link from 'next/link';
import { hasRecordedData, regionTrainingName, trainingSummary, type QuickPayload, type TrainingExerciseRow } from '@/lib/journal';
import MealAmount from './MealAmount';

const TRAINING_COLUMNS = ['动作', '组数', '次数', '重量', '用时'];
const MEAL_COLUMNS = ['食物', '分量'];
const SLEEP_COLUMNS = ['项目', '记录'];
const SLEEP_LABELS: Array<[keyof NonNullable<QuickPayload['sleep']>, string]> = [
  ['duration', '时长'], ['bedtime', '入睡'], ['wake', '醒来'], ['quality', '质量'],
];

function rowsOf(payload: QuickPayload): { columns: string[]; rows: string[][] } | undefined {
  if (payload.kind === 'training') {
    const mentioned: TrainingExerciseRow[] = payload.exercises?.length
      ? payload.exercises
      : (payload.regions ?? []).map((region) => ({ name: regionTrainingName(region) }));
    const exercises = mentioned.filter(hasRecordedData);
    if (!exercises.length) return undefined;
    return {
      columns: TRAINING_COLUMNS,
      rows: exercises.map((exercise) => [
        exercise.name,
        exercise.sets === undefined ? '—' : String(exercise.sets),
        exercise.reps ?? '—',
        exercise.weight ?? '—',
        exercise.duration ?? '—',
      ]),
    };
  }
  if (payload.kind === 'sleep') {
    const rows = SLEEP_LABELS
      .filter(([key]) => payload.sleep?.[key])
      .map(([key, label]) => [label, payload.sleep?.[key] as string]);
    return rows.length ? { columns: SLEEP_COLUMNS, rows } : undefined;
  }
  return undefined;
}

/** 标准化记录表格：语音与详细训练统一呈现结构化 JSON，不再展示原话；饮食分量可内联编辑 */
export default function EntryTable({ payload, href }: { payload: QuickPayload; href?: string }) {
  if (payload.kind === 'meal' && payload.items?.length) {
    const withMeal = payload.items.some((item) => item.meal);
    return (
      <div className="entry-table-wrap">
        <table className="entry-table">
          <thead><tr>{(withMeal ? [...MEAL_COLUMNS, '餐次'] : MEAL_COLUMNS).map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
          <tbody>
            {payload.items.map((item, index) => <tr key={index}>
              <td>{href ? <Link className="entry-food-link" href={href}>{item.name}</Link> : item.name}</td>
              <td><MealAmount name={item.name} amount={item.amount} grams={item.grams} src={item.src} /></td>
              {withMeal && <td>{`${item.meal ?? '—'}${item.planned && !payload.planned ? ' · 计划' : ''}`}</td>}
            </tr>)}
          </tbody>
        </table>
      </div>
    );
  }
  const table = rowsOf(payload);
  if (!table) return <strong className="entry-detail">{trainingSummary(payload) ?? ''}</strong>;
  const body = (
    <div className="entry-table-wrap">
      <table className="entry-table">
        <thead><tr>{table.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
  return href ? <Link href={href} className="entry-table-link">{body}</Link> : body;
}