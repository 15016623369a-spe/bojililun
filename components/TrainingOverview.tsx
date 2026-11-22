'use client';

import Link from 'next/link';
import { useState } from 'react';
import { humanDate } from '@/lib/date';
import type { MuscleId } from '@/lib/muscles';
import { sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';
import SculptureBody from './fc/SculptureBody';

export type TrainingDay = {
  date: string;
  focus: string;
  recorded: boolean;
};

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export default function TrainingOverview({ days, today, date, focus, status, planned, recorded, variant, receipt }: {
  days: TrainingDay[];
  today: string;
  date: string;
  focus: string;
  status: string;
  planned: MuscleId[];
  recorded: MuscleId[];
  variant: SculptureVariant;
  receipt: string;
}) {
  const muscles = [...planned, ...recorded];
  const first = muscles.find((id) => sculptureGroup(id));
  const [side, setSide] = useState<'front' | 'back'>(sculptureGroup(first)?.side === 'back' ? 'back' : 'front');
  const hasBack = muscles.some((id) => sculptureGroup(id)?.side === 'back');
  const weekSchedule = days.filter((day) => day.date !== today && day.focus && (day.date > today || day.recorded));

  return <div className="training-overview">
    <nav className="training-week" aria-label="本周训练">
      {days.map((day, index) => <Link key={day.date}
        href={day.date === today ? '/train' : `/train?date=${day.date}`}
        aria-current={day.date === date ? 'date' : undefined}
        aria-label={`${day.date === today ? '今天，' : ''}${humanDate(day.date)}，${day.focus || '无安排'}${day.recorded ? '，有实练记录' : ''}`}
        data-state={day.recorded ? 'recorded' : day.focus ? 'planned' : undefined}>
        <span>{WEEKDAYS[index]}</span><b>{Number(day.date.slice(-2))}</b><i aria-hidden="true" />
      </Link>)}
    </nav>
    {weekSchedule.length > 0 && <p className="training-week-preview">
      {weekSchedule.map((day) => <Link key={day.date} href={`/train?date=${day.date}`}>
        周{WEEKDAYS[days.indexOf(day)]} {day.focus}
      </Link>)}
    </p>}
    <section className="training-edition" aria-label={date === today ? '今日训练概览' : humanDate(date)}>
      <div className="training-edition-copy">
        <p className="training-edition-date">{date === today ? '今天' : humanDate(date).split(' ')[1]}<span>{date.slice(5).replace('-', '.')}</span></p>
        <h2>{focus}</h2>
        <p className="training-edition-status">{status}</p>
        {receipt && <p className="training-edition-receipt">{receipt}</p>}
      </div>
      <div className="training-edition-body">
        <SculptureBody variant={variant} side={side} look="halftone" planned={planned} recorded={recorded} />
        {hasBack && <button type="button" className="training-body-turn"
          onClick={() => setSide(side === 'front' ? 'back' : 'front')}>
          {side === 'front' ? '看背面' : '看正面'}
        </button>}
      </div>
    </section>
  </div>;
}
