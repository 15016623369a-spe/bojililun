import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import ReviewJournal from '@/components/ReviewJournal';
import BigDate from '@/components/ui/BigDate';
import Icon from '@/components/ui/Icon';
import { getTrainingModelSex } from '@/lib/core/training-profile';
import { sculptureVariant } from '@/lib/sculpture-groups';
import { recordedJournalForDate } from '@/lib/core/journal';
import { primaryMuscleActivity, todayStr, trainingTimeByDate, trendStats } from '@/lib/core/workout';
import { addDays, periodRange, shiftMonth, validDate } from '@/lib/period';
import type { MuscleId } from '@/lib/muscles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: '回顾 · FitCheck' };

const periods = [{ key: 'day', label: '日' }, { key: 'week', label: '周' }, { key: 'month', label: '月' }] as const;
const short = (date: string) => `${date.slice(5, 7)}.${date.slice(8)}`;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ period?: string; date?: string; month?: string }> }) {
  const params = await searchParams;
  const today = todayStr();
  const monthDate = /^\d{4}-\d{2}$/.test(params.month ?? '') ? params.month + '-01' : undefined;
  const anchor = validDate(params.date) ? params.date : validDate(monthDate) ? monthDate : today;
  const period = params.period === 'day' || params.period === 'week' || params.period === 'month' ? params.period : monthDate ? 'month' : 'week';
  const { start, end } = period === 'day' ? { start: anchor, end: anchor } : periodRange(period, anchor);
  const href = (key: string, date: string) => `/history?period=${key}&date=${date}`;
  const step = (direction: number) => period === 'month'
    ? shiftMonth(anchor.slice(0, 7), direction) + '-01'
    : addDays(anchor, direction * (period === 'day' ? 1 : 7));
  const days = [];
  for (let date = end; date >= start; date = addDays(date, -1)) {
    const entries = recordedJournalForDate(date);
    if (entries.length) days.push({ date, entries });
  }
  const duration = period === 'day' ? 0 : trainingTimeByDate(start, end).reduce((sum, row) => sum + row.seconds, 0);
  const volumeByDate = new Map(trendStats(start, end).map((row) => [row.date, row.volume]));
  const bars = [];
  if (period !== 'day') for (let date = start; date <= end; date = addDays(date, 1)) bars.push({ date, volume: volumeByDate.get(date) ?? 0 });
  const perMuscle = new Map<MuscleId, number>();
  if (period !== 'day') for (const row of primaryMuscleActivity(start, end)) perMuscle.set(row.id, (perMuscle.get(row.id) ?? 0) + row.volume);
  const calendarHref = `/history/calendar?date=${anchor}&period=${period}`;
  const rangeLabel = period === 'month' ? `${start.slice(0, 4)}.${start.slice(5, 7)}`
    : start === end ? short(start) : `${short(start)} — ${short(end)}`;
  const daySummary = period === 'day' ? (() => {
    const entries = days[0]?.entries ?? [];
    const meals = entries.filter((entry) => entry.kind === 'meal' && !entry.payload?.planned).length;
    const workouts = entries.filter((entry) => entry.kind === 'training').length;
    return `${meals} 餐 · ${workouts} 项训练`;
  })() : '';

  return <JournalShell active="review" title="回顾" today={today} className="is-review"
    headerAction={<div className="journal-head-actions">
      <span className="journal-head-label">回顾</span>
      <Link href="/me" className="journal-head-circle" aria-label="我的个人资料"><Icon name="user" size={18} /></Link>
    </div>}
    hero={<>
      <div className="review-range">
        <Link className="range-step" href={href(period, step(-1))} aria-label="上一段时间"><Icon name="chevron-left" size={18} stroke={2} /></Link>
        <Link className="range-label" href={calendarHref} aria-label={`打开月历，当前 ${rangeLabel}`}>{rangeLabel}</Link>
        <Link className="range-step" href={href(period, step(1))} aria-label="下一段时间"><Icon name="chevron-right" size={18} stroke={2} /></Link>
        <nav className="vseg small" aria-label="回顾范围">
          {periods.map(({ key, label }) => <Link href={href(key, anchor)} key={key} className={key === period ? 'on' : ''}
            aria-current={key === period ? 'page' : undefined}>{label}</Link>)}
        </nav>
      </div>
      {period === 'day' && <BigDate date={anchor} note={daySummary} />}
    </>}>
    <ReviewJournal key={period + anchor} days={days} period={period} variant={sculptureVariant(getTrainingModelSex())}
      duration={duration} calendarHref={calendarHref} anchor={anchor} today={today} bars={bars}
      muscleVolume={[...perMuscle].map(([id, volume]) => ({ id, volume }))} />
  </JournalShell>;
}
