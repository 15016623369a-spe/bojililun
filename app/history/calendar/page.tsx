import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import Icon from '@/components/ui/Icon';
import SplitNumber from '@/components/ui/SplitNumber';
import { journalMarkers } from '@/lib/core/journal';
import { monthOverview, todayStr } from '@/lib/core/workout';
import { humanDate } from '@/lib/date';
import { addDays, monthDays, shiftMonth, validDate } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: '训练月历 · FitCheck' };

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
  const overview = monthOverview(month);
  const period = params.period === 'day' || params.period === 'week' ? params.period : 'month';
  const monthLink = (date: string) => `/history/calendar?date=${date}&period=${period}`;
  const previousMonth = shiftMonth(month, -1) + '-01';
  const nextMonth = shiftMonth(month, 1) + '-01';
  const trainingDays = days.filter(({ date }) => (markers.get(date)?.training ?? 0) > 0 || (overview.get(date)?.sessions ?? 0) > 0).length;
  const mealDays = Array.from(markers.values()).filter((marker) => marker.meal > 0).length;
  const monthVolume = Array.from(overview.values()).reduce((sum, day) => sum + day.volume, 0);
  const maxVolume = Math.max(1, ...Array.from(overview.values()).map((day) => day.volume));

  // 点数 = 当日容量：没练 0 点，练了但没有负重 1 点，有负重按本月最高日折算 2–9 点
  const dotsFor = (date: string) => {
    const volume = overview.get(date)?.volume ?? 0;
    const trained = (markers.get(date)?.training ?? 0) > 0 || (overview.get(date)?.sessions ?? 0) > 0;
    if (!trained) return 0;
    return volume > 0 ? Math.min(9, 2 + Math.round(volume / maxVolume * 7)) : 1;
  };

  return <JournalShell active="review" title={`${year} 年 ${Number(monthNumber)} 月训练月历`} className="is-review is-calendar"
    back={{ href: `/history?period=${period}&date=${anchor}`, label: '回顾' }}
    hero={<div className="month-hero">
      <div className="big-num month-big">{Number(monthNumber)}<span className="dim">月</span></div>
      <div className="month-hero-side">
        <b className="big-num">{year}</b>
        <div className="month-steps">
          {validDate(previousMonth) && <Link className="range-step" href={monthLink(previousMonth)} aria-label="上个月"><Icon name="chevron-left" size={18} stroke={2} /></Link>}
          {validDate(nextMonth) && <Link className="range-step" href={monthLink(nextMonth)} aria-label="下个月"><Icon name="chevron-right" size={18} stroke={2} /></Link>}
        </div>
      </div>
    </div>}>
    <table className="dot-calendar" aria-label={`${year}年${Number(monthNumber)}月，点数表示当日训练容量`}>
      <thead><tr>{weekdays.map((weekday) => <th key={weekday} scope="col" aria-label={`周${weekday}`}>{weekday}</th>)}</tr></thead>
      <tbody>
        {Array.from({ length: weekCount }, (_, week) => (
          <tr key={week}>
            {weekdays.map((weekday, index) => {
              const date = addDays(gridStart, week * 7 + index);
              if (!date.startsWith(month)) return <td key={weekday} aria-hidden="true" />;
              const dots = dotsFor(date);
              const { training = 0, meal = 0 } = markers.get(date) ?? {};
              const volume = overview.get(date)?.volume ?? 0;
              const label = [humanDate(date), training || dots ? (volume ? `训练 ${volume} kg` : '有训练') : '', meal ? `${meal} 条饮食` : ''].filter(Boolean).join('，');
              return <td key={weekday}>
                <Link className="dot-day" href={`/history/${date}?from=calendar&period=${period}`}
                  data-selected={date === anchor || undefined} data-today={date === today || undefined} data-future={date > today || undefined}
                  aria-current={date === today ? 'date' : undefined} aria-label={label || `${humanDate(date)}，无记录`}>
                  <span className="dot-day-num">{Number(date.slice(8))}</span>
                  <span className="dot-day-grid" aria-hidden="true">
                    {Array.from({ length: 9 }, (_, i) => <i key={i} data-on={i < dots || undefined} />)}
                  </span>
                  {meal > 0 && <span className="dot-day-meal" aria-hidden="true" />}
                </Link>
              </td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>

    <div className="calendar-key" aria-hidden="true">
      <span>点数＝当日容量</span>
      <span><i className="key-sel" />选中</span>
      <span><i className="key-today" />今天</span>
      <span><i className="key-meal" />有饮食 {mealDays} 天</span>
    </div>

    <div className="readouts two">
      <div className="readout"><b className="big-num">{trainingDays}</b><span>天</span><em>训练天数</em></div>
      <div className="readout lemon"><SplitNumber value={monthVolume} /><span>kg</span><em>本月容量</em></div>
    </div>

    <Link className="v-link-row" href={`/history/${anchor}?from=calendar&period=${period}`}>
      <span><b className="big-num small">{anchor.slice(5, 7)}.{anchor.slice(8)}</b>详情</span><Icon name="chevron-right" size={18} />
    </Link>
    {month !== today.slice(0, 7) && <Link className="v-link-row" href={monthLink(today)}><span>回到本月</span><Icon name="chevron-right" size={18} /></Link>}
  </JournalShell>;
}
