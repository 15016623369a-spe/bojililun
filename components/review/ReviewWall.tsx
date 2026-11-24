'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { WallData, WallHero, RangeKey } from '@/lib/review-wall';
import type { SculptureVariant } from '@/lib/sculpture-groups';
import { muscleLabel } from '../StatsBodyMap';
import Icon from '../ui/Icon';
import { CountUp, MiniBodies, PickPlot, Seg, Xl } from './charts';
import { SHEETS, SHEET_TITLE, type SheetId } from './sheets';
import { RANGES, avg, fmt, haptic, present, short, sum, weekday } from './wall-utils';

type Vars = CSSProperties & Record<`--${string}`, string | number>;
const SPRING = 'linear(0, 0.006 1.1%, 0.024 2.2%, 0.094 4.5%, 0.393 11.5%, 0.615 17.4%, 0.77 23.1%, 0.878 29%, 0.947 35.3%, 0.988 42.2%, 1.008 50%, 1.015 59.3%, 1.013 71.3%, 1)';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pageParts = () => [...document.querySelectorAll<HTMLElement>('.journal-shell.is-review > :is(.journal-head, .journal-content)')];
const shell = () => document.querySelector<HTMLElement>('.journal-shell.is-review');

/**
 * 回顾页的数据块墙：容量主块 + 一组同结构的小数据块。点一块，它在原位长成毛玻璃抽屉，
 * 背后的页面缩到 0.93，不压暗、不虚化；下拉、点背后、返回键或 Esc 收起。
 * 交互原型见 docs/design/2026-11-23/review-tiles-prototype.html。
 */
