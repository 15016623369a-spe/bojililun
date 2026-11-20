import type { PlanItem } from '@/lib/types';
import SupplementalMark from './SupplementalMark';

export default function DayPlan({ items }: { items: PlanItem[] }) {
  return <ul className="day-plan">
    {items.map((item) => <li key={item.id}>
      <span>{item.supplemental ? <SupplementalMark /> : null}{item.done ? '✓ ' : ''}{item.name}</span>
      <small>{item.sets} 组 × {item.reps} 次 · {item.weight > 0 ? `${item.weight} kg` : '自重'} · 休息 {item.rest_sec} 秒</small>
    </li>)}
  </ul>;
}
