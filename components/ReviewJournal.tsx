'use client';

import { useState } from 'react';
import { humanDate } from '@/lib/date';
import { consolidateMealEntries, consolidateTrainingEntries, type JournalEntry } from '@/lib/journal';
import { MUSCLES, type MuscleId } from '@/lib/muscles';
import ReviewAnatomy from './ReviewAnatomy';
import JournalTimeline from './JournalTimeline';

const periodCaption = { day: '当天记录部位', week: '本周记录部位', month: '本月记录部位' };
const ENTRY_GROUPS: Array<{ kind: JournalEntry['kind']; label: string }> = [
  { kind: 'training', label: '训练' },
  { kind: 'meal', label: '饮食' },
  { kind: 'sleep', label: '睡眠' },
  { kind: 'note', label: '其他记录' },
];

export default function ReviewJournal({ days, period = 'week' }: {
  days: { date: string; entries: JournalEntry[] }[];
  period?: keyof typeof periodCaption;
}) {
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [view, setView] = useState<'front' | 'back'>();
  const available = new Set(days.flatMap(({ entries }) => entries.flatMap((entry) => entry.muscles ?? [])));
  const muscles = MUSCLES.filter((muscle) => available.has(muscle.id));
  const frontCount = muscles.filter((muscle) => muscle.side === 'front').length;
  const backCount = muscles.filter((muscle) => muscle.side === 'back').length;
  const side = view ?? (frontCount > backCount ? 'front' : 'back');
  const fullBody = muscles.some((muscle) => muscle.region === '腿');
  const filtered = days
    .map(({ date, entries }) => ({ date, entries: selected ? entries.filter((entry) => entry.muscles?.includes(selected)) : entries }))
    .filter(({ entries }) => entries.length > 0);

  function inspect(muscle: MuscleId | null) {
    if (muscle === null) {
      setSelected(null);
      return;
    }
    const group = muscles.find((item) => item.id === muscle);
    if (!group) return;
    setSelected((current) => current === muscle ? null : muscle);
    if (group.side !== 'both') setView(group.side);
  }

  return <>
    <figure className="review-figure">
      <ReviewAnatomy side={side} fullBody={fullBody} highlighted={selected ? [selected] : [...available]}
        selectable={[...available]} onInspect={inspect} />
      <figcaption>
        <span aria-hidden="true" />
        <span>{periodCaption[period]}</span>
        <button className="review-view-toggle" onClick={() => setView(side === 'back' ? 'front' : 'back')}>
          {side === 'back' ? '看正面' : '看背面'}
        </button>
      </figcaption>
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
    {filtered.length ? filtered.map(({ date, entries }) => <section className="review-day" key={date}>
      <h2>{humanDate(date)}</h2>
      {ENTRY_GROUPS.map(({ kind, label }) => {
        const raw = entries.filter((entry) => entry.kind === kind);
        const grouped = kind === 'training' ? consolidateTrainingEntries(raw, date)
          : kind === 'meal' ? consolidateMealEntries(raw, date) : raw;
        return grouped.length > 0 && <section className={`review-category ${kind}`} data-kind={kind} key={kind}>
          <h3>{label}<span>{grouped.length} 条</span></h3>
          <JournalTimeline entries={grouped} compact />
        </section>;
      })}
    </section>) : <div className="journal-empty"><p>这段时间还没有记录</p></div>}
  </>;
}
