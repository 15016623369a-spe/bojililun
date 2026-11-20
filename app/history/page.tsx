import Link from 'next/link';
import JournalIcon from '@/components/JournalIcon';
import JournalShell from '@/components/JournalShell';
import ReviewJournal from '@/components/ReviewJournal';
import { getTrainingModelSex } from '@/lib/core/training-profile';
import { sculptureVariant } from '@/lib/sculpture-groups';
import { recordedJournalForDate } from '@/lib/core/journal';
import { todayStr, trainingTimeByDate } from '@/lib/core/workout';
import { addDays, periodRange, shiftMonth, validDate } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: '回顾 · FitCheck' };

const periods = [{ key: 'day', label: '日' }, { key: 'week', label: '周' }, { key: 'month', label: '月' }] as const;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ period?: string; date?: string; month?: string }> }) {
  const params = await searchParams;
  const today = todayStr();
  const monthDate = /^\d{4}-\d{2}$/.test(params.month ?? '') ? params.month + '-01' : undefined;
  const anchor = validDate(params.date) ? params.date : validDate(monthDate) ? monthDate : today;
  const period = params.period === 'day' || params.period === 'week' || params.period === 'month' ? params.period : monthDate ? 'month' : 'week';
  const { start, end } = period === 'day' ? { start: anchor, end: anchor } : periodRange(period, anchor);
  const dateLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
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
  const calendarHref = `/history/calendar?date=${anchor}&period=${period}`;
  return <JournalShell active="review" title="回顾" today={today}
    headerAction={<Link href="/me" className="journal-icon-button review-profile-link" aria-label="我的个人资料" title="我的">
      <JournalIcon name="profile" />
    </Link>}>
    <nav className="review-period" aria-label="回顾范围">
      {periods.map(({ key, label }) => <Link href={href(key, anchor)} key={key} aria-current={key === period ? 'page' : undefined}>{label}</Link>)}
    </nav>
    <div className="review-dates">
      <Link className="journal-icon-button" href={href(period, step(-1))} aria-label="上一段时间">‹</Link>
      <Link className="review-calendar-link" href={`/history/calendar?date=${anchor}&period=${period}`}
        aria-label={`打开月历，${start === end ? dateLabel(start) : `${dateLabel(start)}至${dateLabel(end)}`}`}>
        <JournalIcon name="calendar" />
        {period === 'month' ? `${start.slice(0, 4)} 年 ${Number(start.slice(5, 7))} 月`
          : start === end ? dateLabel(start) : `${dateLabel(start)} — ${dateLabel(end)}`}
      </Link>
      <Link className="journal-icon-button" href={href(period, step(1))} aria-label="下一段时间">›</Link>
    </div>
    <ReviewJournal key={period + anchor} days={days} period={period} variant={sculptureVariant(getTrainingModelSex())}
      duration={duration} calendarHref={calendarHref} anchor={anchor} />
    <Link href="/stats" className="review-stats-link">
      <span className="review-stats-icon"><JournalIcon name="review" /></span>
      <strong>训练统计</strong>
      <span className="review-stats-arrow" aria-hidden="true">›</span>
    </Link>
  </JournalShell>;
}
