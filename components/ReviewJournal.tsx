'use client';

import { useState } from 'react';
import Link from 'next/link';
import { humanDate } from '@/lib/date';
import type { JournalEntry } from '@/lib/journal';
import { MUSCLES, type MuscleId } from '@/lib/muscles';
import { canonicalMuscle, recordedInGroup, sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';
import ReviewBody from './ReviewBody';
import RecordCards from './RecordCards';
import JournalIcon from './JournalIcon';

const periodCaption = { day: '当天实练部位', week: '本周实练部位', month: '本月实练部位' };
const ENTRY_GROUPS: Array<{ kind: JournalEntry['kind']; label: string }> = [
  { kind: 'training', label: '训练' },
  { kind: 'meal', label: '饮食' },
  { kind: 'sleep', label: '睡眠' },
  { kind: 'note', label: '其他记录' },
];

function trainedMuscles(entry: JournalEntry): MuscleId[] {
  return entry.kind === 'training' ? entry.muscles ?? [] : [];
}

export default function ReviewJournal({ days, period = 'week', variant = 'male', duration, calendarHref, anchor }: {
  days: { date: string; entries: JournalEntry[] }[];
  period?: keyof typeof periodCaption;
  variant?: SculptureVariant;
  duration: number;
  calendarHref: string;
  anchor: string;
}) {
  const [filter, setFilter] = useState<MuscleId | null>(null);
  const trainingDays = days.filter(({ entries }) => entries.some((entry) => entry.kind === 'training'));
  const heatLevels = period === 'day' ? undefined : new Map<MuscleId, number>();
  if (heatLevels && trainingDays.length) {
    const counts = new Map<MuscleId, number>();
    for (const { entries } of trainingDays) {
      const groups = new Set(entries.flatMap(trainedMuscles).map(canonicalMuscle));
      for (const group of groups) {
        if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
      }
    }
    for (const [group, count] of counts) {
      const frequency = count / trainingDays.length;
      heatLevels.set(group, frequency <= 1 / 3 ? .32 : frequency <= 2 / 3 ? .62 : 1);
    }
  }
  const available = new Set(days.flatMap(({ entries }) => entries.flatMap(trainedMuscles)));
  const recorded = MUSCLES.filter((muscle) => available.has(muscle.id)).map((muscle) => muscle.id);
  const selected = filter && recordedInGroup(recorded, filter) ? filter : null;
  const muscles = [...new Set(recorded.map((id) => canonicalMuscle(id) ?? id))].map((id) =>
    sculptureGroup(id) ?? MUSCLES.find((muscle) => muscle.id === id)!);
  // 记录主要在哪一面，3D 就先转哪一面过来；转过之后随便转。
  const front = muscles.filter((muscle) => muscle.side === 'front').length;
  const back = muscles.filter((muscle) => muscle.side === 'back').length;
  const initialSide = front > back ? 'front' : 'back';
  const filtered = selected ? days
    .map(({ date, entries }) => ({
      date,
      entries: entries.filter((entry) => recordedInGroup(trainedMuscles(entry), selected)),
    }))
    .filter(({ entries }) => entries.length > 0) : days;

  function inspect(muscle: MuscleId | null) {
    if (muscle === null) {
      setFilter(null);
      return;
    }
    if (!recordedInGroup(recorded, muscle)) return;
    setFilter(selected === muscle ? null : muscle);
  }

  const figure = (
    <figure className="review-figure" aria-label={periodCaption[period]}>
      <ReviewBody recorded={recorded} heatLevels={heatLevels} selected={selected} initialSide={initialSide} onInspect={inspect} variant={variant} />
      {period === 'day' && <figcaption>
        <span aria-hidden="true" />
        <span>{periodCaption[period]}</span>
        <span className="review-spin-hint">拖动旋转</span>
      </figcaption>}
      {muscles.length > 0 && <details className="review-muscles">
        <summary>{selected ? muscles.find((muscle) => muscle.id === selected)?.label : '筛选部位'}</summary>
        <div className="review-filters">
          <button className="journal-chip" aria-pressed={!selected} onClick={() => inspect(null)}>全部</button>
          {muscles.map((muscle) =>
            <button key={muscle.id} className="journal-chip" aria-pressed={muscle.id === selected}
              onClick={() => inspect(muscle.id)}>{muscle.label}</button>,
          )}
        </div>
      </details>}
    </figure>
  );

  if (period !== 'day') {
    const minutes = Math.round(duration / 60);
    const hours = Math.floor(minutes / 60);
    const timeLabel = hours ? `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`
      : duration > 0 && minutes === 0 ? `${duration} 秒` : `${minutes} 分钟`;
    const recent = period === 'month' ? filtered.slice(0, 3) : filtered;
    return <>
      <section className="review-overview">
        {figure}
        <div className="review-overview-metrics">
          <h2>{period === 'month' ? '本月概览' : '本周概览'}</h2>
          <dl>
            <div><dt>训练天数</dt><dd>{trainingDays.length} <small>天</small></dd></div>
            <div><dt>累计训练</dt><dd>{timeLabel}</dd></div>
          </dl>
        </div>
      </section>
      <div className="review-heat-legend" role="img" aria-label="色阶按训练日占比：未训练、三分之一以内、三分之二以内、超过三分之二">
        <span>未训练</span><i /><i /><i /><i /><span>频次高</span>
      </div>
      <section className="review-recent">
        <h2>{period === 'month' ? '最近记录' : '本周记录'}</h2>
        {recent.length ? <ul>
          {recent.map(({ date }) => {
            const entries = days.find((day) => day.date === date)?.entries ?? [];
            const regions = [...new Set(entries.flatMap(trainedMuscles).map((id) => MUSCLES.find((muscle) => muscle.id === id)?.region).filter(Boolean))];
            const summary = ENTRY_GROUPS.flatMap(({ kind, label }) => {
              const count = entries.filter((entry) => entry.kind === kind).length;
              if (!count) return [];
              return [kind === 'training' && regions.length ? regions.join('、') : `${label} ${count} 条`];
            });
            return <li key={date}>
              <Link href={`/history/${date}?from=review&period=${period}&anchor=${anchor}`}>
                <strong>{Number(date.slice(5, 7))} 月 {Number(date.slice(8))} 日</strong>
                <span>{summary.join(' · ')}</span>
                <span className="review-recent-arrow" aria-hidden="true">›</span>
              </Link>
            </li>;
          })}
        </ul> : <p className="journal-muted">这段时间还没有记录。</p>}
        <Link className="review-all-dates" href={calendarHref}><JournalIcon name="calendar" />查看全部日期<span aria-hidden="true">›</span></Link>
      </section>
    </>;
  }

  return <>
    {figure}
    {filtered.length ? filtered.map(({ date, entries }) => <section className="review-day" key={date}>
      <h2>{humanDate(date)}</h2>
      {ENTRY_GROUPS.map(({ kind, label }) => {
        const grouped = entries.filter((entry) => entry.kind === kind);
        return grouped.length > 0 && <section className={`review-category ${kind}`} data-kind={kind} key={kind}>
          <h3>{label}<span>{grouped.length} 条</span></h3>
          <RecordCards entries={grouped} />
        </section>;
      })}
    </section>) : <div className="journal-empty"><p>这段时间还没有记录</p></div>}
  </>;
}
