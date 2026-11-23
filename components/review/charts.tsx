'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { MuscleSets } from '@/lib/review-wall';
import type { SculptureVariant } from '@/lib/sculpture-groups';
import { STAGE, IMG_W, VIEWS, callouts, muscleLabel } from '../StatsBodyMap';
import { fmt, haptic } from './wall-utils';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const gapFor = (n: number) => (n > 20 ? 3 : n > 10 ? 6 : 10);
const delay = (i: number, n: number) => Math.round(i * Math.min(42, 320 / n));
type Vars = CSSProperties & Record<`--${string}`, string | number>;

/** 数字从上一次的读数滚到新读数；split 时末两位降为中灰，和页面其他大号数字一致 */
export function CountUp({ value, dec = 0, split = false, ms = 650, from0 = false }: { value: number; dec?: number; split?: boolean; ms?: number; from0?: boolean }) {
  // 首屏直接显示读数（服务端渲染一致）；抽屉里打开时从 0 滚上来
  const [shown, setShown] = useState(from0 ? 0 : value);
  const from = useRef(from0 ? 0 : value);
  const first = useRef(true);
  useEffect(() => {
    const start = first.current ? (from0 ? 0 : value) : from.current;
    first.current = false;
    if (reduced() || start === value) { setShown(value); from.current = value; return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      const v = start + (value - start) * e;
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = fmt(shown, dec);
  if (!split || Math.abs(value) < 100) return <>{text}</>;
  let digits = 0, cut = text.length;
  while (cut > 0 && digits < 2) { cut -= 1; if (/\d/.test(text[cut])) digits += 1; }
  return <>{text.slice(0, cut)}<span className="rw-dim">{text.slice(cut)}</span></>;
}

/** 分段胶囊：选中块带回弹滑过去 */
export function Seg<T extends string>({ options, value, onChange, label }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const ind = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const on = box.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    const el = ind.current;
    if (!on || !el) return;
    if (!placed.current) el.style.transition = 'none';
    el.style.width = `${on.offsetWidth}px`;
    el.style.translate = `${on.offsetLeft}px 0`;
    if (!placed.current) { void el.offsetWidth; el.style.transition = ''; placed.current = true; }
  }, [value]);
  return <div className="rw-seg" ref={box} role="group" aria-label={label}>
    <span className="rw-seg-ind" ref={ind} aria-hidden="true" />
    {options.map((o) => <button key={o.key} type="button" aria-pressed={o.key === value}
      onClick={() => { if (o.key !== value) { haptic(); onChange(o.key); } }}>{o.label}</button>)}
  </div>;
}

/**
 * 可拖动取值的绘图区：按下选中手指下那一格，拖动跟着换；再按一次已选中的那一格回到汇总。
 * 在数据块里时阻止冒泡，免得按图也把抽屉打开。
 */
export function PickPlot({ n, picked, onPick, className, style, children, label }: {
  n: number; picked: number | null; onPick: (i: number | null) => void; className: string; style?: CSSProperties; children: ReactNode; label: string;
}) {
  const down = useRef(false);
  const last = useRef<number | null>(null);
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  return <div className={className} style={style} role="group" aria-label={label}
    onPointerDown={(e) => {
      e.stopPropagation();
      down.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      const i = at(e);
      last.current = i;
      haptic();
      onPick(picked === i ? null : i);
    }}
    onPointerMove={(e) => {
      if (!down.current) return;
      const i = at(e);
      if (i === last.current) return;
      last.current = i;
      haptic(4);
      onPick(i);
    }}
    onPointerUp={() => { down.current = false; }}
    onPointerCancel={() => { down.current = false; }}
    onClick={(e) => e.stopPropagation()}
    onKeyDown={(e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const cur = picked ?? n - 1;
      onPick(Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1))));
    }}
    tabIndex={0}>{children}</div>;
}

export function Xl({ labels, sel, gap }: { labels: string[]; sel: number; gap?: number }) {
  return <div className="rw-xl" style={{ '--n': labels.length, '--gap': `${gap ?? gapFor(labels.length)}px` } as Vars}>
    {labels.map((l, i) => <span key={i} className={i === sel ? 'sel' : undefined}>{l}</span>)}
  </div>;
}

/**
 * 柱状图。值可以为负（热量盈余），零线按值域自动放；null 表示那一格没有数据。
 * 堆叠时每格传一个数组，颜色按 colors 顺序。
 */
