'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { imageUrl } from '@/lib/exercise-label';
import { muscleById, type MuscleId } from '@/lib/muscles';
import type { ExercisePerformance as Exercise } from '@/lib/types';
import type { SculptureVariant } from '@/lib/sculpture-groups';
import { LABELS, VIEWS } from './StatsBodyMap';
import Icon from './ui/Icon';
import SplitNumber from './ui/SplitNumber';

export type Bucket = { key: string; label: string; value: number };
export type Totals = { volume: number; sessions: number; days: number; sets: number; durationMin: number; quickSessions: number };
export type MuscleRow = { id: MuscleId; volume: number; sets: number; sessions: number; seconds: number };
export type GroupCard = { label: string; points: { key: string; tick: string; sets: number; volume: number; seconds: number; sessions: number }[] };
type View = 'overview' | 'muscles' | 'exercises';

const VIEW_LABEL: Record<View, string> = { overview: '总览', muscles: '肌群与动作', exercises: '动作' };
// 动作表现挂在肌群下面：点哪块肌肉，下面只列这块肌肉的动作
const ORDER: View[] = ['overview', 'muscles'];
const haptic = (ms = 5) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };
const fmt = (n: number, digits = 1) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
const minutesOf = (seconds: number) => Math.round(seconds / 60);
const muscleLabel = (id: MuscleId) => LABELS[id] ?? muscleById(id)?.label ?? id;

function delta(a: number, b: number) {
  if (b <= 0) return '上期无可比数据';
  const pct = Math.round((a - b) / b * 100);
  return pct === 0 ? '与上期持平' : `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% 对比上期`;
}

export default function StatsBoard(props: {
  period: 'week' | 'month' | 'quarter' | 'year';
  periodLabel: string;
  volume: Bucket[];
  time: Bucket[];
  cur: Totals;
  prev: Totals;
  totalSeconds: number;
  timedSessions: number;
  muscles: MuscleRow[];
  groups: GroupCard[];
  exercises: Exercise[];
  /** 动作 id → 本期归入的主要肌群 */
  exerciseMuscles: Record<string, MuscleId>;
  variant: SculptureVariant;
  initialView: View;
}) {
  const root = useRef<HTMLDivElement>(null);
  const firstMuscle = [...props.muscles].sort((a, b) => b.volume - a.volume || b.sets - a.sets)[0]?.id ?? null;
  const [muscle, setMuscle] = useState<MuscleId | null>(firstMuscle);

  // 三段都在同一页，往下滑依次出现；带 view 参数进来时直接滚到那一段
  useEffect(() => {
    const sections = [...(root.current?.querySelectorAll<HTMLElement>('.stats-sec') ?? [])];
    if (props.initialView !== 'overview') document.getElementById(`stats-${props.initialView === 'exercises' ? 'muscles' : props.initialView}`)?.scrollIntoView({ block: 'start' });
    if (!('IntersectionObserver' in window)) return;
    // 只有脚本接管后才把未进入视口的段落藏起来，首段直接显示，避免闪一下
    sections.forEach((el) => { if (el.getBoundingClientRect().top < window.innerHeight) el.dataset.in = ''; });
    if (root.current) root.current.dataset.ready = '';
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { (entry.target as HTMLElement).dataset.in = ''; io.unobserve(entry.target); }
    }, { rootMargin: '0px 0px -12% 0px' });
    sections.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [props.initialView]);

  return <div className="stats-scroll" ref={root}>
    {ORDER.map((key, i) => <section key={key} id={`stats-${key}`} className="stats-sec" data-sec={key} aria-labelledby={`stats-${key}-title`}>
      <h2 className="stats-sec-head" id={`stats-${key}-title`}><em>{String(i + 1).padStart(2, '0')}</em>{VIEW_LABEL[key]}<i aria-hidden="true" /></h2>
      {key === 'overview' && <Overview {...props} />}
      {key === 'muscles' && <>
        <Muscles {...props} selected={muscle} onSelect={setMuscle} />
        <Exercises key={muscle ?? 'all'} {...props} muscle={muscle} />
      </>}
    </section>)}
  </div>;
}

