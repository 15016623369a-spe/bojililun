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
import SculptureBody from '@/components/fc/SculptureBody';
import JournalIcon from '@/components/JournalIcon';
import { getTrainingModelSex } from '@/lib/core/training-profile';
import { sculptureGroup, sculptureVariant } from '@/lib/sculpture-groups';
import type { MuscleId } from '@/lib/muscles';
import JournalExport from '@/components/fc/JournalExport';

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
  const levels = new Map<MuscleId, number>();
  let strongestSide: 'front' | 'back' = 'back';
  let strongestScore = 0;
  for (const [id, value] of Object.entries(heat)) {
    const group = sculptureGroup(id);
    if (!group || !value.level) continue;
    levels.set(group.id, Math.max(levels.get(group.id) ?? 0, value.level / 3));
    if (group.side !== 'both' && value.score > strongestScore) {
      strongestSide = group.side;
      strongestScore = value.score;
    }
  }
  const trainingDays = days.filter((d) => d.entries.some((e) => e.entry_type === 'workout')).length;
  const groups = days.reduce((sum, d) => sum + d.daily_summary.totalSets, 0);
  const periodLabel = { day: '今日', week: '本周', month: '本月' }[period];
  const variant = sculptureVariant(getTrainingModelSex());
  const hasRecords = days.some((d) => d.entries.length || d.body_metrics.length);
  return (
    <div className="fc">
      <div className="fc-shell review fc-ledger-review" data-heat-palette="ink">
        <header>
          <div className="fc-review-header">
            <div className="fc-brand">
              <LeafIcon />
              FitCheck
            </div>
            <Link href="/me" className="journal-icon-button" aria-label="我的个人资料">
              <JournalIcon name="profile" />
            </Link>
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
        <section className="review-overview fc-sculpture-overview" aria-label={periodLabel + '概览'}>
          <figure className="review-figure" aria-label="训练部位雕塑热图">
            <div className="review-body">
              <SculptureBody
                key={variant + period}
                variant={variant}
                look="sculpture"
                heatPalette="ink"
                side={strongestSide}
                heatLevels={levels}
                recorded={[...levels.keys()]}
              />
            </div>
          </figure>
          <div className="review-overview-metrics">
            <h2>{periodLabel}概览</h2>
            <dl>
              <div>
                <dt>训练天数</dt>
                <dd>
                  {trainingDays} <small>天</small>
                </dd>
              </div>
              <div>
                <dt>已记录训练组</dt>
                <dd>
                  {groups} <small>组</small>
                </dd>
              </div>
            </dl>
          </div>
        </section>
        <div className="review-heat-legend" role="img" aria-label="按训练计分着色，由未训练到训练较多">
          <span>未训练</span>
          <i />
          <i />
          <i />
          <i />
          <span>训练较多</span>
        </div>
        {trend.latest !== null && (
          <div className="fc-weight-summary">
            <span>
              晨重 <strong>{trend.latest} kg</strong>
            </span>
            <span>区间变化 {trend.change} kg</span>
            <span>7 日均重 {trend.points.at(-1)?.average7} kg</span>
          </div>
        )}
        <h2 className="fc-review-records-title">{periodLabel}记录</h2>
        {!hasRecords && <p className="journal-muted">这段时间还没有记录。</p>}
        {days
          .filter((d) => d.entries.length || d.body_metrics.length)
          .reverse()
          .map((d) => (
            <section key={d.date} className="fc-review-day">
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