export function Bars({ values, labels, picked, onPick, def, tone, selColor = 'var(--rw-ink)', band, colors, height = 150, label, floor }: {
  values: (number | number[] | null)[]; labels: string[]; picked: number | null; onPick: (i: number | null) => void; def: number;
  tone?: (v: number, i: number) => string; selColor?: string; band?: [number, number, string]; colors?: string[]; height?: number; label: string;
  /** 值域下限（默认 0） */
  floor?: number;
}) {
  const n = values.length;
  const tot = values.map((v) => (v === null ? null : Array.isArray(v) ? v.reduce((a, b) => a + b, 0) : v));
  const nums = tot.filter((v): v is number => v !== null);
  const lo = Math.min(floor ?? 0, ...nums, band ? band[0] : 0);
  const hi = Math.max(1, ...nums, band ? band[1] : 0) * 1.1;
  const span = hi - lo || 1;
  const y = (v: number) => ((v - lo) / span) * 100;
  const sel = picked ?? def;
  return <div className="rw-chart" style={{ '--n': n, '--gap': `${gapFor(n)}px`, '--sel': selColor } as Vars}>
    <PickPlot n={n} picked={picked} onPick={onPick} className="rw-plot" style={{ height }} label={label}>
      {band && <div className="rw-band" style={{ bottom: `${y(band[0])}%`, height: `${y(band[1]) - y(band[0])}%` }}><span>{band[2]}</span></div>}
      {lo < 0 && <i className="rw-zero" style={{ bottom: `${y(0)}%` }} />}
      {values.map((v, i) => {
        const t = tot[i];
        const cls = ['rw-bar', i === sel ? 'sel' : '', t === null || t === 0 ? 'zero' : tone ? tone(t, i) : ''].filter(Boolean).join(' ');
        const bottom = t === null ? y(0) : y(Math.min(0, t));
        const h = t === null ? 0 : Math.abs(y(t) - y(0));
        return <div key={i} className="rw-col">
          <div className={cls} data-neg={t !== null && t < 0 || undefined}
            style={{ bottom: `${bottom}%`, height: t ? `max(${h}%, 4px)` : '4px', '--d': `${delay(i, n)}ms` } as Vars}>
            {Array.isArray(v) && colors && v.map((s, k) => <i key={k} style={{ flexGrow: s, background: colors[k] }} />)}
          </div>
        </div>;
      })}
    </PickPlot>
    <Xl labels={labels} sel={sel} />
  </div>;
}

/** 折线：null 的日子不画点，线只连有数据的点；可选一条均线和突破标记 */
export function LineChart({ values, avgLine, labels, picked, onPick, def, color = 'var(--rw-heat)', marks = [], W = 350, H = 150, pick = true, label }: {
  values: (number | null)[]; avgLine?: (number | null)[]; labels?: string[]; picked?: number | null; onPick?: (i: number | null) => void; def?: number;
  color?: string; marks?: number[]; W?: number; H?: number; pick?: boolean; label: string;
}) {
  const n = values.length;
  const all = [...values, ...(avgLine ?? [])].filter((v): v is number => v !== null);
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.18 || 1;
  const px = 10, py = 14;
  const X = (i: number) => px + (i * (W - 2 * px)) / Math.max(1, n - 1);
  const Y = (v: number) => H - py - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 2 * py);
  const pts = values.map((v, i) => (v === null ? null : [X(i), Y(v)] as const));
  const path = (vs: (number | null)[]) => vs.map((v, i) => (v === null ? '' : `${vs.slice(0, i).some((x) => x !== null) ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`)).join('');
  const d = path(values);
  const real = pts.filter(Boolean) as (readonly [number, number])[];
  const sel = picked ?? def ?? n - 1;
  const cur = pts[sel];
  const gid = `rwg${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const r = n > 20 ? 2.3 : 3.6;
  const svg = <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
    <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".22" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
    {[0.25, 0.5, 0.75].map((k) => <line key={k} className="rw-grid" x1="0" x2={W} y1={H * k} y2={H * k} />)}
    {real.length > 1 && <path className="rw-area" d={`${d}L${real.at(-1)![0].toFixed(1)} ${H}L${real[0][0].toFixed(1)} ${H}Z`} fill={`url(#${gid})`} />}
    {avgLine && <path className="rw-avg" d={path(avgLine)} />}
    {real.length > 1 && <path className="rw-ln" d={d} pathLength={1} />}
    {pts.map((p, i) => p && <circle key={i} className={marks.includes(i) ? 'rw-pt mk' : 'rw-pt'} cx={p[0]} cy={p[1]} r={marks.includes(i) ? r + 1.4 : r} style={{ '--d': `${500 + delay(i, n)}ms` } as Vars} />)}
    {pick && <>
      <line className="rw-guide" x1="0" x2="0" y1="0" y2={H} style={{ transform: `translate(${X(sel)}px, 0)` }} />
      {cur && <circle className="rw-cur" cx="0" cy="0" r="6" style={{ transform: `translate(${cur[0]}px, ${cur[1]}px)` }} />}
    </>}
  </svg>;
  return <div className="rw-chart" style={{ '--n': n, '--gap': `${gapFor(n)}px`, color } as Vars}>
    {pick && onPick ? <PickPlot n={n} picked={picked ?? null} onPick={onPick} className="rw-svgplot" label={label}>{svg}</PickPlot>
      : <div className="rw-svgplot static" role="img" aria-label={label}>{svg}</div>}
    {labels && <Xl labels={labels} sel={sel} />}
  </div>;
}

