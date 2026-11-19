'use client';

import { useState } from 'react';
import { humanDate } from '@/lib/date';
import type { JournalEntry } from '@/lib/journal';
import { MUSCLES, type MuscleId } from '@/lib/muscles';
import ReviewBody from './ReviewBody';
import JournalTimeline from './JournalTimeline';

const periodCaption = { day: '当天记录部位', week: '本周记录部位', month: '本月记录部位' };

export default function ReviewJournal({ days, period = 'week' }: {
  days: { date: string; entries: JournalEntry[] }[];
  period?: keyof typeof periodCaption;
}) {
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const available = new Set(days.flatMap(({ entries }) => entries.flatMap((entry) => entry.muscles ?? [])));
  const muscles = MUSCLES.filter((muscle) => available.has(muscle.id));
  const recorded = muscles.map((muscle) => muscle.id);
  // 记录主要在哪一面，3D 就先转哪一面过来；转过之后随便转。
  const front = muscles.filter((muscle) => muscle.side === 'front').length;
  const back = muscles.filter((muscle) => muscle.side === 'back').length;
  const initialSide = front > back ? 'front' : 'back';
  const filtered = days
    .map(({ date, entries }) => ({ date, entries: selected ? entries.filter((entry) => entry.muscles?.includes(selected)) : entries }))
    .filter(({ entries }) => entries.length > 0);

  function inspect(muscle: MuscleId | null) {
    if (muscle === null) {
      setSelected(null);
      return;
    }
    if (!available.has(muscle)) return;
    setSelected((current) => current === muscle ? null : muscle);
  }

  return <>
    <figure className="review-figure">
      <ReviewBody recorded={recorded} selected={selected} initialSide={initialSide} onInspect={inspect} />
      <figcaption>
        <span aria-hidden="true" />
        <span>{periodCaption[period]}</span>
        <span className="review-spin-hint">拖动旋转</span>
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
      <JournalTimeline entries={entries} compact />
    </section>) : <div className="journal-empty"><p>这段时间还没有记录</p></div>}
  </>;
}
