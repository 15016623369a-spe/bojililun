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
  /** 当天运动消耗（粗估 kcal），见 lib/exercise-burn */
  burn: number;
  /** 记录页点阵电池里选的精力 1–5 */
  energy: number | null;
};

export type HeatGroup = { id: MuscleId; label: string; level: number; side: 'front' | 'back' | 'both' };

const HEAT_TINT = '#1F4E7E';
const BASE = '#e9e8e3';
const short = (date: string) => `${date.slice(5, 7)}.${date.slice(8)}`;
const haptic = (ms = 4) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };
const kg = (n: number) => Math.round(n).toLocaleString('zh-CN');

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(' ')})`;
}


/**
 * 回顾（手账数据）：容量柱、训练读数、肌群热图、体重和按日记录。
 * 数据与计分沿用 main 的 exportJournal / calcMuscleHeatmap / calcWeightTrend，这里不改口径。
 */
export default function LedgerReview({ period, today, days, groups, side, variant, trainingDays, totalSets, weight, statsHref }: {
  period: 'day' | 'week' | 'month';
  /** 训练统计入口：挂在容量标题旁，带上当前区间 */
  statsHref: string;
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

  function inspect(id: MuscleId | null) {
    if (id === null || !levels.has(id)) { setSelected(null); return; }
    haptic(5);
    setSelected((current) => (current === id ? null : id));
  }

  return <>
    <section className="review-total">
      <div className="review-total-head">
        <p className="review-total-label">{word}训练容量</p>
        <Link className="stats-chip" href={statsHref}>
          <span className="stats-chip-bars" aria-hidden="true"><i /><i /><i /><i /></span>训练统计<Icon name="chevron-right" size={15} stroke={2} />
        </Link>
      </div>
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
        {!picked.future && <Link href={picked.date === today ? '/log' : `/log?date=${picked.date}`} aria-label="看这天的记录"><Icon name="chevron-right" size={18} /></Link>}
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
      <div className="review-model dotted large" data-empty={recorded.length ? undefined : ''}>
        <SculptureBody key={variant + period} variant={variant} look="sculpture" heatTint={HEAT_TINT} side={side}
          heatLevels={levels} recorded={recorded} selected={selected} onPick={(id) => inspect(id)} />
        {!recorded.length && <p className="review-model-note"><i aria-hidden="true" />{word}还没有训练，练过的肌群会在这里变蓝</p>}
      </div>
      {/* 三档热度不再用文字，改成一条由疏到密的点阵刻度，肌群名挂在各自那一档下面 */}
      {groups.length > 0 && <div className="heat-scale" aria-label="训练热度，由左到右越来越多">
        <div className="heat-scale-bar" aria-hidden="true">
          {[1, 2, 3].map((level) => <span key={level} data-level={level} style={{ background: mix(BASE, HEAT_TINT, level / 3) }} />)}
        </div>
        <div className="heat-scale-cols">
          {[1, 2, 3].map((level) => <ul key={level} data-level={level} aria-label={`热度 ${level} / 3`}>
            {groups.filter((g) => g.level === level).map((g) => <li key={g.id}>
              <button type="button" aria-pressed={g.id === selected} onClick={() => inspect(g.id)}>
                <i aria-hidden="true" style={{ background: mix(BASE, HEAT_TINT, level / 3) }} />{g.label}
              </button>
            </li>)}
          </ul>)}
        </div>
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

    <EnergyChart days={past} period={period} word={word} today={today} />
  </>;
}

const MACRO = [
  { key: 'protein', label: '蛋白质', kcal: 4, color: '#151613' },
  { key: 'carbs', label: '碳水', kcal: 4, color: '#c9c43a' },
  { key: 'fat', label: '脂肪', kcal: 9, color: '#a596e0' },
] as const;

/**
 * 能量收支：基线以上是每天摄入（按蛋白质 / 碳水 / 脂肪折成千卡堆叠），基线以下是运动消耗的珊瑚点列。
 * 摄入和三大营养素来自手账的 daily_summary，消耗是粗估。点某一天在下面读出当天的数。
 */
function EnergyChart({ days, period, word, today }: { days: ReviewDay[]; period: 'day' | 'week' | 'month'; word: string; today: string }) {
  const intakeOf = (d: ReviewDay) => d.kcal ?? 0;
  const withData = days.filter((d) => intakeOf(d) > 0 || d.burn > 0);
  const [pick, setPick] = useState(withData.at(-1)?.date ?? today);
  const picked = days.find((d) => d.date === pick) ?? days.at(-1);
  const maxIn = Math.max(1, ...days.map(intakeOf));
  const maxBurn = Math.max(1, ...days.map((d) => d.burn));
  const loggedIntake = days.filter((d) => intakeOf(d) > 0);
  const avgIn = loggedIntake.length ? Math.round(loggedIntake.reduce((s, d) => s + intakeOf(d), 0) / loggedIntake.length) : 0;
  const totalBurn = days.reduce((s, d) => s + d.burn, 0);
  const dense = days.length > 10;
  const macroKcal = (d: ReviewDay) => MACRO.map((m) => ({ ...m, value: (d[m.key] ?? 0) * m.kcal }));
  const BURN_DOTS = dense ? 8 : 10;

  return <section className="v-section energy">
    <h2 className="v-section-title with-aside">能量收支<span>{word} · 消耗为估算</span></h2>
    <div className="readouts two energy-readouts">
      <div className="readout"><b className="big-num">{avgIn ? avgIn.toLocaleString('zh-CN') : '—'}</b><span>kcal</span><em>日均摄入</em></div>
      <div className="readout coral"><b className="big-num">{Math.round(totalBurn).toLocaleString('zh-CN')}</b><span>kcal</span><em>{word}运动消耗</em></div>
    </div>
    {period === 'day' ? null : <div className={`energy-chart${dense ? ' dense' : ''}`} role="group" aria-label="每天摄入与运动消耗">
      {days.map((d) => {
        const kcal = intakeOf(d);
        const parts = macroKcal(d);
        const macroSum = parts.reduce((s, p) => s + p.value, 0);
        const burnDots = d.burn ? Math.max(1, Math.round(d.burn / maxBurn * BURN_DOTS)) : 0;
        return <button key={d.date} type="button" className="energy-col" data-picked={d.date === picked?.date || undefined}
          aria-pressed={d.date === picked?.date} aria-label={`${short(d.date)} 摄入 ${Math.round(kcal)} kcal，消耗 ${Math.round(d.burn)} kcal`}
          onClick={() => { haptic(); setPick(d.date); }}>
          <span className="energy-in" style={{ height: `${kcal / maxIn * 100}%` }} data-estimate={kcal > 0 && macroSum === 0 || undefined}>
            {macroSum > 0 && parts.map((p) => <i key={p.key} style={{ flexGrow: p.value, background: p.color }} />)}
          </span>
          <span className="energy-base" aria-hidden="true" />
          <span className="energy-burn" aria-hidden="true">{Array.from({ length: burnDots }, (_, i) => <i key={i} />)}</span>
          <small>{dense ? (Number(d.date.slice(8)) % 7 === 1 ? Number(d.date.slice(8)) : '') : weekdayOf(d.date).slice(1)}</small>
          {!dense && <span className="energy-level" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <i key={n} data-on={d.energy !== null && n <= d.energy || undefined} />)}</span>}
        </button>;
      })}
    </div>}
    {picked && <div className="energy-pick" key={picked.date}>
      <div className="energy-pick-head"><b className="big-num">{short(picked.date)}</b><span>{weekdayOf(picked.date)}</span>
        {picked.energy !== null && <span className="mini-battery" aria-label={`精力 ${picked.energy * 20}%`}>
          {[1, 2, 3, 4, 5].map((n) => <i key={n} data-on={n <= picked.energy! || undefined} />)}
        </span>}
        <em>净 {Math.round(intakeOf(picked) - picked.burn).toLocaleString('zh-CN')} kcal</em></div>
      <div className="energy-split" aria-hidden="true">
        {macroKcal(picked).map((p) => <i key={p.key} style={{ flexGrow: p.value || 0, background: p.color }} />)}
        {picked.burn > 0 && <i className="burn" style={{ flexGrow: picked.burn }} />}
      </div>
      <dl className="energy-legend">
        {MACRO.map((m) => <div key={m.key}><dt><i style={{ background: m.color }} />{m.label}</dt><dd>{picked[m.key] === null ? '—' : Math.round(picked[m.key] ?? 0)}<small>g</small></dd></div>)}
        <div><dt><i className="burn" />消耗</dt><dd>{Math.round(picked.burn)}<small>kcal</small></dd></div>
      </dl>
      {intakeOf(picked) > 0 && macroKcal(picked).every((p) => !p.value) && <p className="energy-note">这天的饮食只有热量估算，没有拆出三大营养素。</p>}
    </div>}
  </section>;
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