/** 点列：每格叠几个点（最多 7 个），没有就留一个小点 */
export function DotCols({ counts, labels, picked, onPick, label }: { counts: number[]; labels: string[]; picked: number | null; onPick: (i: number | null) => void; label: string }) {
  const n = counts.length;
  const dot = n > 20 ? 9 : 14;
  const height = Math.max(36, Math.min(7, Math.max(0, ...counts)) * (dot + 4) + 14);
  const sel = picked ?? n - 1;
  return <div className="rw-chart" style={{ '--n': n, '--gap': `${gapFor(n)}px` } as Vars}>
    <PickPlot n={n} picked={picked} onPick={onPick} className="rw-plot rw-dots" style={{ height }} label={label}>
      {counts.map((c, i) => <div key={i} className={i === sel ? 'rw-dcol sel' : 'rw-dcol'}>
        {c ? Array.from({ length: Math.min(c, 7) }, (_, k) => <b key={k} style={{ '--d': `${delay(i, n)}ms`, '--k': k } as Vars} />)
          : <b className="none" style={{ '--d': `${delay(i, n)}ms`, '--k': 0 } as Vars} />}
      </div>)}
    </PickPlot>
    <Xl labels={labels} sel={sel} />
  </div>;
}

/** 三大营养逐日矩阵：实心达标、描边不足、加圈超出，没记饮食留空 */
export function Matrix({ rows, labels, picked, onPick }: {
  rows: { name: string; color: string; vals: (number | null)[] }[]; labels: string[]; picked: number | null; onPick: (i: number | null) => void;
}) {
  const n = labels.length;
  const cell = n > 20 ? 8 : n > 7 ? 18 : 24;
  const sel = picked ?? n - 1;
  const cls = (v: number | null) => (v === null ? 'none' : v > 1.1 ? 'over' : v >= 0.9 ? 'ok' : 'under');
  return <div className="rw-chart rw-mx" style={{ '--n': n, '--gap': `${gapFor(n)}px`, '--cell': `${cell}px` } as Vars}>
    {rows.map((r) => <div key={r.name} className="rw-mx-row">
      <span>{r.name}</span>
      <PickPlot n={n} picked={picked} onPick={onPick} className="rw-plot rw-mxp" label={`${r.name}每天的完成度`}>
        {r.vals.map((v, i) => <div key={i} className={`rw-mcol ${cls(v)}${i === sel ? ' sel' : ''}`} style={{ '--c': r.color, '--d': `${delay(i, n) + 80}ms` } as Vars}><b /></div>)}
      </PickPlot>
    </div>)}
    <div className="rw-mx-foot"><Xl labels={labels} sel={sel} /></div>
    <div className="rw-mx-key"><span><i />达标 90–110%</span><span><i className="o" />超出</span><span><i className="u" />不足</span></div>
  </div>;
}