/* ---------------- 总览 ---------------- */
function Overview({ periodLabel, period, volume, time, cur, prev, totalSeconds, timedSessions }: Parameters<typeof StatsBoard>[0]) {
  const [metric, setMetric] = useState<'volume' | 'time'>('volume');
  const buckets = metric === 'volume' ? volume : time;
  const lastActive = [...buckets].reverse().find((b) => b.value > 0)?.key ?? buckets.at(-1)?.key ?? '';
  const [pick, setPick] = useState(lastActive);
  const picked = buckets.find((b) => b.key === pick) ?? buckets.find((b) => b.key === lastActive);
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const dense = buckets.length > 12;
  const minutes = minutesOf(totalSeconds);
  const perDay = cur.days ? cur.volume / cur.days : 0;
  const perSession = timedSessions ? minutesOf(totalSeconds / timedSessions) : 0;
  const unit = (value: number) => metric === 'volume' ? `${fmt(value, 0)} kg` : `${minutesOf(value)} 分钟`;
  const pickLabel = picked ? (/^\d{4}-\d{2}-\d{2}$/.test(picked.key) ? `${picked.key.slice(5, 7)}.${picked.key.slice(8)}` : `${Number(picked.key.slice(5, 7))} 月`) : '';

  function switchTo(next: 'volume' | 'time') {
    if (next === metric) return;
    haptic(6);
    setMetric(next);
  }

  return <div className="stats-overview" data-metric={metric}>
    <p className="review-total-label">{periodLabel}{metric === 'volume' ? '训练容量' : '运动时间'}</p>
    <div className="review-total-num stats-big" key={metric}>
      {metric === 'volume' ? <><SplitNumber value={cur.volume} /><em>kg</em></>
        : <><b className="big-num">{minutes >= 600 ? fmt(minutes / 60) : minutes}</b><em>{minutes >= 600 ? '小时' : '分钟'}</em></>}
    </div>
    <p className="stats-delta">{metric === 'volume' ? delta(cur.volume, prev.volume) : delta(cur.durationMin, prev.durationMin)}</p>

    <div className="stats-trend-head">
      <h2 className="v-section-title">{metric === 'volume' ? '容量趋势' : '运动时间'}</h2>
      {picked && <span><small>{pickLabel}</small><b>{unit(picked.value)}</b></span>}
    </div>
    <div className={`review-bars stats-bars${dense ? ' month' : ''}`} style={dense ? undefined : { gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
      {buckets.map((b, i) => <button key={b.key} type="button" className="review-bar" data-picked={b.key === picked?.key || undefined}
        aria-pressed={b.key === picked?.key} aria-label={`${b.label} ${unit(b.value)}`}
        onClick={() => { haptic(4); setPick(b.key); }}>
        <span className="review-bar-track">
          <span className="review-bar-fill" style={{ height: `${b.value ? Math.max(6, b.value / max * 100) : 0}%`, animationDelay: `${i * (dense ? 10 : 36)}ms` }} />
        </span>
        <small>{dense ? (i % 7 === 0 ? b.label : '') : b.label}</small>
      </button>)}
    </div>

    <div className="readouts">
      <div className="readout"><b className="big-num">{cur.sessions}</b><span>次</span><em>训练次数</em></div>
      <div className="readout"><b className="big-num">{cur.days}</b><span>天</span><em>训练天数</em></div>
      <div className="readout"><b className="big-num">{cur.sets}</b><span>组</span><em>完成组数</em></div>
    </div>

    <div className="stats-tiles">
      <button type="button" className="stats-tile volume" aria-pressed={metric === 'volume'} onClick={() => switchTo('volume')}>
        <span className="kicker"><i className="ring" aria-hidden="true" />训练容量</span>
        <span className="tile-num"><b className="big-num">{fmt(perDay, 0)}</b><em>kg / 训练日</em></span>
        <span className="tile-ticks" aria-hidden="true">{volume.map((b) => <i key={b.key} style={{ height: `${b.value ? 30 + b.value / Math.max(1, ...volume.map((v) => v.value)) * 70 : 18}%` }} data-on={b.value > 0 || undefined} />)}</span>
      </button>
      <button type="button" className="stats-tile time" aria-pressed={metric === 'time'} onClick={() => switchTo('time')}>
        <span className="kicker"><i className="ring" aria-hidden="true" />运动时间</span>
        <span className="tile-num"><b className="big-num">{perSession}</b><em>分钟 / 次</em></span>
        <span className="tile-ticks" aria-hidden="true">{time.map((b) => <i key={b.key} style={{ height: `${b.value ? 30 + b.value / Math.max(1, ...time.map((v) => v.value)) * 70 : 18}%` }} data-on={b.value > 0 || undefined} />)}</span>
      </button>
    </div>
    {cur.quickSessions > 0 && <p className="hint">另有 {cur.quickSessions} 次语音训练没有组数和时长，只计入次数与天数。</p>}
    {cur.sessions === 0 && <p className="hint center">{period === 'week' ? '本周' : '这段时间'}还没有完成的训练。<Link href="/body">去安排</Link></p>}
  </div>;
}

/* ---------------- 肌群 ---------------- */
const COMPARE = {
  sets: { label: '组数', unit: '组', of: (p: GroupCard['points'][number]) => p.sets },
  volume: { label: '容量', unit: 'kg', of: (p: GroupCard['points'][number]) => p.volume },
  sessions: { label: '次数', unit: '次', of: (p: GroupCard['points'][number]) => p.sessions },
  seconds: { label: '时长', unit: '分钟', of: (p: GroupCard['points'][number]) => p.seconds / 60 },
} as const;

/** 两张身体图各占半边：正面图靠右、标注收在左侧；背面图靠左、标注收在右侧，肌肉两侧对称，标注点都换到靠外的那一侧 */
const STAGE = { front: { left: 32, labelEdge: 33 }, back: { left: -2, labelEdge: 67 } } as const;
const IMG_W = 70;
function callouts(side: 'front' | 'back', markers: (typeof VIEWS)[number]['markers'], trained: ReadonlyMap<MuscleId, MuscleRow>) {
  const { left } = STAGE[side];
  const points = markers.filter(([id]) => trained.has(id)).map(([id, , , x, y]) => {
    let ix = (x - 22) / 56 * 100;
    if (side === 'front' ? ix > 50 : ix < 50) ix = 100 - ix;
    return { id, px: left + ix * IMG_W / 100, py: y, ly: y };
  }).sort((a, b) => a.py - b.py);
  // 标注至少隔开 13%，超出底部就整体上移
  let prev = -Infinity;
  for (const p of points) { p.ly = Math.max(p.py, prev + 13); prev = p.ly; }
  const overflow = (points.at(-1)?.ly ?? 0) - 94;
  if (overflow > 0) for (const p of points) p.ly = Math.max(4, p.ly - overflow);
  return points;
}

function Muscles({ period, periodLabel, muscles, groups, variant, selected, onSelect }: Parameters<typeof StatsBoard>[0] & {
  selected: MuscleId | null;
  onSelect: (id: MuscleId) => void;
}) {
  const setSelected = onSelect;
  const [compare, setCompare] = useState(false);
  const [metric, setMetric] = useState<keyof typeof COMPARE>('sets');
  const byId = new Map(muscles.map((m) => [m.id, m]));
  const total = muscles.reduce((sum, m) => sum + m.volume, 0);
  const row = selected ? byId.get(selected) : undefined;
  const share = row && total ? row.volume / total : 0;
  const folder = variant === 'female' ? '/models/sculpture/female' : '/models/sculpture';
  const spec = COMPARE[metric];
  const rows = groups.map((g) => ({ ...g, total: g.points.reduce((sum, p) => sum + spec.of(p), 0) })).filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);
  const peak = Math.max(1, ...rows.flatMap((g) => g.points.map(spec.of)));

  return <div className="stats-muscles">
    <div className="stats-bodies">
      {VIEWS.map(({ side, label, markers }) => {
        const marks = callouts(side, markers, byId);
        const { left, labelEdge } = STAGE[side];
        const peak = Math.max(1, ...muscles.map((m) => m.volume));
        return <figure key={side} className="stats-body" data-side={side}>
          <div className="stats-body-stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${folder}/stats-${side}.png`} alt="" draggable={false} style={{ left: `${left}%`, width: `${IMG_W}%` }} />
            <svg className="callout-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {marks.map((m) => {
                const out = side === 'front' ? labelEdge + 4 : labelEdge - 4;
                return <path key={m.id} data-selected={m.id === selected || undefined} vectorEffect="non-scaling-stroke"
                  d={`M${m.px.toFixed(1)} ${m.py} L${out} ${m.ly.toFixed(1)} L${labelEdge} ${m.ly.toFixed(1)}`} />;
              })}
            </svg>
            {marks.map((m) => {
              const row = byId.get(m.id)!;
              const size = 5 + Math.sqrt(row.volume / peak) * 7;
              return <button key={m.id} type="button" className="callout-point" data-selected={m.id === selected || undefined}
                style={{ left: `${m.px}%`, top: `${m.py}%`, '--size': `${size.toFixed(1)}px` } as CSSProperties}
                aria-hidden="true" tabIndex={-1} onClick={() => { haptic(6); setSelected(m.id); }} />;
            })}
            {marks.map((m) => {
              const row = byId.get(m.id)!;
              return <button key={`l-${m.id}`} type="button" className="callout-label" data-side={side} data-selected={m.id === selected || undefined}
                style={{ top: `${m.ly}%`, ...(side === 'front' ? { right: `${100 - labelEdge}%` } : { left: `${labelEdge}%` }) }}
                aria-pressed={m.id === selected} onClick={() => { haptic(6); setSelected(m.id); }}>
                <span>{muscleLabel(m.id)}</span>
                <b>{row.volume ? fmt(row.volume, 0) : row.sets}<em>{row.volume ? 'kg' : '组'}</em></b>
              </button>;
            })}
          </div>
          <figcaption>{label}</figcaption>
        </figure>;
      })}
      {muscles.length === 0 && <p className="callout-empty">{periodLabel}还没有记到具体肌群的训练</p>}
    </div>

    <section className="muscle-panel" data-compare={compare || undefined}>
      <span className="muscle-panel-grab" aria-hidden="true" />
      {!compare ? (row ? <div className="muscle-panel-body" key={row.id}>
        <div className="muscle-panel-head"><h2>{muscleLabel(row.id)}</h2><span>{periodLabel}容量</span></div>
        <div className="muscle-panel-num">{row.volume ? <><SplitNumber value={row.volume} /><em>kg</em></> : <b className="big-num small-zero">自重</b>}</div>
        <div className="muscle-share">
          <span className="meter-ticks" aria-hidden="true">{Array.from({ length: 48 }, (_, i) => <i key={i} data-on={i < Math.round(share * 48) || undefined} />)}</span>
          <b>{Math.round(share * 100)}%</b>
        </div>
        <p className="muscle-panel-sub">{row.sets} 组 · {row.sessions} 次训练 · {minutesOf(row.seconds)} 分钟</p>
      </div> : <div className="muscle-panel-body"><div className="muscle-panel-head"><h2>还没有训练</h2></div>
        <p className="muscle-panel-sub">{periodLabel}没有记到具体肌群的负重组。</p></div>)
        : <div className="muscle-compare">
          <div className="muscle-panel-head"><h2>肌群对比</h2><span>{periodLabel} · 按{period === 'week' || period === 'month' ? '天' : '月'}</span></div>
          <div className="vseg small on-coral" role="tablist" aria-label="对比指标">
            {(Object.keys(COMPARE) as (keyof typeof COMPARE)[]).map((key) => <button key={key} type="button" role="tab" aria-selected={metric === key}
              className={metric === key ? 'on' : ''} onClick={() => { haptic(4); setMetric(key); }}>{COMPARE[key].label}</button>)}
          </div>
          {rows.length ? <ul className="compare-rows">
            {rows.map((g) => <li key={g.label}>
              <span className="compare-name">{g.label}</span>
              <span className="compare-spark" aria-hidden="true">{g.points.map((p) => <i key={p.key} style={{ height: `${spec.of(p) ? Math.max(12, spec.of(p) / peak * 100) : 4}%` }} data-on={spec.of(p) > 0 || undefined} />)}</span>
              <b>{fmt(g.total, 0)}<em>{spec.unit}</em></b>
            </li>)}
          </ul> : <p className="muscle-panel-sub">这个指标还没有数据。</p>}
        </div>}
      <button type="button" className="muscle-panel-toggle" aria-expanded={compare} onClick={() => { haptic(5); setCompare(!compare); }}>
        <span>{compare ? '收起对比' : '查看肌群对比'}</span><Icon name={compare ? 'chevron-down' : 'chevron-right'} size={18} />
      </button>
    </section>
  </div>;
}

