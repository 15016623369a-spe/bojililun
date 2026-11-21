import type { Metadata } from 'next';
import Link from 'next/link';
import TabBar from '@/components/fc/TabBar';
import { LeafIcon } from '@/components/fc/icons';
import { type ReviewPeriod } from '@/lib/log';
import { getDb } from '@/lib/db';
import { exportJournal } from '@/lib/export';
import { calcMuscleHeatmap, calcWeightTrend } from '@/lib/calculations';
import { localDay } from '@/lib/ledger';
import { periodRange } from '@/lib/period';
import BodyHeat from '@/components/fc/BodyHeat';
import JournalExport from '@/components/fc/JournalExport';
import type { TimelineEntry } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '回顾 · FitCheck',
};

const SEGMENTS: Array<{ key: ReviewPeriod; label: string }> = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
];

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const period: ReviewPeriod = sp.period === 'day' || sp.period === 'month' ? sp.period : 'week';
  const today = localDay(new Date().toISOString());
  const start = period === 'day' ? today : periodRange(period, today).start;
  const lookback = new Date(Date.parse(start) - 6 * 86400000).toISOString().slice(0, 10);
  const book = exportJournal(getDb(), 'local', lookback, today);
  const days = book.days.filter((d) => d.date >= start);
  const heat = calcMuscleHeatmap(
    days.flatMap((d) => d.entries),
    period,
  );
  const trend = calcWeightTrend(
    book.days.flatMap((d) => d.body_metrics),
    start,
    today,
  );
  return (
    <div className="fc">
      <div className="fc-shell review">
        <header>
          <div className="fc-brand">
            <LeafIcon />
            FitCheck
          </div>
          <h1 className="fc-h1">回顾</h1>
        </header>

        <div className="fc-seg" role="tablist" aria-label="统计区间">
          {SEGMENTS.map((s) => (
            <Link
              key={s.key}
              href={s.key === 'week' ? '/review' : `/review?period=${s.key}`}
              className={period === s.key ? 'on' : ''}
              scroll={false}
              role="tab"
              aria-selected={period === s.key}
            >
              {s.label}
            </Link>
          ))}
        </div>

        <p className="fc-range">
          {start} — {today}
        </p>
        <BodyHeat
          heat={Object.entries(heat)
            .filter(([, v]) => v.level > 0)
            .map(([id, v]) => ({ id, level: v.level / 3 }))}
        />
        {trend.latest !== null && (
          <p>
            晨重 {trend.latest} kg · 区间变化 {trend.change} kg · 7 日均重 {trend.points.at(-1)?.average7} kg
          </p>
        )}
        {days
          .filter((d) => d.entries.length || d.body_metrics.length)
          .reverse()
          .map((d) => (
            <section key={d.date}>
              <h2 className="fc-day">{d.date}</h2>
              {d.entries.map((c) => (
                <p key={c.id}>{c.summary_title}</p>
              ))}
              {d.entries.some((entry) => entry.entry_type === 'meal') && (
                <small style={{ display: 'block' }}>
                  蛋白质 {d.daily_summary.intake.protein_g ?? '—'} g · 碳水{' '}
                  {d.daily_summary.intake.carbs_g ?? '—'} g · 脂肪 {d.daily_summary.intake.fat_g ?? '—'} g
                  {d.daily_summary.intake.hasEstimates ? ' · 含估算' : ''}
                  {d.daily_summary.intake.incomplete_fields.length ? ' · 部分数据缺失' : ''}
                </small>
              )}
              <small>
                {d.daily_summary.totalSets} 组 · {d.daily_summary.totalVolumeKg} kg
              </small>
            </section>
          ))}
        <JournalExport today={today} />
        <div className="fc-more">
          <Link href="/train">训练计划</Link>
          <Link href="/exercises">动作库</Link>
          <Link href="/me">我的</Link>
        </div>
      </div>

      <div className="fc-dock">
        <div className="fc-dock-inner nav-only">
          <TabBar active="review" />
        </div>
      </div>
    </div>
  );
}
