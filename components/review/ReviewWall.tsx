'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { WallData, WallHero, RangeKey } from '@/lib/review-wall';
import { readOfflineSnapshot } from '@/lib/offline-store';
import type { SculptureVariant } from '@/lib/sculpture-groups';
import { muscleLabel } from '../StatsBodyMap';
import Icon from '../ui/Icon';
import GlassSheet from '../ui/GlassSheet';
import { CountUp, MiniBodies, PickPlot, Seg, Xl } from './charts';
import { SHEETS, SHEET_TITLE, type SheetId } from './sheets';
import { RANGES, avg, fmt, haptic, present, short, sum, weekday } from './wall-utils';

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/**
 * 回顾页的数据块墙：容量主块 + 一组同结构的小数据块。点一块，它在原位长成毛玻璃抽屉，
 * 背后的页面缩到 0.93，不压暗、不虚化；下拉、点背后、返回键或 Esc 收起。
 * 交互原型见 docs/design/2026-11-23/review-tiles-prototype.html。
 */
export default function ReviewWall({ hero: initialHero, data, variant }: { hero: WallHero; data: WallData; variant: SculptureVariant }) {
  const [hero, setHero] = useState(initialHero);
  const [open, setOpen] = useState<SheetId | null>(null);
  const [lifted, setLifted] = useState<SheetId | null>(null);
  const origin = useRef<{ el: HTMLElement; rect: DOMRect; keyboard: boolean } | null>(null);
  const router = useRouter();

  useEffect(() => { setHero(initialHero); }, [initialHero]);

  // 离线期间新记的组（负数本地 ID）实时叠加到回顾页容量与组数读数里
  useEffect(() => {
    let cancelled = false;
    void readOfflineSnapshot().then((snap) => {
      if (cancelled || !snap) return;
      const offlineSets = snap.recentSets.filter((s) => s.id < 0);
      if (offlineSets.length === 0) return;
      const extraVol = offlineSets.reduce((sum, s) => sum + (s.weight > 0 ? s.weight * s.reps : 0), 0);
      const bars = initialHero.bars.map((b, idx) => (idx === initialHero.sel ? { ...b, value: b.value + extraVol } : b));
      const reads = initialHero.reads.map((r) => (r.label === '总组数' || r.unit === '组' ? { ...r, value: r.value + offlineSets.length } : r));
      setHero({
        ...initialHero,
        total: initialHero.total + extraVol,
        bars,
        reads,
      });
    });
    return () => { cancelled = true; };
  }, [initialHero]);

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
    {/* 饮食放在「身体与饮食」里（11 月 25 日用户要求）：排在今天的四块后面、和同样看一段时间的「能量收支」挨着，
        自己跟着上面的日／周／月走，标题旁写「本周日均 / 本月日均」 */}
    <FoodTile data={data} period={hero.period} {...tile('food')} />
    <EnergyTile week={week} {...tile('energy')} />

    {open && <SheetLayer id={open} data={data} variant={variant} origin={origin} period={hero.period}
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

/** 本周一（周视图从这天算起） */
function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * 饮食（中号长方形），和容量主块一样跟着日／周／月走（11 月 25 日用户确认）：
 * 日看今天的摄入、蛋白质对着目标；周、月看记了饮食的日子的日均，另写记了几天。没记饮食的日子不算进日均。
 */
function FoodTile({ data, period, ...tile }: { data: WallData; period: WallHero['period'] } & TileProps) {
  const p = data.profile;
  const today = data.days.at(-1)!;
  const from = period === 'day' ? today.date : period === 'week' ? mondayOf(today.date) : `${today.date.slice(0, 7)}-01`;
  const span = data.days.filter((d) => d.date >= from);
  const logged = span.filter((d) => d.kcal !== null);
  const word = period === 'day' ? '今天' : period === 'week' ? '本周' : '本月';
  const kcal = logged.length ? avg(logged.map((d) => d.kcal!)) : 0;
  const protein = logged.length ? avg(logged.map((d) => d.protein ?? 0)) : 0;
  const burn = span.length ? sum(span.map((d) => d.burn)) / (period === 'day' ? 1 : span.length) : 0;
  const meter = (label: string, value: number, target: number | null, unit: string) => (
    <div className="rw-food-row">
      <span>{label}</span>
      <i className="rw-ticks" aria-hidden="true"><b style={{ width: `${target ? Math.min(1, value / target) * 100 : 0}%` }} /></i>
      <span className="rw-food-v"><b>{fmt(Math.round(value))}</b>{target ? <em>/ {fmt(target)}</em> : null} {unit}</span>
    </div>
  );
  return <div className="rw-tile rw-wide" {...tile}>
    <TileHead title={period === 'day' ? '今日饮食' : <>饮食<small>{word}日均</small></>} />
    {!logged.length ? <div className="rw-tile-b rw-setup"><p>{word}还没记饮食</p><span>在「记录」里说一句吃了什么，或拍张照</span></div> : <>
      <div className="rw-tile-b rw-food">
        {meter('摄入', kcal, p?.targetKcal ?? null, 'kcal')}
        {meter('蛋白质', protein, p?.protein ?? null, 'g')}
      </div>
      <div className="rw-tile-f">
        <span>{burn > 0 ? <>运动消耗{period === 'day' ? '' : '日均'} ≈{fmt(Math.round(burn))} kcal</> : `${word}还没有训练消耗`}</span>
        <span>{period === 'day' ? `${data.mealsByDay[today.date]?.length ?? 0} 餐` : `记了 ${logged.length} 天`}{p ? '' : ' · 去「我的」设目标'}</span>
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
function SheetLayer({ id, data, variant, origin, period, onClosed }: {
  id: SheetId; data: WallData; variant: SculptureVariant; period: WallHero['period'];
  origin: React.MutableRefObject<{ el: HTMLElement; rect: DOMRect; keyboard: boolean } | null>; onClosed: () => void;
}) {
  // 「饮食」抽屉跟着打开时的日／周／月：月视图默认看 30 天，其余 7 天
  const [range, setRange] = useState<RangeKey>(id === 'food' && period === 'month' ? 'd30' : 'd7');
  const Content = SHEETS[id];
  // 抽屉的开合、拖动、返回键和全屏都在 GlassSheet 里，记录页的卡片明细也用它
  return <GlassSheet title={SHEET_TITLE[id]} origin={origin} onClosed={onClosed} historyKey="reviewSheet">
    <div className="rw-range rw-rise" style={{ '--i': 0 } as Vars}>
      <Seg options={RANGES} value={range} onChange={setRange} label="统计区间" />
      <span>截至 {short(data.today)}</span>
    </div>
    <Content data={data} range={range} variant={variant} period={period} />
  </GlassSheet>;
}
