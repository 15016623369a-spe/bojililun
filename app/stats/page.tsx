import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import StatsBoard, { type Bucket, type MuscleRow } from '@/components/StatsBoard';
import Icon from '@/components/ui/Icon';
import { muscleDistribution } from '@/lib/muscle-distribution';
import { PERIOD_LABEL, addDays, periodRange, type Period } from '@/lib/period';
import { exercisePerformance, primaryMuscleActivity, todayStr, trainingTimeByDate, trendStats, volumeStats } from '@/lib/core/workout';
import type { MuscleId } from '@/lib/muscles';
import { getTrainingModelSex } from '@/lib/core/training-profile';
import { sculptureVariant } from '@/lib/sculpture-groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: '训练统计 · FitCheck' };

const PERIODS: Period[] = ['week', 'month', 'quarter', 'year'];
const PERIOD_SHORT: Record<string, string> = { week: '周', month: '月', quarter: '季', year: '年' };
const WEEK_CN = ['一', '二', '三', '四', '五', '六', '日'];
const VIEWS = ['overview', 'muscles', 'exercises'] as const;

type SP = Promise<{ period?: string; view?: string }>;

/** 周、月按天，季、年按月；每格带稳定的 key（日期或月份），切换指标时保留选中位置 */
function bucketize(period: Period, start: string, end: string, values: ReadonlyMap<string, number>): Bucket[] {
  const buckets: Bucket[] = [];
  if (period === 'week' || period === 'month') {
    for (let date = start, i = 0; date <= end; date = addDays(date, 1), i++) {
      buckets.push({ key: date, label: period === 'week' ? WEEK_CN[i] : String(i + 1), value: values.get(date) ?? 0 });
    }
    return buckets;
  }
  const byMonth = new Map<string, number>();
  for (const [date, value] of values) byMonth.set(date.slice(0, 7), (byMonth.get(date.slice(0, 7)) ?? 0) + value);
  for (let m = Number(start.slice(5, 7)); m <= Number(end.slice(5, 7)); m++) {
    const month = `${start.slice(0, 4)}-${String(m).padStart(2, '0')}`;
    buckets.push({ key: month, label: period === 'quarter' ? `${m}月` : String(m), value: byMonth.get(month) ?? 0 });
  }
  return buckets;
}

export default async function StatsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const period: Period = PERIODS.includes(sp.period as Period) ? (sp.period as Period) : 'week';
  const view = VIEWS.includes(sp.view as typeof VIEWS[number]) ? sp.view as typeof VIEWS[number] : 'overview';
  const today = todayStr();
  const r = periodRange(period, today);

  const cur = volumeStats(r.start, r.end);
  const prev = volumeStats(r.prevStart, r.prevEnd);
  const activity = primaryMuscleActivity(r.start, r.end);
  const perMuscle = new Map<MuscleId, MuscleRow & { sessionIds: Set<number> }>();
  for (const row of activity) {
    const current = perMuscle.get(row.id) ?? { id: row.id, volume: 0, sets: 0, sessions: 0, seconds: 0, sessionIds: new Set<number>() };
    current.volume += row.volume;
    current.sets += row.sets;
    current.seconds += row.seconds;
    current.sessionIds.add(row.sessionId);
    perMuscle.set(row.id, current);
  }
  const muscles: MuscleRow[] = [...perMuscle.values()].map(({ sessionIds, ...rest }) => ({ ...rest, sessions: sessionIds.size }));
  const trend = trendStats(r.start, r.end);
  const trainingTime = trainingTimeByDate(r.start, r.end);
  const short = (date: string) => `${date.slice(5, 7)}.${date.slice(8)}`;
  const rangeLabel = period === 'week' ? `${short(r.start)} — ${short(r.end)}`
    : period === 'month' ? `${short(r.start)} — ${short(r.end)}` : r.label;

  return (
    <JournalShell active="review" title="训练统计" className="is-review is-stats"
      headerAction={<div className="journal-head-actions">
        <span className="journal-head-label">训练统计</span>
        <Link className="journal-head-circle" href="/review" aria-label="回到回顾"><Icon name="close" size={16} stroke={2} /></Link>
      </div>}
      hero={<div className="review-range">
        <span className="range-label">{rangeLabel}</span>
        <nav className="vseg small" aria-label="统计周期">
          {PERIODS.map((p) => <Link key={p} href={`/stats?period=${p}`} className={period === p ? 'on' : ''}
            aria-current={period === p ? 'page' : undefined}>{PERIOD_SHORT[p]}</Link>)}
        </nav>
      </div>}>
      <StatsBoard key={period} period={period} periodLabel={PERIOD_LABEL[period]} initialView={view}
        volume={bucketize(period, r.start, r.end, new Map(trend.map(({ date, volume }) => [date, volume])))}
        time={bucketize(period, r.start, r.end, new Map(trainingTime.map(({ date, seconds }) => [date, seconds])))}
        cur={cur} prev={prev}
        totalSeconds={trainingTime.reduce((total, { seconds }) => total + seconds, 0)}
        timedSessions={trainingTime.reduce((total, { sessions }) => total + sessions, 0)}
        muscles={muscles} groups={muscleDistribution(activity, period, r.start, r.end)}
        exercises={exercisePerformance(r.start, r.end)} variant={sculptureVariant(getTrainingModelSex())} />
    </JournalShell>
  );
}
