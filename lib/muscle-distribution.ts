import type { MuscleId } from './muscles';
import type { primaryMuscleActivity } from './core/workout';
import { addDays, type Period } from './period';

const groups: { label: string; muscles: MuscleId[] }[] = [
  { label: '胸', muscles: ['chest_upper', 'chest_mid', 'chest_lower', 'serratus'] },
  { label: '背', muscles: ['lats', 'traps', 'upperback', 'lowerback'] },
  { label: '大腿', muscles: ['quads', 'hamstrings', 'adductors'] },
  { label: '肩', muscles: ['delt_front', 'delt_side', 'delt_rear'] },
  { label: '二头', muscles: ['biceps'] },
  { label: '三头', muscles: ['triceps'] },
  { label: '小腿', muscles: ['calves'] },
  { label: '臀部', muscles: ['glutes'] },
  { label: '腰腹', muscles: ['abs', 'obliques'] },
  { label: '前臂', muscles: ['forearms'] },
  { label: '颈部', muscles: ['neck'] },
];

export function muscleDistribution(activity: ReturnType<typeof primaryMuscleActivity>, period: Period, start: string, end: string) {
  const daily = period === 'week' || period === 'month';
  const points: { key: string; label: string }[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const key = daily ? date : date.slice(0, 7);
    if (points.at(-1)?.key === key) continue;
    const label = period === 'week' ? ['一', '二', '三', '四', '五', '六', '日'][points.length]
      : daily ? String(Number(date.slice(8))) : `${Number(date.slice(5, 7))}月`;
    points.push({ key, label });
  }

  const groupByMuscle = new Map(groups.flatMap(({ label, muscles }) => muscles.map((id) => [id, label] as const)));
  const totals = new Map<string, { volume: number; sets: number; seconds: number; sessions: Set<number> }>();
  for (const row of activity) {
    const group = groupByMuscle.get(row.id);
    if (!group) continue;
    const date = daily ? row.date : row.date.slice(0, 7);
    const key = `${group}-${date}`;
    const aggregate = totals.get(key) ?? { volume: 0, sets: 0, seconds: 0, sessions: new Set<number>() };
    aggregate.volume += row.volume;
    aggregate.sets += row.sets;
    aggregate.seconds += row.seconds;
    aggregate.sessions.add(row.sessionId);
    totals.set(key, aggregate);
  }

  return groups.map(({ label }) => ({
    label,
    points: points.map(({ key, label: tick }) => {
      const aggregate = totals.get(`${label}-${key}`);
      return {
        key, tick, sets: aggregate?.sets ?? 0, volume: aggregate?.volume ?? 0,
        seconds: aggregate?.seconds ?? 0, sessions: aggregate?.sessions.size ?? 0,
      };
    }),
  }));
}