export default function ReviewWall({ hero, data, variant }: { hero: WallHero; data: WallData; variant: SculptureVariant }) {
  const [open, setOpen] = useState<SheetId | null>(null);
  const [lifted, setLifted] = useState<SheetId | null>(null);
  const origin = useRef<{ el: HTMLElement; rect: DOMRect; keyboard: boolean } | null>(null);
  const router = useRouter();

  const openSheet = useCallback((id: SheetId, el: HTMLElement, keyboard = false) => {
    if (open) return;
    haptic(8);
    origin.current = { el, rect: el.getBoundingClientRect(), keyboard };
    history.pushState({ reviewSheet: id }, '');
    setOpen(id);
    setLifted(id);
  }, [open]);

  const tile = (id: SheetId, needsProfile = false) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-haspopup': 'dialog' as const,
    'data-lifted': lifted === id || undefined,
    onClick: (e: { currentTarget: HTMLElement }) => {
      if (needsProfile && !data.profile) { router.push('/me'); return; }
      openSheet(id, e.currentTarget);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      if (needsProfile && !data.profile) { router.push('/me'); return; }
      openSheet(id, e.currentTarget, true);
    },
  });

  const days = data.days;
  const today = days.at(-1)!;
  const week = days.slice(-7);
  const p = data.profile;
  // 「今天」的饮食类读数：今天没记就退到 7 天内最近记过的那天
  const fed = [...week].reverse().find((d) => d.kcal !== null) ?? null;
  const fedLabel = fed && fed.date !== today.date ? `${short(fed.date)} · ` : '';

  return <div className="rw">
    <HeroTile hero={hero} {...tile('volume')} />

    <div className="rw-grid">
      <PrTile data={data} {...tile('pr')} />
      <div className="rw-tile" {...tile('body')}>
        <TileHead title="训练分布" />
        <div className="rw-tile-b"><MiniBodies muscles={data.muscles.d7} variant={variant} /></div>
        <div className="rw-tile-f">{data.muscles.d7.length
          ? <><span>{data.muscles.d7.slice(0, 2).map((m) => muscleLabel(m.id)).join(' · ')}</span><span>{data.muscles.d7.length} 个肌群</span></>
          : <span>近 7 天还没有训练</span>}</div>
      </div>
    </div>

    <div className="rw-sec"><i aria-hidden="true" /><b>身体与饮食</b><span>今天 · {short(today.date)} {weekday(today.date)}</span></div>
    <div className="rw-grid">
      <WeightTile days={days} {...tile('weight')} />
      <div className="rw-tile" {...tile('macro', true)}>
        <TileHead title="三大营养完成度" />
        {!p ? <Setup text="在「我的」里设置营养目标" /> : !fed ? <Setup text="近 7 天还没记饮食" /> : <>
          <div className="rw-tile-b"><div className="rw-macro">
            <Rings rates={[(fed.carbs ?? 0) / p.carbs, (fed.protein ?? 0) / p.protein, (fed.fat ?? 0) / p.fat]} />
            <div className="rw-legend">
              <span style={{ '--c': 'var(--rw-carb)' } as Vars} title={`${Math.round(fed.carbs ?? 0)}/${p.carbs} g`}>碳水<b>{Math.round(((fed.carbs ?? 0) / p.carbs) * 100)}%</b></span>
              <span style={{ '--c': 'var(--rw-ink)' } as Vars} title={`${Math.round(fed.protein ?? 0)}/${p.protein} g`}>蛋白<b>{Math.round(((fed.protein ?? 0) / p.protein) * 100)}%</b></span>
              <span style={{ '--c': 'var(--lilac)' } as Vars} title={`${Math.round(fed.fat ?? 0)}/${p.fat} g`}>脂肪<b>{Math.round(((fed.fat ?? 0) / p.fat) * 100)}%</b></span>
            </div>
          </div></div>
          <div className="rw-tile-f"><span>{fedLabel}{fmt(fed.kcal ?? 0)} kcal</span><span>目标 {fmt(p.targetKcal)}</span></div>
        </>}
      </div>
      <DeficitTile data={data} fed={fed} fedLabel={fedLabel} {...tile('deficit', true)} />
      <div className="rw-tile" {...tile('metab', true)}>
        <TileHead title="代谢" />
        {!p || today.tdee === null || today.bmr === null ? <Setup text="补全身高、年龄和活动量" /> : <>
          <div className="rw-tile-b rw-metab">
            <div><span className="rw-num rw-m-big">{fmt(today.tdee)}<small>kcal</small></span><p>每日总代谢 · {p.activityLabel}</p></div>
            <div className="rw-msplit" aria-hidden="true"><i className="b" style={{ flexBasis: `${(today.bmr / today.tdee) * 100}%` }} /><i className="a" /></div>
            <div className="rw-mrow"><span><i className="b" />基础代谢</span><b>{fmt(today.bmr)}</b></div>
            <div className="rw-mrow"><span><i className="a" />日常活动</span><b>{fmt(today.tdee - today.bmr)}</b></div>
          </div>
        </>}
      </div>
    </div>
    <EnergyTile week={week} {...tile('energy')} />

    {open && <SheetLayer id={open} data={data} variant={variant} origin={origin}
      onClosed={() => { setOpen(null); setLifted(null); const o = origin.current; if (o?.keyboard) o.el.focus({ preventScroll: true }); }} />}
  </div>;
}

type TileProps = { role: 'button'; tabIndex: number; onClick: (e: { currentTarget: HTMLElement }) => void; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void; 'data-lifted'?: boolean };

function TileHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return <div className="rw-tile-h"><span>{title}</span>{children ?? <Icon name="chevron-right" size={14} stroke={2.4} />}</div>;
}

function Setup({ text }: { text: string }) {
  return <div className="rw-tile-b rw-setup"><p>{text}</p><span>去设置<Icon name="chevron-right" size={12} stroke={2.4} /></span></div>;
}

