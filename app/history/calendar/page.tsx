import Link from 'next/link';
import JournalIcon from '@/components/JournalIcon';
import JournalShell from '@/components/JournalShell';
import { journalMarkers } from '@/lib/core/journal';
import { todayStr } from '@/lib/core/workout';
import { humanDate } from '@/lib/date';
import { addDays, monthDays, shiftMonth, validDate } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: '记录月历 · FitCheck' };

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

export default async function CalendarPage({ searchParams }: {
  searchParams: Promise<{ date?: string; period?: string }>;
}) {
  const params = await searchParams;
  const today = todayStr();
  const anchor = validDate(params.date) ? params.date : today;
  const [year, monthNumber] = anchor.split('-');
  const month = anchor.slice(0, 7);
  const days = monthDays(month);
  const first = days[0];
  const last = days[days.length - 1];
  const gridStart = addDays(first.date, -first.weekday);
  const weekCount = Math.ceil((first.weekday + days.length) / 7);
  const markers = journalMarkers(first.date, last.date);
  const period = params.period === 'day' || params.period === 'week' ? params.period : 'month';
  const monthLink = (date: string) => `/history/calendar?date=${date}&period=${period}`;
  const previousMonth = shiftMonth(month, -1) + '-01';
  const nextMonth = shiftMonth(month, 1) + '-01';
  const trainingDays = Array.from(markers.values()).filter((marker) => marker.training > 0).length;
  const mealDays = Array.from(markers.values()).filter((marker) => marker.meal > 0).length;

  return <JournalShell active="review" title="记录月历"
    back={{ href: `/history?period=${period}&date=${anchor}`, label: '回顾' }}>
    <section className="month-calendar" aria-label={`${year}年${Number(monthNumber)}月月历`}>
      <div className="calendar-month">
        {validDate(previousMonth)
          ? <Link className="journal-icon-button" href={monthLink(previousMonth)} aria-label="上个月">‹</Link>
          : <span />}
        <h2><span>{year} 年</span>{Number(monthNumber)} 月</h2>
        {validDate(nextMonth)
          ? <Link className="journal-icon-button" href={monthLink(nextMonth)} aria-label="下个月">›</Link>
          : <span />}
      </div>

      <table className="calendar-grid" aria-label="按日查看训练和饮食记录">
        <thead><tr>{weekdays.map((weekday) => <th key={weekday} scope="col" aria-label={`周${weekday}`}>{weekday}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: weekCount }, (_, week) => (
            <tr key={week}>
              {weekdays.map((weekday, index) => {
                const date = addDays(gridStart, week * 7 + index);
                const day = Number(date.slice(8));
                if (!date.startsWith(month)) {
                  return <td key={weekday}><span className="calendar-outside" aria-hidden="true">{day}</span></td>;
                }
                const { training = 0, meal = 0 } = markers.get(date) ?? {};
                const records = [training > 0 && `${training} 条训练`, meal > 0 && `${meal} 条饮食`].filter(Boolean).join('，');
                return <td key={weekday}>
                  <Link className={`calendar-day${date === anchor ? ' selected' : ''}`}
                    href={`/history/${date}?from=calendar&period=${period}`}
                    aria-current={date === today ? 'date' : undefined}
                    aria-label={`${humanDate(date)}${records ? `，${records}` : '，无记录'}`}>
                    <span className="calendar-day-number">{day}</span>
                    <span className="calendar-markers">
                      {training > 0 && <span className="calendar-marker training"><JournalIcon name="training" /></span>}
                      {meal > 0 && <span className="calendar-marker meal"><JournalIcon name="meal" /></span>}
                    </span>
                  </Link>
                </td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="calendar-legend" aria-label="本月记录统计">
        <span><span className="calendar-marker training"><JournalIcon name="training" /></span>训练 {trainingDays} 天</span>
        <span><span className="calendar-marker meal"><JournalIcon name="meal" /></span>饮食 {mealDays} 天</span>
        {month !== today.slice(0, 7) && <Link href={monthLink(today)}>本月</Link>}
      </div>
    </section>
  </JournalShell>;
}
