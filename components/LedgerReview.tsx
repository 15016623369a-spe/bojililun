'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { MuscleId } from '@/lib/muscles';
import type { SculptureVariant } from '@/lib/sculpture-groups';
import SculptureBody from './fc/SculptureBody';
import Icon from './ui/Icon';
import SplitNumber from './ui/SplitNumber';
import { weekdayOf } from './ui/BigDate';

/** 每天的手账汇总，全部来自 exportJournal 的 daily_summary，这里只排版 */
export type ReviewDay = {
  date: string;
  future: boolean;
  titles: string[];
  workouts: number;
  meals: number;
  sets: number;
  volume: number;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  estimated: boolean;
  incomplete: boolean;
  weight: number | null;
};

export type HeatGroup = { id: MuscleId; label: string; level: number; side: 'front' | 'back' | 'both' };

const HEAT_TINT = '#1F4E7E';
const BASE = '#e9e8e3';
const LEVEL_WORD = ['', '少量', '适中', '较多'];
const short = (date: string) => `${date.slice(5, 7)}.${date.slice(8)}`;
const haptic = (ms = 4) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };
const kg = (n: number) => Math.round(n).toLocaleString('zh-CN');

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(' ')})`;
}

function macroLine(d: ReviewDay) {
  if (!d.meals) return '';
  if (d.protein === null && d.carbs === null && d.fat === null) return '营养未估算';
  const g = (v: number | null) => (v === null ? '—' : String(Math.round(v)));
  return [`蛋白质 ${g(d.protein)} g · 碳水 ${g(d.carbs)} g · 脂肪 ${g(d.fat)} g`, d.estimated ? '含估算' : '', d.incomplete ? '部分数据缺失' : '']
    .filter(Boolean).join(' · ');
}

/**
 * 回顾（手账数据）：容量柱、训练读数、肌群热图、体重和按日记录。
 * 数据与计分沿用 main 的 exportJournal / calcMuscleHeatmap / calcWeightTrend，这里不改口径。
 */
export default function LedgerReview({ period, today, days, groups, side, variant, trainingDays, totalSets, weight }: {
  period: 'day' | 'week' | 'month';
  today: string;
  days: ReviewDay[];
  groups: HeatGroup[];
  side: 'front' | 'back';
  variant: SculptureVariant;
  trainingDays: number;
  totalSets: number;
  weight: { latest: number; change: number; average7: number | null; points: { date: string; weight: number }[] } | null;
}) {
  const word = { day: '今日', week: '本周', month: '本月' }[period];
  const past = days.filter((d) => !d.future);
  const lastActive = [...past].reverse().find((d) => d.volume > 0 || d.workouts > 0)?.date;
  const [pick, setPick] = useState(past.some((d) => d.date === today) ? today : lastActive ?? past.at(-1)?.date ?? today);
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const total = past.reduce((sum, d) => sum + d.volume, 0);
  const maxBar = Math.max(1, ...days.map((d) => d.volume));
  const picked = days.find((d) => d.date === pick);
  const levels = new Map(groups.map((g) => [g.id, g.level / 3]));
  const recorded = groups.map((g) => g.id);
  const shownGroups = selected ? groups.filter((g) => g.id === selected) : groups;
  const withRecords = past.filter((d) => d.titles.length || d.weight !== null).reverse();

  function inspect(id: MuscleId | null) {
    if (id === null || !levels.has(id)) { setSelected(null); return; }
    haptic(5);
    setSelected((current) => (current === id ? null : id));
  }

  return <>
    <section className="review-total">
      <p className="review-total-label">{word}训练容量</p>
      <div className="review-total-num"><SplitNumber value={total} /><em>kg</em></div>

      {period !== 'day' && <div className={`review-bars ${period}`} role="group" aria-label={`${word}每天的训练容量`}>
        {days.map((d, i) => {
          const day = Number(d.date.slice(8));
          const label = period === 'week' ? weekdayOf(d.date).slice(1) : (day === 1 || day % 7 === 1 ? String(day) : '');
          const trained = d.workouts > 0;
          return <button key={d.date} type="button" className="review-bar" disabled={d.future}
            data-picked={d.date === pick || undefined} data-future={d.future || undefined} aria-pressed={d.date === pick}
            aria-label={`${short(d.date)} ${d.volume ? `${kg(d.volume)} kg` : trained ? '有训练，无负重数据' : d.future ? '还没到' : '没有训练'}`}
            onClick={() => { haptic(); setPick(d.date); }}>
            <span className="review-bar-track">
              <span className="review-bar-fill" style={{ height: `${d.volume ? Math.max(8, d.volume / maxBar * 100) : 0}%`, animationDelay: `${i * (period === 'week' ? 40 : 12)}ms` }} />
              {trained && !d.volume && <i className="review-bar-dot" />}
            </span>
            <small>{label}</small>
          </button>;
        })}
      </div>}

      {picked && <div className="review-pick ledger-pick" key={picked.date}>
        <b className="big-num">{short(picked.date)}</b>
        <span>
          <strong>{picked.titles.length ? picked.titles.join('、') : '没有记录'}</strong>
          <small>{[weekdayOf(picked.date), picked.sets ? `${picked.sets} 组` : '', picked.volume ? `${kg(picked.volume)} kg` : '',
            picked.kcal ? `${kg(picked.kcal)} kcal` : ''].filter(Boolean).join(' · ')}</small>
        </span>
        {picked.date === today && <Link href="/log" aria-label="去今天的记录"><Icon name="chevron-right" size={18} /></Link>}
      </div>}
    </section>

    <div className="readouts two">
      <div className="readout"><b className="big-num">{trainingDays}</b><span>天</span><em>训练天数</em></div>
      <div className="readout"><b className="big-num">{totalSets}</b><span>组</span><em>已记录训练组</em></div>
    </div>

    <section className="v-section review-heat">
      <div className="review-heat-head">
        <h2 className="v-section-title">肌群热力图</h2>
        {selected && <button type="button" className="chip" onClick={() => inspect(null)}>全部<Icon name="close" size={13} stroke={2} /></button>}
      </div>
      <div className="review-model dotted large">
        {recorded.length
          ? <SculptureBody key={variant + period} variant={variant} look="sculpture" heatTint={HEAT_TINT} side={side}
            heatLevels={levels} recorded={recorded} selected={selected} onPick={(id) => inspect(id)} />
          : <p className="review-model-empty">{word}还没有训练记录</p>}
      </div>
      <div className="heat-legend" aria-label="按训练计分着色，由未训练到训练较多">
        <span>未训练</span>
        {[0, 1 / 3, 2 / 3, 1].map((t) => <i key={t} style={{ background: t ? mix(BASE, HEAT_TINT, t) : BASE }} />)}
        <span>训练较多</span>
      </div>
      {shownGroups.length > 0 && <div className="heat-stats">
        {shownGroups.map((g) => <button key={g.id} type="button" className="heat-stat" aria-pressed={g.id === selected} onClick={() => inspect(g.id)}>
          <span>{g.label}</span>
          <b className="big-num heat-level">{LEVEL_WORD[g.level]}<em className="heat-dots" aria-hidden="true">{[1, 2, 3].map((n) => <i key={n} data-on={n <= g.level || undefined} />)}</em></b>
        </button>)}
      </div>}
    </section>

    {weight && <section className="v-section ledger-weight">
      <h2 className="v-section-title with-aside">晨重<span>{short(weight.points[0]?.date ?? today)} — {short(today)}</span></h2>
      <div className="ledger-weight-row">
        <div className="readout"><b className="big-num">{weight.latest}</b><span>kg</span><em>最近一次</em></div>
        <div className="ledger-weight-side">
          <p><em>区间变化</em><b>{weight.change > 0 ? '+' : ''}{weight.change}</b> kg</p>
          {weight.average7 !== null && <p><em>7 日均重</em><b>{weight.average7}</b> kg</p>}
        </div>
      </div>
      {weight.points.length > 1 && <WeightDots points={weight.points} />}
    </section>}

    <section className="v-section">
      <h2 className="v-section-title">{word}记录</h2>
      {withRecords.length ? <ul className="review-days ledger-days">
        {withRecords.map((d) => <li key={d.date}>
          <button type="button" className="review-day-row" aria-pressed={d.date === pick} onClick={() => { haptic(); setPick(d.date); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <span className="review-days-date"><b className="big-num">{short(d.date)}</b><small>{weekdayOf(d.date)}</small></span>
            <span className="review-days-main">
              <strong>{d.titles.length ? d.titles.join('、') : `体重 ${d.weight} kg`}</strong>
              <small>{[d.sets ? `${d.sets} 组` : '', d.volume ? `${kg(d.volume)} kg` : '', d.kcal ? `${kg(d.kcal)} kcal` : ''].filter(Boolean).join(' · ') || '—'}</small>
              {d.meals > 0 && <small className="ledger-macros">{macroLine(d)}</small>}
            </span>
            <span className="review-days-ticks" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} data-on={i < Math.round(d.volume / maxBar * 12) || undefined} />)}</span>
          </button>
        </li>)}
      </ul> : <p className="hint">这段时间还没有记录。</p>}
    </section>
  </>;
}

/** 晨重点阵：每个记录日一个点，高度按区间内最轻到最重归一 */
function WeightDots({ points }: { points: { date: string; weight: number }[] }) {
  const lo = Math.min(...points.map((p) => p.weight));
  const hi = Math.max(...points.map((p) => p.weight));
  const span = hi - lo || 1;
  return <div className="weight-dots" role="img" aria-label={`晨重 ${points.map((p) => `${short(p.date)} ${p.weight} kg`).join('，')}`}>
    {points.map((p, i) => <span key={p.date} style={{ '--y': ((p.weight - lo) / span).toFixed(3) } as React.CSSProperties} data-last={i === points.length - 1 || undefined}>
      <i />
      <small>{i === 0 || i === points.length - 1 ? short(p.date) : ''}</small>
    </span>)}
  </div>;
}
