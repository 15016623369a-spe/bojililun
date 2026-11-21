'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { JournalEntry } from '@/lib/journal';
import { MUSCLES, type MuscleId } from '@/lib/muscles';
import { canonicalMuscle, recordedInGroup, sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';
import ReviewBody from './ReviewBody';
import RecordDeck from './RecordDeck';
import Icon from './ui/Icon';
import SplitNumber from './ui/SplitNumber';
import { weekdayOf } from './ui/BigDate';

const FREQ_TINT = '#1F4E7E';
const VOLUME_TINT = '#C8432F';
const BASE = '#e9e8e3';

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(' ')})`;
}

function trainedMuscles(entry: JournalEntry): MuscleId[] {
  return entry.kind === 'training' ? entry.muscles ?? [] : [];
}

const short = (date: string) => `${date.slice(5, 7)}.${date.slice(8)}`;

type Day = { date: string; entries: JournalEntry[] };

export default function ReviewJournal({ days, period = 'week', variant = 'male', duration, calendarHref, anchor, today, bars = [], muscleVolume = [] }: {
  days: Day[];
  period?: 'day' | 'week' | 'month';
  variant?: SculptureVariant;
  duration: number;
  calendarHref: string;
  anchor: string;
  today: string;
  /** 本期每一天的容量（含 0），按日期升序 */
  bars?: { date: string; volume: number }[];
  /** 本期每个肌群的容量（重量 × 次数，每个动作只归一个主要肌群） */
  muscleVolume?: { id: MuscleId; volume: number }[];
}) {
  const [filter, setFilter] = useState<MuscleId | null>(null);
  const [metric, setMetric] = useState<'frequency' | 'volume'>('frequency');
  const trainingDays = days.filter(({ entries }) => entries.some((entry) => entry.kind === 'training'));
  const trainedDates = new Set(trainingDays.map(({ date }) => date));

  // 频次：本期练到该肌群的不同日期数 ÷ 本期训练日数，同一天计一次
  const dayCounts = new Map<MuscleId, number>();
  for (const { entries } of trainingDays) {
    for (const group of new Set(entries.flatMap(trainedMuscles).map(canonicalMuscle))) {
      if (group) dayCounts.set(group, (dayCounts.get(group) ?? 0) + 1);
    }
  }
  const volumes = new Map<MuscleId, number>();
  for (const { id, volume } of muscleVolume) {
    const group = canonicalMuscle(id);
    if (group && volume > 0) volumes.set(group, (volumes.get(group) ?? 0) + volume);
  }
  const maxVolume = Math.max(0, ...volumes.values());

  const heatLevels = new Map<MuscleId, number>();
  if (metric === 'frequency' && trainingDays.length) {
    for (const [group, count] of dayCounts) {
      const frequency = count / trainingDays.length;
      heatLevels.set(group, frequency <= 1 / 3 ? .42 : frequency <= 2 / 3 ? .7 : 1);
    }
  }
  if (metric === 'volume' && maxVolume > 0) {
    for (const [group, volume] of volumes) heatLevels.set(group, Math.max(.2, volume / maxVolume));
  }

  const available = new Set(days.flatMap(({ entries }) => entries.flatMap(trainedMuscles)));
  for (const id of volumes.keys()) available.add(id);
  const recorded = MUSCLES.filter((muscle) => available.has(muscle.id)).map((muscle) => muscle.id);
  const selected = filter && recordedInGroup(recorded, filter) ? filter : null;
  const groups = [...new Set(recorded.map((id) => canonicalMuscle(id) ?? id))];
  const front = groups.filter((id) => (sculptureGroup(id) ?? MUSCLES.find((m) => m.id === id))?.side === 'front').length;
  const initialSide = front >= groups.length - front ? 'front' : 'back';

  function inspect(muscle: MuscleId | null) {
    if (muscle === null) { setFilter(null); return; }
    const group = canonicalMuscle(muscle) ?? muscle;
    if (!recordedInGroup(recorded, group)) return;
    try { navigator.vibrate?.(5); } catch { /* 无振动接口 */ }
    setFilter(selected === group ? null : group);
  }

  // ---------- 日视图：时间刻度与横向卡片，和记录页一致 ----------
  if (period === 'day') {
    const entries = days.find((day) => day.date === anchor)?.entries ?? [];
    return <>
      <RecordDeck entries={entries} isToday={anchor === today} emptyHint="这天没有记录" />
      {recorded.length > 0 && <section className="review-day-figure">
        <div className="review-model dotted">
          <ReviewBody recorded={recorded} selected={selected} initialSide={initialSide} onInspect={inspect} variant={variant} />
        </div>
        <div className="review-day-figure-side">
          <p className="kicker"><i aria-hidden="true" />当天实练部位</p>
          <strong>{groups.map((id) => sculptureGroup(id)?.label ?? id).join('、')}</strong>
          <small>拖动旋转</small>
        </div>
      </section>}
      <Link className="v-link-row" href={`/history/${anchor}?from=review&period=day&anchor=${anchor}`}>
        <span>查看当天详情</span><Icon name="chevron-right" size={18} />
      </Link>
    </>;
  }

  // ---------- 周 / 月 ----------
  const total = bars.reduce((sum, bar) => sum + bar.volume, 0);
  const maxBar = Math.max(1, ...bars.map((bar) => bar.volume));
  const inRange = bars.some((bar) => bar.date === today) ? today : null;
  const fallback = [...bars].reverse().find((bar) => bar.volume > 0 || trainedDates.has(bar.date))?.date ?? bars.at(-1)?.date ?? anchor;
  return <WeekMonth {...{ days, period, variant, duration, calendarHref, anchor, bars, total, maxBar, trainedDates,
    initialPick: inRange ?? fallback, metric, setMetric, heatLevels, recorded, selected, inspect, initialSide, groups,
    dayCounts, volumes, trainingDayCount: trainingDays.length }} />;
}

function WeekMonth({ days, period, variant, duration, calendarHref, anchor, bars, total, maxBar, trainedDates, initialPick,
  metric, setMetric, heatLevels, recorded, selected, inspect, initialSide, groups, dayCounts, volumes, trainingDayCount }: {
  days: Day[]; period: 'week' | 'month'; variant: SculptureVariant; duration: number; calendarHref: string; anchor: string;
  bars: { date: string; volume: number }[]; total: number; maxBar: number; trainedDates: Set<string>; initialPick: string;
  metric: 'frequency' | 'volume'; setMetric: (metric: 'frequency' | 'volume') => void; heatLevels: Map<MuscleId, number>;
  recorded: MuscleId[]; selected: MuscleId | null; inspect: (muscle: MuscleId | null) => void; initialSide: 'front' | 'back';
  groups: MuscleId[]; dayCounts: Map<MuscleId, number>; volumes: Map<MuscleId, number>; trainingDayCount: number;
}) {
  const [pick, setPick] = useState(initialPick);
  const word = period === 'month' ? '本月' : '本周';
  const minutes = Math.round(duration / 60);
  const pickedBar = bars.find((bar) => bar.date === pick);
  const pickedDay = days.find((day) => day.date === pick);
  const pickedRegions = [...new Set((pickedDay?.entries ?? []).flatMap(trainedMuscles)
    .map((id) => MUSCLES.find((muscle) => muscle.id === id)?.region).filter(Boolean))];
  const tint = metric === 'frequency' ? FREQ_TINT : VOLUME_TINT;
  const stats = groups.map((id) => ({
    id,
    label: sculptureGroup(id)?.label ?? MUSCLES.find((m) => m.id === id)?.label ?? id,
    days: dayCounts.get(id) ?? 0,
    volume: volumes.get(id) ?? 0,
  })).sort((a, b) => metric === 'frequency' ? b.days - a.days || b.volume - a.volume : b.volume - a.volume || b.days - a.days);
  const recent = days.filter((day) => !selected || day.entries.some((entry) => recordedInGroup(trainedMuscles(entry), selected)));
  const shown = period === 'month' ? recent.slice(0, 6) : recent;
  const dayVolume = new Map(bars.map((bar) => [bar.date, bar.volume]));

  return <>
    <section className="review-total">
      <p className="review-total-label">{word}训练容量</p>
      <div className="review-total-num"><SplitNumber value={total} /><em>kg</em></div>
      <div className={`review-bars ${period}`} role="group" aria-label={`${word}每天的训练容量`}>
        {bars.map((bar, i) => {
          const day = Number(bar.date.slice(8));
          const label = period === 'week' ? weekdayOf(bar.date).slice(1) : (day === 1 || day % 7 === 1 ? String(day) : '');
          const trained = trainedDates.has(bar.date) || bar.volume > 0;
          return <button key={bar.date} type="button" className="review-bar" data-picked={bar.date === pick || undefined}
            data-trained={trained || undefined} aria-pressed={bar.date === pick}
            aria-label={`${short(bar.date)} ${bar.volume ? `${Math.round(bar.volume)} kg` : trained ? '有训练，无负重数据' : '没有训练'}`}
            onClick={() => { try { navigator.vibrate?.(4); } catch { /* 无振动 */ } setPick(bar.date); }}>
            <span className="review-bar-track">
              <span className="review-bar-fill" style={{ height: `${bar.volume ? Math.max(8, bar.volume / maxBar * 100) : 0}%`, animationDelay: `${i * (period === 'week' ? 40 : 12)}ms` }} />
              {trained && !bar.volume && <i className="review-bar-dot" />}
            </span>
            <small>{label}</small>
          </button>;
        })}
      </div>
      <Link className="review-pick" href={`/history/${pick}?from=review&period=${period}&anchor=${anchor}`}>
        <b className="big-num">{short(pick)}</b>
        <span>{weekdayOf(pick)} · {pickedBar?.volume ? `${Math.round(pickedBar.volume).toLocaleString()} kg` : trainedDates.has(pick) ? '有训练' : pickedDay ? '无训练' : '没有记录'}
          {pickedRegions.length > 0 && ` · ${pickedRegions.join('、')}`}</span>
        <Icon name="chevron-right" size={18} />
      </Link>
    </section>

    <div className="readouts two">
      <div className="readout"><b className="big-num">{trainingDayCount}</b><span>天</span><em>训练天数</em></div>
      <div className="readout"><b className="big-num">{minutes >= 60 ? (minutes / 60).toFixed(1).replace(/\.0$/, '') : minutes}</b>
        <span>{minutes >= 60 ? '小时' : '分钟'}</span><em>累计训练</em></div>
    </div>

    <section className="v-section review-heat">
      <div className="review-heat-head">
        <h2 className="v-section-title">肌群热力图</h2>
        <div className="vseg" role="tablist" aria-label="热力图指标">
          <button type="button" role="tab" aria-selected={metric === 'frequency'} className={metric === 'frequency' ? 'on' : ''} onClick={() => setMetric('frequency')}>训练频次</button>
          <button type="button" role="tab" aria-selected={metric === 'volume'} className={metric === 'volume' ? 'on' : ''} onClick={() => setMetric('volume')}>训练容量</button>
        </div>
      </div>
      <div className="review-model dotted large" data-metric={metric}>
        {recorded.length ? <ReviewBody recorded={recorded} heatLevels={heatLevels} heatTint={tint} selected={selected}
          initialSide={initialSide} onInspect={inspect} variant={variant} />
          : <p className="review-model-empty">{word}还没有训练记录</p>}
      </div>
      <div className="heat-legend" aria-label={metric === 'frequency' ? '色阶按训练日占比，越深越频繁' : `色阶按${word}容量最高的肌群归一`}>
        <span>{metric === 'frequency' ? '未训练' : '0 kg'}</span>
        {[0, .42, .7, 1].map((t) => <i key={t} style={{ background: t ? mix(BASE, tint, metric === 'volume' ? Math.max(.2, t) : t) : BASE }} />)}
        <span>{metric === 'frequency' ? '每个训练日' : `${word}最高`}</span>
      </div>
      {metric === 'volume' && volumes.size === 0 && groups.length > 0 && <p className="hint center">{word}的训练没有可计算的负重数据</p>}
      {stats.length > 0 && <div className="heat-stats">
        {stats.map((stat) => <button key={stat.id} type="button" className="heat-stat" aria-pressed={stat.id === selected}
          onClick={() => inspect(stat.id)}>
          <span>{stat.label}</span>
          {metric === 'frequency'
            ? <b className="big-num">{stat.days}<em>/ {trainingDayCount} 天</em></b>
            : stat.volume ? <b className="big-num">{Math.round(stat.volume).toLocaleString()}<em>kg</em></b>
              : <small>无负重数据</small>}
        </button>)}
      </div>}
    </section>

    <section className="v-section">
      <div className="review-list-head">
        <h2 className="v-section-title">{selected ? `${sculptureGroup(selected)?.label ?? ''} · ` : ''}{period === 'month' ? '最近记录' : `${word}记录`}</h2>
        {selected && <button type="button" className="chip" onClick={() => inspect(null)}>全部<Icon name="close" size={13} stroke={2} /></button>}
      </div>
      {shown.length ? <ul className="review-days">
        {shown.map(({ date, entries }) => {
          const regions = [...new Set(entries.flatMap(trainedMuscles).map((id) => MUSCLES.find((m) => m.id === id)?.region).filter(Boolean))];
          const meals = entries.filter((entry) => entry.kind === 'meal').length;
          const other = entries.filter((entry) => entry.kind === 'sleep' || entry.kind === 'note').length;
          const volume = dayVolume.get(date) ?? 0;
          return <li key={date}>
            <Link href={`/history/${date}?from=review&period=${period}&anchor=${anchor}`}>
              <span className="review-days-date"><b className="big-num">{short(date)}</b><small>{weekdayOf(date)}</small></span>
              <span className="review-days-main">
                <strong>{regions.length ? `${regions.join('、')}训练` : entries.some((e) => e.kind === 'training') ? '训练' : meals ? '饮食' : '记录'}</strong>
                <small>{[volume ? `${Math.round(volume).toLocaleString()} kg` : '', meals ? `饮食 ${meals} 条` : '', other ? `其他 ${other} 条` : ''].filter(Boolean).join(' · ') || '—'}</small>
              </span>
              <span className="review-days-ticks" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} data-on={i < Math.round(volume / maxBar * 12) || undefined} />)}</span>
              <Icon name="chevron-right" size={18} className="row-chev" />
            </Link>
          </li>;
        })}
      </ul> : <p className="hint">这段时间还没有记录。</p>}
    </section>

    <nav className="review-links" aria-label="更多">
      <Link href={calendarHref}><Icon name="calendar" size={18} />训练月历<Icon name="chevron-right" size={18} /></Link>
      <Link href="/stats"><Icon name="chart" size={18} />训练统计<Icon name="chevron-right" size={18} /></Link>
    </nav>
  </>;
}
