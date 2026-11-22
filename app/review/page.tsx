import type { Metadata } from 'next';
import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import LedgerReview, { type HeatGroup, type ReviewDay } from '@/components/LedgerReview';
import JournalExport from '@/components/fc/JournalExport';
import Icon from '@/components/ui/Icon';
import { type ReviewPeriod } from '@/lib/log';
import { getDb } from '@/lib/db';
import { exportJournal } from '@/lib/export';
import { calcMuscleHeatmap, calcWeightTrend } from '@/lib/calculations';
import { localDay } from '@/lib/ledger';
import { addDays, periodRange } from '@/lib/period';
import { getTrainingModelSex } from '@/lib/core/training-profile';
import { sculptureGroup, sculptureVariant } from '@/lib/sculpture-groups';
import type { MuscleId } from '@/lib/muscles';

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
const short = (date: string) => `${date.slice(5, 7)}.${date.slice(8)}`;

/**
 * 回顾：数据和计算沿用手账（exportJournal、calcMuscleHeatmap、calcWeightTrend，区间截止到今天），
 * 版式换成新版的大号容量、每日柱、雕塑热图、晨重点阵和横条记录。
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const period: ReviewPeriod = sp.period === 'day' || sp.period === 'month' ? sp.period : 'week';
  const today = localDay(new Date().toISOString());
  const range = period === 'day' ? { start: today, end: today } : periodRange(period, today);
  const start = range.start;
  const lookback = addDays(start, -6);
  const book = exportJournal(getDb(), 'local', lookback, today);
  const inRange = book.days.filter((d) => d.date >= start);

  // 热图：main 的计分和三档分级，按雕塑分区取最高档
  const heat = calcMuscleHeatmap(inRange.flatMap((d) => d.entries), period);
  const best = new Map<MuscleId, { level: number; score: number }>();
  let side: 'front' | 'back' = 'back';
  let strongest = 0;
  for (const [id, value] of Object.entries(heat)) {
    const group = sculptureGroup(id);
    if (!group || !value.level) continue;
    const prev = best.get(group.id);
    best.set(group.id, { level: Math.max(prev?.level ?? 0, value.level), score: Math.max(prev?.score ?? 0, value.score) });
    if (group.side !== 'both' && value.score > strongest) { side = group.side; strongest = value.score; }
  }
  const groups: HeatGroup[] = [...best].map(([id, v]) => {
    const group = sculptureGroup(id)!;
    return { id, label: group.label, level: v.level, side: group.side, score: v.score };
  }).sort((a, b) => b.score - a.score).map(({ score: _score, ...g }) => g);

  const trend = calcWeightTrend(book.days.flatMap((d) => d.body_metrics), start, today);
  const byDate = new Map(inRange.map((d) => [d.date, d]));
  const dates: string[] = [];
  for (let d = start; d <= range.end; d = addDays(d, 1)) dates.push(d);
  const days: ReviewDay[] = dates.map((date) => {
    const d = byDate.get(date);
    const intake = d?.daily_summary.intake;
    const meals = d?.entries.filter((e) => e.entry_type === 'meal') ?? [];
    return {
      date,
      future: date > today,
      titles: d?.entries.map((e) => e.summary_title) ?? [],
      workouts: d?.entries.filter((e) => e.entry_type === 'workout').length ?? 0,
      meals: meals.length,
      sets: d?.daily_summary.totalSets ?? 0,
      volume: d?.daily_summary.totalVolumeKg ?? 0,
      kcal: meals.length ? intake?.kcal ?? null : null,
      protein: intake?.protein_g ?? null,
      carbs: intake?.carbs_g ?? null,
      fat: intake?.fat_g ?? null,
      estimated: Boolean(intake?.hasEstimates),
      incomplete: Boolean(intake?.incomplete_fields.length),
      weight: d?.body_metrics.at(-1)?.weight_kg ?? null,
    };
  });
  const trainingDays = inRange.filter((d) => d.entries.some((e) => e.entry_type === 'workout')).length;
  const totalSets = inRange.reduce((sum, d) => sum + d.daily_summary.totalSets, 0);
  const variant = sculptureVariant(getTrainingModelSex());
  const weight = trend.latest === null ? null : {
    latest: trend.latest,
    change: trend.change ?? 0,
    average7: trend.points.at(-1)?.average7 ?? null,
    points: trend.points.map((p) => ({ date: p.date, weight: p.weight_kg })),
  };

  return (
    <JournalShell active="review" title="回顾" today={today} className="is-review is-ledger-review"
      headerAction={<Link href="/me" className="head-avatar" aria-label="我的个人资料"><Icon name="user" size={19} /></Link>}
      hero={<>
        <p className="hero-word" aria-hidden="true">回顾</p>
        <div className="review-range">
          <span className="range-label">{period === 'day' ? short(today) : `${short(start)} — ${short(range.end)}`}</span>
          <nav className="vseg small" aria-label="统计区间">
            {SEGMENTS.map((s) => <Link key={s.key} href={s.key === 'week' ? '/review' : `/review?period=${s.key}`} scroll={false}
              className={period === s.key ? 'on' : undefined} aria-current={period === s.key ? 'page' : undefined}>{s.label}</Link>)}
          </nav>
        </div>
      </>}>
      <LedgerReview key={period} period={period} today={today} days={days} groups={groups} side={side} variant={variant}
        trainingDays={trainingDays} totalSets={totalSets} weight={weight} />

      <nav className="review-links" aria-label="更多">
        <Link href={`/stats?period=${period === 'month' ? 'month' : 'week'}`}><Icon name="chart" size={18} />训练统计<Icon name="chevron-right" size={18} /></Link>
        <Link href={`/history/calendar?date=${today}&period=${period}`}><Icon name="calendar" size={18} />训练月历<Icon name="chevron-right" size={18} /></Link>
        <Link href="/train"><Icon name="list" size={18} />训练计划<Icon name="chevron-right" size={18} /></Link>
        <Link href="/exercises"><Icon name="book" size={18} />动作库<Icon name="chevron-right" size={18} /></Link>
      </nav>

      {/* 导出沿用手账的 JournalExport */}
      <div className="fc ledger-export">
        <JournalExport today={today} />
      </div>
    </JournalShell>
  );
}
