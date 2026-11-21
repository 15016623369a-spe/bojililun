'use client';

import Link from 'next/link';
import { hasRecordedData, mealItemKcal, regionTrainingName, trainingSummary, type JournalEntry, type QuickPayload, type TrainingExerciseRow } from '@/lib/journal';
import MealAmount from './MealAmount';
import QuickMealDetails from './QuickMealDetails';

const TRAINING_COLUMNS = ['动作', '组数', '次数', '重量', '用时'];
const MEAL_COLUMNS = ['食物', '分量', '热量'];
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
export default function EntryTable({ payload, href, onQuickSave }: {
  payload: QuickPayload;
  href?: string;
  onQuickSave?: (entry: JournalEntry) => void;
}) {
  if (payload.kind === 'meal' && payload.items?.length) {
    const withMeal = payload.items.some((item) => item.meal)
      && (!payload.mealType || new Set(payload.items.map((item) => item.meal ?? payload.mealType)).size > 1);
    return (
      <div className="entry-table-wrap">
        <table className="entry-table">
          <thead><tr>{(withMeal ? [...MEAL_COLUMNS, '餐次'] : MEAL_COLUMNS).map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
          <tbody>
            {payload.items.map((item, index) => {
              const source = item.src;
              const key = source ? `${source.kind}-${source.kind === 'quick' ? source.quickId : source.mealId}-${source.index}` : index;
              const kcal = mealItemKcal(item);
              return <tr key={key}>
              <td>{source?.kind === 'quick'
                ? <QuickMealDetails item={item} mealType={payload.mealType} onSave={onQuickSave} />
                : href ? <Link className="entry-food-link" href={href}>{item.name}</Link> : item.name}
                {!withMeal && item.planned && !payload.planned && <span className="entry-tag">计划</span>}</td>
              <td><MealAmount name={item.name} amount={item.amount} grams={item.grams} src={item.src}
                estimatedGrams={item.estimatedGrams} onQuickSave={onQuickSave} /></td>
              <td>{kcal !== undefined ? `${item.manualKcal === undefined ? '约 ' : ''}${kcal} kcal`
                : item.nutritionIssue === 'food' ? '食物待匹配'
                  : item.nutritionIssue === 'amount' ? '分量待补' : '待补'}</td>
              {withMeal && <td>{`${item.meal ?? payload.mealType ?? '—'}${item.planned && !payload.planned ? ' · 计划' : ''}`}</td>}
            </tr>;
            })}
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