export function Rank({ title, rows, unit, color, selected, onSelect }: {
  title: string; rows: { key: string; label: string; value: number }[]; unit: string; color: string; selected?: string | null; onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return <div className={selected ? 'rw-rank picking' : 'rw-rank'}>
    <h3>{title}</h3>
    {rows.map((r, i) => {
      const body = <><span>{r.label}</span><b>{fmt(r.value)}<small>{unit}</small></b><i /></>;
      const style = { '--w': `${(r.value / max) * 100}%`, '--d': `${150 + i * 50}ms`, '--c': color } as Vars;
      return onSelect
        ? <button key={r.key} type="button" className={r.key === selected ? 'rw-rank-row sel' : 'rw-rank-row'} style={style} aria-pressed={r.key === selected} onClick={() => { haptic(); onSelect(r.key); }}>{body}</button>
        : <div key={r.key} className="rw-rank-row" style={style}>{body}</div>;
    })}
  </div>;
}

/** 训练分布：统计页「肌群与动作」同一张解剖图式标注，正面标注在左、背面在右，点越大组数越多 */
export function CalloutMap({ muscles, variant, selected, onSelect }: {
  muscles: MuscleSets[]; variant: SculptureVariant; selected: string | null; onSelect: (id: string) => void;
}) {
  const byId = new Map(muscles.map((m) => [m.id, m]));
  const peak = Math.max(1, ...muscles.map((m) => m.sets));
  const folder = variant === 'female' ? '/models/sculpture/female' : '/models/sculpture';
  return <div className="rw-cmap">
    {VIEWS.map(({ side, label, markers }) => {
      const marks = callouts(side, markers, byId);
      const { left, labelEdge } = STAGE[side];
      const out = side === 'front' ? labelEdge + 4 : labelEdge - 4;
      const d = (k: number) => 220 + k * 55;
      return <figure key={side} data-side={side}>
        <div className="rw-cstage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${folder}/stats-${side}.png`} alt="" draggable={false} style={{ left: `${left}%`, width: `${IMG_W}%` }} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {marks.map((m, k) => <path key={m.id} className={m.id === selected ? 'sel' : undefined} vectorEffect="non-scaling-stroke" style={{ '--d': `${d(k)}ms` } as Vars}
              d={`M${m.px.toFixed(1)} ${m.py} L${out} ${m.ly.toFixed(1)} L${labelEdge} ${m.ly.toFixed(1)}`} />)}
          </svg>
          {marks.map((m, k) => <button key={m.id} type="button" className={m.id === selected ? 'rw-cpt sel' : 'rw-cpt'} aria-hidden="true" tabIndex={-1}
            style={{ left: `${m.px}%`, top: `${m.py}%`, '--size': `${(5 + Math.sqrt(byId.get(m.id)!.sets / peak) * 7).toFixed(1)}px`, '--d': `${d(k)}ms` } as Vars}
            onClick={() => { haptic(); onSelect(m.id); }} />)}
          {marks.map((m, k) => <button key={`l-${m.id}`} type="button" className={m.id === selected ? 'rw-clab sel' : 'rw-clab'} data-side={side} aria-pressed={m.id === selected}
            style={{ top: `${m.ly}%`, ...(side === 'front' ? { right: `${100 - labelEdge}%` } : { left: `${labelEdge}%` }), '--d': `${d(k) + 80}ms` } as Vars}
            onClick={() => { haptic(); onSelect(m.id); }}>
            <span>{muscleLabel(m.id)}</span>
            <b>{fmt(byId.get(m.id)!.sets)}<em>组</em></b>
          </button>)}
        </div>
        <figcaption>{label}</figcaption>
      </figure>;
    })}
  </div>;
}

/** 数据块上的小人体：每个肌群一个点，位置和抽屉里那张图一一对应 */
export function MiniBodies({ muscles, variant }: { muscles: MuscleSets[]; variant: SculptureVariant }) {
  const byId = new Map(muscles.map((m) => [m.id, m]));
  const peak = Math.max(1, ...muscles.map((m) => m.sets));
  const folder = variant === 'female' ? '/models/sculpture/female' : '/models/sculpture';
  return <div className="rw-bodies" aria-hidden="true">
    {VIEWS.map(({ side, markers }) => <figure key={side}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${folder}/stats-${side}.png`} alt="" draggable={false} />
      {markers.filter(([id]) => byId.has(id)).map(([id, , , x, y], k) => {
        let ix = ((x - 22) / 56) * 100;
        if (side === 'front' ? ix > 50 : ix < 50) ix = 100 - ix;
        return <i key={id} style={{ left: `${ix.toFixed(1)}%`, top: `${y}%`, '--s': `${(2.6 + Math.sqrt(byId.get(id)!.sets / peak) * 3.6).toFixed(1)}px`, '--d': `${320 + k * 60}ms` } as Vars} />;
      })}
    </figure>)}
  </div>;
}