/* ---------------- 容量主块 ---------------- */
function HeroTile({ hero, ...tile }: { hero: WallHero } & TileProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const bars = hero.bars;
  const n = bars.length;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const gap = n > 12 ? 4 : n > 5 ? 9 : 14;
  const sel = picked ?? hero.sel;
  useEffect(() => setPicked(null), [hero.period]);
  return <div className="rw-tile rw-hero" {...tile} aria-label={`${hero.title}，打开详情`}>
    <div className="rw-tile-h">
      <span>{picked !== null ? bars[picked].pick : hero.title}</span>
      <Link className="stats-chip rw-chip" href={hero.statsHref} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <span className="stats-chip-bars" aria-hidden="true"><i /><i /><i /><i /></span>训练统计<Icon name="chevron-right" size={14} stroke={2} />
      </Link>
    </div>
    <div className="rw-hero-row">
      <span className="rw-num rw-hero-num"><b><CountUp value={picked !== null ? bars[picked].value : hero.total} split ms={picked !== null ? 320 : 650} /></b><small>kg</small></span>
      {/* 块是中号长方形，柱子要占满下面整宽：涨跌只留「↑ 50%」（完整说法在 title 里），训练天数、组数、时长收成一行 */}
      {hero.pill && <span className="rw-pill lemon" title={hero.pill}>{hero.pill.split(' 较')[0]}</span>}
      <p className="rw-hero-reads">{hero.reads.map((r) => <span key={r.label} aria-label={r.label}><b><CountUp value={r.value} dec={r.dec} /></b>{r.unit}</span>)}</p>
    </div>
    {n ? <div className="rw-hero-chart" key={hero.period} data-period={hero.period}>
      <PickPlot n={n} picked={picked} label="每天的训练容量，按住左右拖动查看" className="rw-hplot" style={{ '--n': n, '--gap': `${gap}px` } as Vars}
        onPick={(i) => { if (i === null || !bars[i].future) setPicked(i === hero.sel ? null : i); }}>
        {bars.map((b, i) => <div key={b.key} className={`rw-hcol${i === sel ? ' sel' : ''}${b.future ? ' future' : ''}`}>
          <i className="trk" /><i className="hb" style={{ height: `${(b.value / max) * 100}%`, '--d': `${Math.round(i * Math.min(42, 320 / n))}ms` } as Vars} />
        </div>)}
      </PickPlot>
      <Xl labels={bars.map((b) => b.label)} sel={sel} gap={gap} />
    </div> : <p className="rw-hero-empty">今天还没有训练，练完这里按动作列出容量</p>}
  </div>;
}

/* ---------------- 小数据块 ---------------- */
function PrTile({ data, ...tile }: { data: WallData } & TileProps) {
  const latest = data.prs.at(-1);
  const recent = data.prs.filter((e) => e.date >= data.days.at(-7)!.date).length;
  return <div className="rw-tile" {...tile}>
    <TileHead title="个人纪录" />
    {latest ? <div className="rw-tile-b">
      <div>
        <p className="rw-pr-ex">{latest.name} · 估算 1RM</p>
        <span className="rw-num rw-pr-num">{latest.value.toFixed(1)}<small>kg</small></span>
        <p className="rw-pr-meta">{fmt(latest.weight, latest.weight % 1 ? 1 : 0)} kg × {latest.reps} · {short(latest.date)}</p>
      </div>
    </div> : <div className="rw-tile-b rw-setup"><p>还没有突破</p><span>同一动作超过以前的最好成绩就记一次</span></div>}
    <div className="rw-tile-f"><span>近 7 天</span><b>{recent} 次突破</b></div>
  </div>;
}

function WeightTile({ days, ...tile }: { days: WallData['days'] } & TileProps) {
  const all = present(days.map((d) => d.weight));
  const week = days.slice(-7).map((d) => d.weight);
  const real = present(week);
  const latest = all.at(-1);
  const before = all.at(-2);
  const lo = Math.min(...real), hi = Math.max(...real), pad = (hi - lo) * 0.25 || 0.5;
  const y = (w: number) => 44 - ((w - (lo - pad)) / (hi + pad - (lo - pad))) * 38;
  const pts = week.map((w, i) => (w === null ? null : [5 + i * (137 / 6), y(w)] as const));
  const line = pts.reduce((acc, pt) => (pt ? `${acc}${acc ? 'L' : 'M'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}` : acc), '');
  const lastPt = pts.reduce<number>((acc, pt, i) => (pt ? i : acc), -1);
  const mean = real.length ? avg(real) : null;
  return <div className="rw-tile" {...tile}>
    <TileHead title="晨重" />
    {latest === undefined ? <div className="rw-tile-b rw-setup"><p>还没称重</p><span>在「记录」里说一句「体重 72.1」</span></div> : <>
      <div className="rw-tile-b">
        <div className="rw-wrow"><span className="rw-num rw-w-num">{latest.toFixed(1)}<small>kg</small></span>
          {before !== undefined && latest !== before && <span className="rw-pill mist">{latest < before ? '↓' : '↑'} {Math.abs(latest - before).toFixed(1)}</span>}</div>
        {real.length > 0 && <svg className="rw-mini" viewBox="0 0 147 50" aria-hidden="true">
          {mean !== null && <line className="avg" x1="0" x2="147" y1={y(mean)} y2={y(mean)} />}
          {real.length > 1 && <path className="ln" d={line} />}
          {pts.map((pt, i) => pt && <circle key={i} className={i === lastPt ? 'pt last' : 'pt'} cx={pt[0]} cy={pt[1]} r={i === lastPt ? 4 : 2.3} />)}
        </svg>}
      </div>
      <div className="rw-tile-f"><span>{before !== undefined ? '较上次' : '第一次称重'}</span>{mean !== null && <span>7日均 {mean.toFixed(1)}</span>}</div>
    </>}
  </div>;
}

