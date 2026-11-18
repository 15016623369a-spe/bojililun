import Link from 'next/link';
import BottomNav from '@/components/BottomNav';
import { monthDays, shiftMonth } from '@/lib/period';
import { monthOverview, todayStr } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const today = todayStr();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : today.slice(0, 7);
  const days = monthDays(month);
  const overview = monthOverview(month);
  const [y, m] = month.split('-').map(Number);

  const totalVolume = [...overview.values()].reduce((a, d) => a + d.volume, 0);
  const totalDays = [...overview.values()].filter((d) => d.sessions > 0).length;

  return (
    <div className="page">
      <header className="page-hdr">
        <div>
          <h1>历史</h1>
          <p>
            本月训练 {totalDays} 天 · 容量 {totalVolume.toLocaleString('en-US')} kg
          </p>
        </div>
      </header>

      <div className="page-body">
        <div className="month-nav">
          <Link href={`/history?month=${shiftMonth(month, -1)}`} aria-label="上个月">
            ‹
          </Link>
          <div>
            {y} 年 {m} 月
          </div>
          <Link href={`/history?month=${shiftMonth(month, 1)}`} aria-label="下个月">
            ›
          </Link>
        </div>

        <div className="cal">
          {WEEK.map((w) => (
            <div className="cal-hd" key={w}>
              {w}
            </div>
          ))}
          {Array.from({ length: days[0]?.weekday ?? 0 }).map((_, i) => (
            <div key={`pad-${i}`} className="cal-cell pad" />
          ))}
          {days.map((d) => {
            const o = overview.get(d.date);
            const isToday = d.date === today;
            return (
              <Link
                key={d.date}
                href={`/history/${d.date}`}
                className={`cal-cell ${isToday ? 'today' : ''} ${o ? 'has' : ''}`}
              >
                <span className="cal-day">{d.day}</span>
                <span className="cal-dots">
                  {o && o.sessions > 0 && <i className="dot green" />}
                  {o && o.kcal > 0 && <i className="dot orange" />}
                </span>
                {o && o.volume > 0 && <em className="cal-vol">{(o.volume / 1000).toFixed(1)}t</em>}
              </Link>
            );
          })}
        </div>

        <p className="legend">
          <i className="dot green" /> 有训练 <i className="dot orange" /> 有饮食记录
        </p>

        <section className="block">
          <h2 className="block-title">本月有记录的日子</h2>
          {overview.size === 0 ? (
            <p className="hint">这个月还没有记录。</p>
          ) : (
            <div className="day-list">
              {[...overview.values()]
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .slice(0, 8)
                .map((o) => (
                  <Link key={o.date} href={`/history/${o.date}`} className="day-row">
                    <div>
                      <b>{o.date}</b>
                      <span>
                        {o.sessions > 0 ? `${o.sessions} 次训练 · ${o.sets} 组 · ${o.volume.toLocaleString('en-US')} kg` : '只有饮食记录'}
                      </span>
                    </div>
                    <em>{o.kcal > 0 ? `${o.kcal} kcal` : ''}</em>
                  </Link>
                ))}
            </div>
          )}
        </section>
      </div>

      <BottomNav active="history" />
    </div>
  );
}