/* ---------------- 动作 ---------------- */
const RM = {
  pr: { tab: 'PR', title: '极限重量 · 估算 1RM', empty: '没有可估算的负重组' },
  growth: { tab: '8–12 RM', title: '黄金增重重量', empty: '没有 8–12 次的组' },
  endurance: { tab: '12–15 RM', title: '肌耐力重量', empty: '没有 12–15 次的组' },
} as const;
type Rm = keyof typeof RM;

function Exercises({ exercises, exerciseMuscles, periodLabel, muscle }: Parameters<typeof StatsBoard>[0] & { muscle: MuscleId | null }) {
  const [rm, setRm] = useState<Rm>('pr');
  const card = useRef<HTMLElement>(null);
  const own = muscle ? exercises.filter((e) => exerciseMuscles[e.id] === muscle) : exercises;
  const ranked = [...own].sort((a, b) => b.sessions.length - a.sessions.length || (b.pr?.value ?? 0) - (a.pr?.value ?? 0));
  const [activeId, setActiveId] = useState(ranked[0]?.id);
  const [formula, setFormula] = useState(false);
  const formulaId = useId();
  const active = ranked.find((e) => e.id === activeId) ?? ranked[0];
  const head = <div className="muscle-ex-head">
    <i aria-hidden="true" /><b>{muscle ? muscleLabel(muscle) : '全部'}</b><span>的动作</span><small>{ranked.length} 个</small>
  </div>;
  if (!active) return <div className="stats-exercises">{head}<p className="hint stats-empty">{periodLabel}{muscle ? '这块肌群没有可统计的器械动作组。' : '还没有已记录的动作组。'}</p></div>;
  const best = active[rm];
  const points = [...active.sessions].reverse().flatMap((s) => s[rm] ? [{ ...s[rm]!, id: s.id }] : []);
  const last = points.at(-1);

  return <div className="stats-exercises">
    {head}
    <div className="ex-head">
      <span className="thumb">{/* eslint-disable-next-line @next/next/no-img-element */}{active.image && <img src={imageUrl(active.image)} alt="" />}</span>
      <div><small>动作表现</small><h2>{active.name}</h2></div>
    </div>
    <div className="vseg rm-tabs" role="tablist" aria-label="表现指标">
      {(Object.keys(RM) as Rm[]).map((key) => <button key={key} type="button" role="tab" aria-selected={rm === key} className={rm === key ? 'on' : ''}
        onClick={() => { haptic(4); setRm(key); setFormula(false); }}>{RM[key].tab}</button>)}
    </div>

    <section className="tile lilac ex-card" key={`${active.id}-${rm}`} ref={card}>
      <p className="kicker">{RM[rm].title}
        {rm === 'pr' && <button type="button" className="help" aria-expanded={formula} aria-controls={formulaId} aria-label="估算公式" onClick={() => setFormula(!formula)}>?</button>}</p>
      {formula && <div id={formulaId} className="ex-formula">
        <b>Epley 公式</b>估算 1RM = 实际重量 ×（1 + 次数 ÷ 30），做 1 次时直接用实举重量；取本期 1–15 次负重组的最高值。
      </div>}
      {best ? <>
        <div className="tile-num"><b className="big-num">{best.value > 0 ? fmt(best.value) : '自重'}</b>{best.value > 0 && <em>kg</em>}</div>
        <LineChart points={points} />
        <div className="ex-foot">
          <b className="big-num">{last ? `${last.date.slice(5, 7)}.${last.date.slice(8)}` : ''}</b>
          <span>实练 {best.weight > 0 ? `${fmt(best.weight)} kg` : '自重'} × {best.reps} 次</span>
        </div>
      </> : <p className="ex-empty">{periodLabel}{RM[rm].empty}</p>}
    </section>

    <ul className="ex-list">
      {ranked.filter((e) => e.id !== active.id).map((e) => <li key={e.id}>
        <button type="button" onClick={() => { haptic(5); setActiveId(e.id); card.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
          <span className="thumb small">{/* eslint-disable-next-line @next/next/no-img-element */}{e.image && <img src={imageUrl(e.image)} alt="" loading="lazy" />}</span>
          <strong>{e.name}</strong>
          <small>{e[rm] ? (e[rm]!.value > 0 ? `${fmt(e[rm]!.value)} kg` : '自重') : '—'}</small>
          <Icon name="chevron-right" size={18} className="row-chev" />
        </button>
      </li>)}
    </ul>
  </div>;
}

function LineChart({ points }: { points: { value: number; date: string; id: number }[] }) {
  const W = 300, H = 128, PAD = 14;
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || Math.max(1, hi * .1);
  const x = (i: number) => points.length === 1 ? W / 2 : PAD + i / (points.length - 1) * (W - PAD * 2);
  const y = (v: number) => H - 22 - (v - lo + (hi === lo ? span / 2 : 0)) / (span || 1) * (H - 44);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const step = Math.max(1, Math.ceil(points.length / 4));
  return <svg className="ex-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`共 ${points.length} 次实练的变化曲线`}>
    {[0, 1, 2].map((i) => <line key={i} x1="0" x2={W} y1={12 + i * (H - 44) / 2} y2={12 + i * (H - 44) / 2} className="grid" />)}
    <path d={path} className="line" pathLength={1} />
    {points.map((p, i) => <circle key={p.id} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 6 : 4} className={i === points.length - 1 ? 'last' : 'pt'} />)}
    {points.map((p, i) => (i % step === 0 || i === points.length - 1) && <text key={`t${p.id}`} x={x(i)} y={H - 4} textAnchor="middle">{p.date.slice(5).replace('-', '/')}</text>)}
  </svg>;
}