function Rings({ rates }: { rates: number[] }) {
  const colors = ['var(--rw-carb)', 'var(--rw-ink)', 'var(--lilac)'];
  return <svg className="rw-rings" viewBox="0 0 70 70" aria-hidden="true">
    {rates.map((rate, k) => {
      const r = 31.5 - k * 8, pct = Math.round(rate * 100);
      return <g key={k}>
        <circle className="tk" cx="35" cy="35" r={r} strokeWidth="6.5" />
        <circle className="pg" cx="35" cy="35" r={r} strokeWidth="6.5" pathLength={100} transform="rotate(-90 35 35)" style={{ '--p': Math.min(pct, 100), stroke: colors[k] } as Vars} />
        {pct > 100 && <circle className="pg" cx="35" cy="35" r={r} strokeWidth="6.5" pathLength={100} transform="rotate(-90 35 35)" style={{ '--p': Math.min(pct - 100, 100), stroke: 'var(--rw-ink)' } as Vars} />}
      </g>;
    })}
  </svg>;
}

function DeficitTile({ data, fed, fedLabel, ...tile }: { data: WallData; fed: WallData['days'][number] | null; fedLabel: string } & TileProps) {
  const p = data.profile;
  const [b0, b1] = data.band;
  const lo = Math.min(0, b0 - 400), hi = b1 + 600;
  const v = fed && fed.tdee !== null && fed.kcal !== null ? fed.tdee - fed.kcal : null;
  const k = (x: number) => ((Math.max(lo, Math.min(hi, x)) - lo) / (hi - lo)) * 100;
  const pt = (x: number, rr: number) => { const a = ((150 + (240 * k(x)) / 100) * Math.PI) / 180; return [73.5 + rr * Math.cos(a), 73 + rr * Math.sin(a)]; };
  const [x0, y0] = pt(lo, 54), [x1, y1] = pt(hi, 54);
  const arc = `M${x0.toFixed(1)} ${y0.toFixed(1)} A54 54 0 1 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  const mark = (x: number) => { const [a, b] = pt(x, 50), [c, d] = pt(x, 59), [tx, ty] = pt(x, 71); return <g key={x}><line className="mark" x1={a} y1={b} x2={c} y2={d} /><text x={tx} y={ty + 3} textAnchor="middle">{x}</text></g>; };
  const inBand = v !== null && v >= b0 && v <= b1;
  return <div className="rw-tile" {...tile}>
    <TileHead title={<>热量缺口{fedLabel && fed && <small>{short(fed.date)}</small>}</>} />
    {!p ? <Setup text="在「我的」里补全资料" /> : <>
      <div className="rw-tile-b rw-gauge">
        {/* 圆弧铺满块宽，读数放得下；圆心留出刻度数字的高度，正上方的数字不被裁掉 */}
        <svg viewBox="0 0 147 106" aria-hidden="true">
          <path className="tk" d={arc} pathLength={100} />
          <path className="band" d={arc} pathLength={100} style={{ strokeDasharray: `0 ${k(b0)} ${k(b1) - k(b0)} 200` }} />
          {v !== null && <path className="val" d={arc} pathLength={100} style={{ '--v': k(v) } as Vars} />}
          {mark(b0)}{mark(b1)}
        </svg>
        <div className="center">{v === null ? <span className="rw-gauge-empty">今天还没记饮食</span> : <>
          <span className="rw-num">{fmt(v)}<small>kcal</small></span>
          {/* 今天还没过完，摄入只记到现在，不按建议区下结论 */}
          {fed?.date === data.today ? <span className="rw-pill">截至现在</span>
            : <span className={inBand ? 'rw-pill coral' : 'rw-pill'}>{inBand ? '在建议区' : v < b0 ? (p.goal === 'bulk' ? '盈余偏多' : '低于建议区') : (p.goal === 'bulk' ? '盈余不足' : '高于建议区')}</span>}
        </>}</div>
      </div>
    </>}
  </div>;
}

function EnergyTile({ week, ...tile }: { week: WallData['days'] } & TileProps) {
  const logged = present(week.map((d) => d.kcal));
  const burn = sum(week.map((d) => d.burn));
  const max = Math.max(1, ...logged) * 1.05;
  return <div className="rw-tile rw-wide" {...tile}>
    <TileHead title="能量收支" />
    <div className="rw-tile-b rw-energy">
      <div className="rw-e-reads">
        <div><span className="rw-num">{logged.length ? fmt(Math.round(avg(logged))) : '—'}<small>kcal</small></span><p>近 7 天日均摄入</p></div>
        <div><span className="rw-num coral">{fmt(burn)}<small>kcal</small></span><p>运动消耗 · 估算</p></div>
      </div>
      <div className="rw-emini" aria-hidden="true">
        {week.map((d, i) => <div key={d.date} className={i === week.length - 1 ? 'today' : undefined}>
          <div className="up"><i style={{ height: `${((d.kcal ?? 0) / max) * 100}%`, '--d': `${300 + i * 40}ms` } as Vars} /></div>
          <div className="dn">{Array.from({ length: Math.min(6, Math.round(d.burn / 60)) }, (_, j) => <b key={j} />)}</div>
          <small>{weekday(d.date).slice(1)}</small>
        </div>)}
      </div>
    </div>
  </div>;
}

/* ---------------- 抽屉 ---------------- */
function SheetLayer({ id, data, variant, origin, onClosed }: {
  id: SheetId; data: WallData; variant: SculptureVariant;
  origin: React.MutableRefObject<{ el: HTMLElement; rect: DOMRect; keyboard: boolean } | null>; onClosed: () => void;
}) {
  const [range, setRange] = useState<RangeKey>('d7');
  const [full, setFull] = useState(false);
  const [phase, setPhase] = useState<'enter' | 'open' | 'closing'>('enter');
  const sheet = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ y0: number; last: number; t: number; v: number; dy: number; h: number } | null>(null);
  const closing = useRef(false);
  const Content = SHEETS[id];

  const insetOf = useCallback(() => {
    const s = sheet.current?.getBoundingClientRect();
    const o = origin.current?.rect;
    if (!s || !o) return null;
    const r = { t: o.top - s.top, l: o.left - s.left, r: s.right - o.right, b: s.bottom - o.bottom };
    return r.t >= 0 && r.b >= 0 ? r : null;
  }, [origin]);

  // 打开：背后页面缩小，抽屉从那块卡片的轮廓长开
  useLayoutEffect(() => {
    const root = shell();
    const html = document.documentElement;
    for (const el of pageParts()) el.style.setProperty('--rw-oy', `${Math.round(70 - el.getBoundingClientRect().top)}px`);
    root?.setAttribute('data-rw-open', '');
    html.classList.add('rw-lock');
    const r = insetOf();
    if (!reduced() && sheet.current) {
      if (r) sheet.current.animate([{ clipPath: `inset(${r.t}px ${r.r}px ${r.b}px ${r.l}px round 22px)` }, { clipPath: 'inset(0px 0px 0px 0px round 30px 30px 0px 0px)' }], { duration: 640, easing: SPRING });
      else sheet.current.animate([{ translate: '0 100%' }, { translate: '0 0' }], { duration: 620, easing: SPRING });
    }
    if (origin.current?.keyboard) window.setTimeout(() => closeBtn.current?.focus({ preventScroll: true }), 300);
    const t = window.setTimeout(() => setPhase('open'), 900);
    return () => {
      window.clearTimeout(t);
      root?.removeAttribute('data-rw-open');
      root?.removeAttribute('data-rw-drag');
      root?.style.removeProperty('--rw-p');
      html.classList.remove('rw-lock');
    };
  }, [insetOf, origin]);

  const finish = useCallback((viaDrag: boolean) => {
    if (closing.current) return;
    closing.current = true;
    setPhase('closing');
    const root = shell();
    root?.removeAttribute('data-rw-open');
    root?.style.removeProperty('--rw-p');
    const el = sheet.current;
    const r = insetOf();
    if (!el || reduced()) { onClosed(); return; }
    if (!viaDrag && !full && r) {
      const a = el.animate([{ clipPath: 'inset(0px 0px 0px 0px round 30px 30px 0px 0px)' }, { clipPath: `inset(${r.t}px ${r.r}px ${r.b}px ${r.l}px round 22px)` }],
        { duration: 460, easing: 'cubic-bezier(.3,.7,.1,1)', fill: 'forwards' });
      a.onfinish = onClosed;
      return;
    }
    const from = el.style.translate || '0 0';
    el.style.translate = '';
    const a = el.animate([{ translate: from }, { translate: '0 105%' }], { duration: 380, easing: 'cubic-bezier(.3,.7,.1,1)', fill: 'forwards' });
    a.onfinish = onClosed;
  }, [full, insetOf, onClosed]);

  // 返回键：先收起抽屉
  const viaDragRef = useRef(false);
  useEffect(() => {
    const onPop = () => finish(viaDragRef.current);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [finish]);

  const close = useCallback((viaDrag = false) => {
    viaDragRef.current = viaDrag;
    if (history.state?.reviewSheet) history.back();
    else finish(viaDrag);
  }, [finish]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  function dragStart(e: PointerEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest('button') || !sheet.current) return;
    drag.current = { y0: e.clientY, last: e.clientY, t: performance.now(), v: 0, dy: 0, h: sheet.current.offsetHeight };
    shell()?.setAttribute('data-rw-drag', '');
    sheet.current.dataset.drag = '';
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function dragMove(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || !sheet.current) return;
    const now = performance.now(), raw = e.clientY - d.y0;
    d.v = (e.clientY - d.last) / Math.max(1, now - d.t); d.last = e.clientY; d.t = now;
    d.dy = raw < 0 ? raw * 0.18 : raw;
    sheet.current.style.translate = `0 ${d.dy}px`;
    shell()?.style.setProperty('--rw-p', String(Math.max(0, Math.min(1, d.dy / d.h))));
  }
  function dragEnd() {
    const d = drag.current;
    if (!d || !sheet.current) return;
    drag.current = null;
    delete sheet.current.dataset.drag;
    shell()?.removeAttribute('data-rw-drag');
    if (d.dy > 140 || d.v > 0.55) { haptic(8); close(true); return; }
    sheet.current.style.translate = '';
    shell()?.style.removeProperty('--rw-p');
  }
  const dragProps = { onPointerDown: dragStart, onPointerMove: dragMove, onPointerUp: dragEnd, onPointerCancel: dragEnd };

  return createPortal(<div className="rw-layer">
    <div className="rw-scrim" onClick={() => close()} />
    <section ref={sheet} className={`rw-sheet${full ? ' full' : ''}`} data-phase={phase} role="dialog" aria-modal="true" aria-labelledby="rw-sheet-title">
      <div className="rw-grab" {...dragProps}><i /></div>
      <header className="rw-sheet-head" {...dragProps}>
        <h2 id="rw-sheet-title">{SHEET_TITLE[id]}</h2>
        <div className="rw-sheet-btns">
          <button type="button" className="rw-icon-btn" aria-label={full ? '收回' : '展开到全屏'} onClick={() => { haptic(); setFull(!full); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={full ? 'M4 14h6v6M20 10h-6V4M10 14l-6 6M14 10l6-6' : 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7'} />
            </svg>
          </button>
          <button ref={closeBtn} type="button" className="rw-icon-btn" aria-label="关闭" onClick={() => close()}><Icon name="close" size={15} stroke={2.3} /></button>
        </div>
      </header>
      <div className="rw-sheet-body">
        <div className="rw-range rw-rise" style={{ '--i': 0 } as Vars}>
          <Seg options={RANGES} value={range} onChange={setRange} label="统计区间" />
          <span>截至 {short(data.today)}</span>
        </div>
        <Content data={data} range={range} variant={variant} />
      </div>
    </section>
  </div>, document.body);
}
