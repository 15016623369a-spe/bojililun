'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import type { RangeKey, WallData, WallDay } from '@/lib/review-wall';
import type { SculptureVariant } from '@/lib/sculpture-groups';
import { muscleLabel } from '../StatsBodyMap';
import Icon from '../ui/Icon';
import { Bars, CalloutMap, CountUp, DotCols, LineChart, Matrix, PickPlot, Rank, Xl, gapFor } from './charts';
import { RANGE_WORD, STATS_PERIOD, avg, bucketsOf, changePill, fmt, haptic, present, previousDays, short, sum, weekday } from './wall-utils';

export type SheetId = 'volume' | 'weight' | 'macro' | 'deficit' | 'metab' | 'pr' | 'body' | 'energy';
export const SHEET_TITLE: Record<SheetId, string> = {
  volume: '训练容量', weight: '晨重', macro: '三大营养完成度', deficit: '热量缺口', metab: '代谢', pr: '个人纪录', body: '训练分布', energy: '能量收支',
};

type P = { data: WallData; range: RangeKey; variant: SculptureVariant };
type Vars = CSSProperties & Record<`--${string}`, string | number>;
type Stat = [label: string, value: number | string, dec?: number, unit?: string];

const rise = (i: number) => ({ '--i': i } as Vars);
const windowDays = (all: WallDay[], range: RangeKey) => (range === 'y1' ? all : all.slice(range === 'd7' ? -7 : -30));
const prevWord = (range: RangeKey) => (range === 'd7' ? '前 7 天' : '前 30 天');
const round1 = (n: number) => Math.round(n * 10) / 10;
/** 选中格跟着区间走：换区间后回到汇总 */
function usePicked(range: RangeKey) {
  const [pick, setPick] = useState<{ range: RangeKey; i: number } | null>(null);
  return [pick?.range === range ? pick.i : null, (i: number | null) => setPick(i === null ? null : { range, i })] as const;
}

function Big({ label, value, dec = 0, unit, pill, tone = '' }: { label: string; value: number | null; dec?: number; unit: string; pill?: string | null; tone?: string }) {
  return <div className="rw-big rw-rise" style={rise(1)}>
    <p className="rw-big-label">{label}</p>
    <div className="rw-big-row">
      <span className="rw-num">{value === null ? <b>—</b> : <b><CountUp value={value} dec={dec} from0 /></b>}<small>{unit}</small></span>
      {pill && <span className={`rw-pill ${tone}`}>{pill}</span>}
    </div>
  </div>;
}

function Stats({ items }: { items: Stat[] }) {
  return <div className="rw-stats rw-rise" style={rise(3)}>
    {items.map(([label, value, dec = 0, unit]) => <div key={label}>
      <span>{label}</span>
      <span className="rw-num">{typeof value === 'number' ? <b><CountUp value={value} dec={dec} from0 /></b> : <b>{value}</b>}{unit && <small>{unit}</small>}</span>
    </div>)}
  </div>;
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rw-note rw-rise" style={rise(4)}><b>{title}</b><p>{children}</p></div>;
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="rw-hint">{children}</p>;
}

function GoLink({ href, title, sub, icon = 'stats' }: { href: string; title: string; sub: string; icon?: 'stats' | 'user' }) {
  return <Link className="rw-go rw-rise" style={rise(5)} href={href} onClick={() => haptic()}>
    <span className="rw-go-ico">{icon === 'stats' ? <span className="rw-bars4" aria-hidden="true"><i /><i /><i /><i /></span> : <Icon name="user" size={17} />}</span>
    <span className="rw-go-t"><b>{title}</b><small>{sub}</small></span>
    <Icon name="chevron-right" size={16} stroke={2} />
  </Link>;
}

const StatsLink = ({ range, view, name, sub }: { range: RangeKey; view: 'overview' | 'muscles'; name: string; sub: string }) =>
  <GoLink href={`/stats?period=${STATS_PERIOD[range]}&view=${view}`} title={`在训练统计里看 · ${name}`} sub={sub} />;

function NeedProfile({ what }: { what: string }) {
  return <>
    <div className="rw-note rw-rise" style={rise(1)}><b>还差一点资料</b><p>{what}需要「我的」里的性别、年龄、身高、体重和活动量。填好后这里会自动算出来。</p></div>
    <GoLink href="/me" title="去「我的」补全资料" sub="性别、年龄、身高、体重、活动量和训练目标" icon="user" />
  </>;
}

/* ---------------- 训练容量 ---------------- */
function VolumeSheet({ data, range }: P) {
  const b = bucketsOf(data.days, range);
  const vals = b.map((x) => sum(x.days.map((d) => d.volume)));
  const [picked, setPicked] = usePicked(range);
  const total = sum(vals);
  const days = windowDays(data.days, range);
  const trained = days.filter((d) => d.trained || d.volume > 0).length;
  const prev = previousDays(data.days, range);
  const nz = vals.filter((v) => v > 0);
  const day = picked !== null ? b[picked] : null;
  const y1 = range === 'y1';
  return <>
    <Big label={day ? day.pick : `${RANGE_WORD[range]}总容量`} value={day ? vals[picked!] : total} unit="kg" tone="lemon"
      pill={prev ? changePill(total, sum(prev.map((d) => d.volume)), prevWord(range)) ?? `练了 ${trained} 天` : `练了 ${trained} 天`} />
    <div className="rw-blocks rw-rise" style={rise(2)}>
      <div>
        <Bars values={vals} labels={b.map((x) => x.label)} picked={picked} onPick={setPicked} def={vals.length - 1} tone={() => 'ok'} selColor="var(--rw-stripe-lemon)" label="每天的训练容量" />
        <Hint>{y1 ? '按住柱子左右拖，看每个月' : '按住柱子左右拖，看每一天'}</Hint>
        {day?.date && <Link className="rw-dayline" href={day.date === data.today ? '/log' : `/log?date=${day.date}`}>看 {short(day.date)} 的记录<Icon name="chevron-right" size={14} stroke={2} /></Link>}
      </div>
      {data.topExercises[range].length > 0 && <Rank title="容量最高的动作" unit="kg" color="rgb(var(--rw-rgb) / .72)"
        rows={data.topExercises[range].map((e) => ({ key: e.name, label: e.name, value: e.volume }))} />}
    </div>
    <Stats items={nz.length ? (y1
      ? [['月最低', Math.min(...vals), 0, 'kg'], ['月平均', Math.round(avg(vals)), 0, 'kg'], ['月最高', Math.max(...vals), 0, 'kg']]
      : [['训练日最低', Math.min(...nz), 0, 'kg'], ['训练日平均', Math.round(avg(nz)), 0, 'kg'], ['最高', Math.max(...nz), 0, 'kg']])
      : [['训练日最低', '—'], ['训练日平均', '—'], ['最高', '—']]} />
    <Note title={`练了 ${trained} 天`}>容量 = 每组重量 × 次数，只算实练组。自重动作不计容量，但计入训练天数。</Note>
    <StatsLink range={range} view="overview" name="总览" sub="容量和运动时间，按周、月、季、年对比" />
  </>;
}

/* ---------------- 晨重 ---------------- */
function WeightSheet({ data, range }: P) {
  const b = bucketsOf(data.days, range);
  const vals = b.map((x) => { const w = present(x.days.map((d) => d.weight)); return w.length ? round1(avg(w)) : null; });
  const [picked, setPicked] = usePicked(range);
  const real = present(vals);
  if (!real.length) return <>
    <Big label={`${RANGE_WORD[range]}晨重`} value={null} unit="kg" />
    <Note title="还没有称重">在「记录」里说一句「体重 72.1」或者手动记一笔，就会出现在这里。</Note>
  </>;
  const all = data.days;
  const avgLine = range === 'y1' ? undefined : b.map((x) => {
    const at = all.findIndex((d) => d.date === x.date);
    const w = present(all.slice(Math.max(0, at - 6), at + 1).map((d) => d.weight));
    return w.length ? avg(w) : null;
  });
  const last = vals.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);
  const first = vals.findIndex((v) => v !== null);
  const diff = round1(vals[last]! - vals[first]!);
  const shown = picked !== null && vals[picked] !== null ? picked : last;
  const label = picked !== null
    ? (vals[picked] === null ? `${b[picked].pick} · 没有称重` : b[picked].pick)
    : range === 'y1' ? `${b[last].pick}平均晨重` : b[last].date === data.today ? '今天 · 晨重' : `${short(b[last].date!)} · 最近一次晨重`;
  return <>
    <Big label={label} value={vals[shown]} dec={1} unit="kg" tone="mist" pill={last !== first ? `区间 ${diff <= 0 ? '↓' : '↑'} ${Math.abs(diff).toFixed(1)} kg` : null} />
    <div className="rw-blocks rw-rise" style={rise(2)}>
      <div>
        <LineChart values={vals} avgLine={avgLine} labels={b.map((x) => x.label)} picked={picked} onPick={setPicked} def={last} label="晨重曲线" />
        <Hint>按住曲线左右拖，看{range === 'y1' ? '每个月' : '每一天'}</Hint>
      </div>
    </div>
    <Stats items={[['最低', Math.min(...real), 1, 'kg'], ['平均', round1(avg(real)), 1, 'kg'], ['最高', Math.max(...real), 1, 'kg']]} />
    <Note title="看均线，不看单日">{range === 'y1' ? '每个月取当月称重的平均值。' : '晨重取每天第一次称重。虚线是 7 日均线，饮水和盐分带来的单日起伏会被抹平。'}</Note>
  </>;
}

/* ---------------- 三大营养完成度 ---------------- */
const MACROS = [
  { key: 'protein', name: '蛋白', color: 'var(--rw-ink)' },
  { key: 'carbs', name: '碳水', color: 'var(--rw-carb)' },
  { key: 'fat', name: '脂肪', color: 'var(--lilac)' },
] as const;

function MacroSheet({ data, range }: P) {
  const p = data.profile;
  const [picked, setPicked] = usePicked(range);
  if (!p) return <NeedProfile what="三大营养的目标" />;
  const target = { protein: p.protein, carbs: p.carbs, fat: p.fat };
  const b = bucketsOf(data.days, range);
  const logged = (x: { days: WallDay[] }) => x.days.filter((d) => d.kcal !== null);
  const rate = (days: WallDay[], key: 'protein' | 'carbs' | 'fat') => (days.length ? avg(days.map((d) => (d[key] ?? 0) / target[key])) : null);
  const series = MACROS.map((m) => b.map((x) => rate(logged(x), m.key)));
  const kcal = b.map((x) => { const l = logged(x); return l.length ? avg(l.map((d) => d.kcal! / p.targetKcal)) : null; });
  const win = windowDays(data.days, range).filter((d) => d.kcal !== null);
  const unitN = range === 'y1' ? '个月' : '天';
  if (!win.length) return <>
    <Big label="日均热量完成度" value={null} unit="%" />
    <Note title="这段时间还没记饮食">拍照或说一句吃了什么，记下的每一餐会按「我的」里的目标算完成度。</Note>
  </>;
  const overall = MACROS.map((m) => rate(win, m.key)!);
  const at = picked !== null && kcal[picked] !== null ? picked : null;
  const shown = at === null ? overall : series.map((s) => s[at]!);
  const okN = (s: (number | null)[]) => s.filter((v) => v !== null && v >= 0.9 && v <= 1.1).length;
  const overN = series.map((s) => s.filter((v) => v !== null && v > 1.1).length);
  const underN = series.map((s) => s.filter((v) => v !== null && v < 0.9).length);
  const worstOver = overN.indexOf(Math.max(...overN));
  const worstUnder = underN.indexOf(Math.max(...underN));
  const pill = overN[worstOver] ? `${MACROS[worstOver].name} ${overN[worstOver]} ${unitN}超出` : underN[worstUnder] ? `${MACROS[worstUnder].name} ${underN[worstUnder]} ${unitN}不足` : '都在达标区';
  const label = picked === null ? (range === 'y1' ? '月均热量完成度' : '日均热量完成度') : kcal[picked] === null ? `${b[picked].pick} · 没记饮食` : `${b[picked].pick} 热量完成度`;
  return <>
    <Big label={label} value={Math.round((at === null ? avg(present(kcal)) : kcal[at]!) * 100)} unit="%" pill={pill} tone="coral" />
    <div className="rw-blocks rw-rise" style={rise(2)}>
      <div className="rw-progs">
        {MACROS.map((m, k) => {
          const pct = shown[k];
          return <div key={m.key} className="rw-prog" style={{ '--c': m.color } as Vars}>
            <div className="rw-prog-top"><b>{m.name}</b><span><em><CountUp value={Math.round(pct * target[m.key])} ms={320} /></em> / {target[m.key]} g</span>
              <strong className={pct > 1.1 ? 'over' : undefined}>{Math.round(pct * 100)}%</strong></div>
            <div className="rw-track"><i style={{ width: `${(Math.min(pct, 1.25) / 1.25) * 100}%` }} /><u /></div>
          </div>;
        })}
      </div>
      <div>
        <Matrix rows={MACROS.map((m, k) => ({ name: m.name, color: m.color, vals: series[k] }))} labels={b.map((x) => (range === 'd7' ? x.label.replace('周', '') : x.label))} picked={picked} onPick={setPicked} />
        <Hint>点或拖某一列，上面的完成度换成那一{range === 'y1' ? '月' : '天'}</Hint>
      </div>
    </div>
    <Stats items={MACROS.map((m, k) => [`${m.name}达标`, okN(series[k]), 0, unitN] as Stat)} />
    <Note title="目标从哪来">「我的」里的{p.goalLabel}目标：{fmt(p.targetKcal)} kcal，蛋白 {p.protein} g，脂肪约占 27%（{p.fat} g），其余给碳水（{p.carbs} g）。完成度 90%–110% 记为达标，超过 110% 记为超出；没记饮食的日子不计入。</Note>
  </>;
}

/* ---------------- 热量缺口 ---------------- */
function bandText(data: WallData) {
  const [lo, hi] = data.band;
  return data.profile?.goal === 'bulk' ? `盈余 ${-hi}–${-lo}` : data.profile?.goal === 'maintain' ? `±${hi}` : `${lo}–${hi}`;
}

function DeficitSheet({ data, range }: P) {
  const p = data.profile;
  const [picked, setPicked] = usePicked(range);
  if (!p) return <NeedProfile what="热量缺口" />;
  const b = bucketsOf(data.days, range);
  const ok = (x: { days: WallDay[] }) => x.days.filter((d) => d.kcal !== null && d.tdee !== null);
  const vals = b.map((x) => { const l = ok(x); return l.length ? Math.round(avg(l.map((d) => d.tdee! - d.kcal!))) : null; });
  const real = present(vals);
  const [lo, hi] = data.band;
  const tag = (v: number) => (v < lo ? (p.goal === 'bulk' ? '盈余偏多' : '低于建议区') : v > hi ? (p.goal === 'bulk' ? '盈余不足' : '高于建议区') : `在建议区 ${bandText(data)}`);
  if (!real.length) return <>
    <Big label="热量缺口" value={null} unit="kcal" />
    <Note title="这段时间还没记饮食">热量缺口 = 每日总代谢 − 当天摄入。记下吃了什么后这里会按天算出来。</Note>
  </>;
  const last = vals.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);
  const at = picked !== null && vals[picked] !== null ? picked : last;
  const x = ok(b[at]);
  const tdee = Math.round(avg(x.map((d) => d.tdee!))), base = Math.round(avg(x.map((d) => d.bmr!))), intake = Math.round(avg(x.map((d) => d.kcal!)));
  const totalW = Math.max(tdee, intake);
  const gap = tdee - intake;
  const label = picked !== null
    ? (vals[picked] === null ? `${b[picked].pick} · 没记饮食` : b[picked].pick)
    : range === 'y1' ? `${b[last].pick}日均` : b[last].date === data.today ? `今天 · ${short(data.today)} ${weekday(data.today)}` : `${short(b[last].date!)} · 今天还没记饮食`;
  const inBand = real.filter((v) => v >= lo && v <= hi).length;
  return <>
    <Big label={label} value={vals[at]} unit="kcal" tone="coral"
      pill={range !== 'y1' && b[at].date === data.today ? '今天截至现在' : tag(vals[at]!)} />
    <div className="rw-blocks rw-rise" style={rise(2)}>
      <div className="rw-cmp">
        <span className="rw-cmp-l">消耗</span>
        <div className="rw-cmp-bar">
          <i className="c-base" style={{ flexBasis: `${(base / totalW) * 100}%` }}><span>基础 {fmt(base)}</span></i>
          <i className="c-act" style={{ flexBasis: `${((tdee - base) / totalW) * 100}%` }}><span>活动 {fmt(tdee - base)}</span></i>
        </div>
        <span className="rw-cmp-l">摄入</span>
        <div className="rw-cmp-bar">
          <i className="c-in" style={{ flexBasis: `${(intake / totalW) * 100}%` }}><span>摄入 {fmt(intake)}</span></i>
          {gap > 0 && <i className="c-gap" style={{ flexBasis: `${(gap / totalW) * 100}%` }}><span>缺口 {fmt(gap)}</span></i>}
        </div>
        {gap < 0 && <p className="rw-cmp-note">摄入比每日总代谢多 {fmt(-gap)} kcal，是热量盈余。</p>}
      </div>
      <div>
        <Bars values={vals} labels={b.map((y) => y.label)} picked={picked} onPick={setPicked} def={last}
          band={[lo, hi, '建议区']} tone={(v) => (v >= lo && v <= hi ? 'ok' : '')} selColor="var(--coral)" label="每天的热量缺口" />
        <Hint>拖到某一{range === 'y1' ? '月' : '天'}，上面的消耗和摄入一起换</Hint>
      </div>
    </div>
    <Stats items={[['最低', Math.min(...real), 0, 'kcal'], ['平均', Math.round(avg(real)), 0, 'kcal'], ['最高', Math.max(...real), 0, 'kcal']]} />
    <Note title={`${inBand} ${range === 'y1' ? '个月' : '天'}在建议区`}>热量缺口 = 每日总代谢 − 当天摄入；每日总代谢 = 基础代谢 × 活动系数，见「代谢」。建议区随「我的」里的训练目标变化：减脂每天 400–1000 kcal，维持 ±200，增肌盈余 150–400。没记饮食的日子不计入。</Note>
  </>;
}

/* ---------------- 代谢 ---------------- */
function MetabSheet({ data, range }: P) {
  const p = data.profile;
  const [picked, setPicked] = usePicked(range);
  if (!p) return <NeedProfile what="基础代谢和每日总代谢" />;
  const b = bucketsOf(data.days, range);
  const tdee = b.map((x) => { const v = present(x.days.map((d) => d.tdee)); return v.length ? Math.round(avg(v)) : null; });
  const bmr = b.map((x) => { const v = present(x.days.map((d) => d.bmr)); return v.length ? Math.round(avg(v)) : null; });
  const last = tdee.length - 1;
  const at = picked ?? last;
  const today = data.days.at(-1)!;
  const w = today.bmrWeight ?? p.weight;
  const real = present(tdee);
  const s = p.sex === 'male' ? '+ 5' : '− 161';
  return <>
    <Big label={picked === null ? '今天 · 每日总代谢' : `${b[at].pick} · 每日总代谢`} value={tdee[at]} unit="kcal" pill={bmr[at] ? `基础代谢 ${fmt(bmr[at]!)}` : null} tone="mist" />
    <div className="rw-blocks rw-rise" style={rise(2)}>
      <div className="rw-cmp one">
        <span className="rw-cmp-l">构成</span>
        <div className="rw-cmp-bar">
          <i className="c-base" style={{ flexBasis: `${((bmr[at] ?? 0) / (tdee[at] || 1)) * 100}%` }}><span>基础代谢 {fmt(bmr[at] ?? 0)}</span></i>
          <i className="c-act" style={{ flexBasis: `${(((tdee[at] ?? 0) - (bmr[at] ?? 0)) / (tdee[at] || 1)) * 100}%` }}><span>活动 {fmt((tdee[at] ?? 0) - (bmr[at] ?? 0))}</span></i>
        </div>
      </div>
      <div className="rw-formula">
        <p><span>基础代谢</span><b>{fmt(today.bmr ?? 0)}<small>kcal</small></b></p>
        <code>10 × {fmt(w, 1)} kg + 6.25 × {p.height} cm − 5 × {p.age} 岁 {s}</code>
        <p><span>每日总代谢</span><b>{fmt(today.tdee ?? 0)}<small>kcal</small></b></p>
        <code>{fmt(today.bmr ?? 0)} × {p.factor}（{p.activityLabel} · {p.activityDesc}）</code>
      </div>
      {real.length > 1 && <div>
        <LineChart values={tdee} labels={b.map((x) => x.label)} picked={picked} onPick={setPicked} def={last} color="var(--rw-heat)" label="每日总代谢的变化" />
        <Hint>体重变了，基础代谢和总代谢跟着变</Hint>
      </div>}
    </div>
    <Stats items={[['基础代谢', bmr[at] ?? 0, 0, 'kcal'], ['活动系数', `× ${p.factor}`], ['每日总代谢', tdee[at] ?? 0, 0, 'kcal']]} />
    <Note title="怎么算">基础代谢用 Mifflin-St Jeor 公式，体重取当天或之前最近一次称重，没有称重时用「我的」里的体重。每日总代谢 = 基础代谢 × 活动系数，和「我的」算目标热量是同一个数；热量缺口 = 每日总代谢 − 摄入。训练已经算在活动系数里，「能量收支」里的运动消耗只作参考，不再叠加。</Note>
    <GoLink href="/me" title="在「我的」里改体重和活动量" sub={`现在是${p.activityLabel}（${p.activityDesc}）· ${p.goalLabel}`} icon="user" />
  </>;
}

/* ---------------- 个人纪录 ---------------- */
function PrRow({ data, id, name, meta, value, gain }: { data: WallData; id: string; name: string; meta: string; value: number; gain: number }) {
  const [open, setOpen] = useState(false);
  const h = data.prHistory[id];
  return <div className={open ? 'rw-pr-item open' : 'rw-pr-item'}>
    <button type="button" className="rw-pr-row" aria-expanded={open} onClick={() => { haptic(); setOpen(!open); }}>
      <span className="rw-pr-badge">PR</span>
      <span className="rw-pr-name">{name}<small>{meta}</small></span>
      <span className="rw-pr-val">{value.toFixed(1)}<small>kg</small><em>+{gain.toFixed(1)} kg<Icon name="chevron-right" size={12} stroke={2.4} /></em></span>
    </button>
    <div className="rw-pr-more"><div>
      {open && h && <div className="rw-pr-inner">
        <LineChart values={h.points.map((x) => x.value)} marks={h.points.flatMap((x, i) => (x.pr ? [i] : []))} W={310} H={76} pick={false} color="var(--rw-ink)" label={`${name}最近每节训练的估算 1RM`} />
        <Hint>最近 {h.points.length} 节的估算 1RM · 紫色点是突破</Hint>
      </div>}
    </div></div>
  </div>;
}

function PrSheet({ data, range }: P) {
  const b = bucketsOf(data.days, range);
  const [picked, setPicked] = usePicked(range);
  const days = windowDays(data.days, range);
  const from = days[0].date;
  const events = data.prs.filter((e) => e.date >= from);
  const counts = b.map((x) => events.filter((e) => (x.date ? e.date === x.date : e.date.startsWith(x.key))).length);
  const prev = previousDays(data.days, range);
  const prevN = prev ? data.prs.filter((e) => e.date >= prev[0].date && e.date <= prev.at(-1)!.date).length : 0;
  const groups = new Map<string, { id: string; name: string; latest: typeof events[number]; count: number; base: number }>();
  for (const e of events) {
    const g = groups.get(e.id);
    if (!g) groups.set(e.id, { id: e.id, name: e.name, latest: e, count: 1, base: e.prev });
    else { g.latest = e; g.count += 1; }
  }
  const rows = [...groups.values()].map((g) => ({ ...g, gain: g.latest.value - g.base }))
    .sort((a, c) => (range === 'y1' ? c.gain - a.gain : c.latest.date.localeCompare(a.latest.date)));
  const diff = events.length - prevN;
  const pill = prev ? (diff > 0 ? `较${prevWord(range)} +${diff}` : diff < 0 ? `较${prevWord(range)} ${diff}` : `与${prevWord(range)}持平`) : `涉及 ${rows.length} 个动作`;
  return <>
    <Big label={picked !== null ? b[picked].pick : RANGE_WORD[range]} value={picked !== null ? counts[picked] : events.length} unit="次突破" pill={pill} tone="lilac" />
    <div className="rw-blocks rw-rise" style={rise(2)}>
      <DotCols counts={counts} labels={b.map((x) => x.label)} picked={picked} onPick={setPicked} label="每天的突破次数" />
      {rows.length ? <div className="rw-pr-list">
        <h3>{range === 'y1' ? '涨幅最大的动作' : '这段时间的突破'}</h3>
        {rows.map((g) => <PrRow key={g.id} data={data} id={g.id} name={g.name} value={g.latest.value} gain={g.gain}
          meta={g.count > 1 ? `${g.count} 次突破 · 最近 ${short(g.latest.date)}` : `${fmt(g.latest.weight, g.latest.weight % 1 ? 1 : 0)} kg × ${g.latest.reps} · ${short(g.latest.date)}`} />)}
      </div> : <p className="rw-empty">这段时间还没有突破。同一个动作的估算 1RM 超过之前的最好成绩，就会记一次。</p>}
    </div>
    <Stats items={[['最近一次', events.length ? short(events.at(-1)!.date) : '—'], ['最大涨幅', rows.length ? round1(Math.max(...rows.map((r) => r.gain))) : 0, 1, 'kg'], ['涉及动作', rows.length, 0, '个']]} />
    <Note title="怎么算一次突破">对 1–15 次的负重组估算 1RM：单次直接取实举重量，其余用 重量 × (1 + 次数 / 30)。一节训练里的最好成绩超过这个动作此前所有训练的最高值，就记一次；第一次练的动作只记下基线。与统计页「动作表现」同一口径。</Note>
    <StatsLink range={range} view="muscles" name="动作表现" sub="PR、8–12 RM、12–15 RM 三档数值和曲线" />
  </>;
}

/* ---------------- 训练分布 ---------------- */
function BodySheet({ data, range, variant }: P) {
  const muscles = data.muscles[range];
  const [sel, setSel] = useState<{ range: RangeKey; id: string } | null>(null);
  const selected = sel?.range === range ? sel.id : null;
  const pick = (id: string) => setSel(selected === id ? null : { range, id });
  const total = sum(muscles.map((m) => m.sets));
  const row = muscles.find((m) => m.id === selected);
  return <>
    {row ? <Big label={`${muscleLabel(row.id)} · ${RANGE_WORD[range]}`} value={row.sets} unit="组" pill={`占 ${Math.round((row.sets / total) * 100)}%`} tone="coral" />
      : <Big label={`${RANGE_WORD[range]}练到`} value={muscles.length} unit="个肌群" pill={muscles[0] ? `${muscleLabel(muscles[0].id)}最多` : null} tone="mist" />}
    <div className="rw-blocks rw-rise" style={rise(2)}>
      <CalloutMap muscles={muscles} variant={variant} selected={selected} onSelect={pick} />
      {muscles.length ? <Rank title="各肌群组数" unit="组" color="var(--rw-heat)" selected={selected} onSelect={pick}
        rows={muscles.map((m) => ({ key: m.id, label: muscleLabel(m.id), value: m.sets }))} />
        : <p className="rw-empty">这段时间还没有记到具体肌群的训练。</p>}
    </div>
    {muscles.length > 0 && <Stats items={[['最多', muscleLabel(muscles[0].id)], ['平均', round1(total / muscles.length), 1, '组'], ['总组数', total, 0, '组']]} />}
    <Note title="和统计页同一张图">标注沿用统计页「肌群与动作」：正面标注收在左侧、背面收在右侧，点越大组数越多。点标注或下面的列表看单个肌群；每组只归入一个主要肌群，口径也和统计页一致。</Note>
    <StatsLink range={range} view="muscles" name="肌群与动作" sub="每个肌群的容量、对比和动作表现" />
  </>;
}

/* ---------------- 能量收支 ---------------- */
const E_COLORS = ['var(--rw-ink)', 'var(--rw-carb)', 'var(--lilac)'];
function EnergySheet({ data, range }: P) {
  const b = bucketsOf(data.days, range);
  const [picked, setPicked] = usePicked(range);
  const intake = b.map((x) => { const l = x.days.filter((d) => d.kcal !== null); return l.length ? Math.round(avg(l.map((d) => d.kcal!))) : null; });
  const parts = b.map((x) => { const l = x.days.filter((d) => d.kcal !== null); return l.length ? [avg(l.map((d) => (d.protein ?? 0) * 4)), avg(l.map((d) => (d.carbs ?? 0) * 4)), avg(l.map((d) => (d.fat ?? 0) * 9))] : [0, 0, 0]; });
  const burn = b.map((x) => Math.round(avg(x.days.map((d) => d.burn))));
  const days = windowDays(data.days, range);
  const logged = present(days.map((d) => d.kcal));
  const burnTotal = sum(days.map((d) => d.burn));
  const n = b.length;
  const max = Math.max(1, ...present(intake)) * 1.08;
  const sel = picked ?? n - 1;
  const avgIn = logged.length ? Math.round(avg(logged)) : null;
  return <>
    <Big label={picked === null ? `${RANGE_WORD[range]}日均摄入` : intake[picked] === null ? `${b[picked].pick} · 没记饮食` : `${b[picked].pick} 摄入`}
      value={picked === null ? avgIn : intake[picked]} unit="kcal" tone="coral"
      pill={picked === null ? `运动消耗约 ${fmt(burnTotal)}` : burn[picked] ? `运动消耗约 ${fmt(burn[picked])}` : '没有训练'} />
    <div className="rw-blocks rw-rise" style={rise(2)}>
      <div className="rw-ekey"><span><i style={{ background: E_COLORS[0] }} />蛋白</span><span><i style={{ background: E_COLORS[1] }} />碳水</span><span><i style={{ background: E_COLORS[2] }} />脂肪</span><span><i className="dot" />运动消耗 · 每点约 60 kcal</span></div>
      <div>
        <div className="rw-chart" style={{ '--n': n, '--gap': `${gapFor(n)}px` } as Vars}>
          <PickPlot n={n} picked={picked} onPick={setPicked} className="rw-plot rw-eplot" label="每天摄入与运动消耗">
            {b.map((x, i) => {
              const k = intake[i] ?? 0;
              const ps = parts[i];
              const split = sum(ps) > 0;
              return <div key={x.key} className={i === sel ? 'rw-ecol sel' : 'rw-ecol'}>
                <div className="up"><div className="rw-ebar" data-plain={!split || undefined} style={{ height: `${(k / max) * 100}%`, '--d': `${Math.round(i * Math.min(42, 320 / n))}ms` } as Vars}>
                  {split && ps.map((v, j) => <i key={j} style={{ flexGrow: v, background: E_COLORS[j] }} />)}
                </div></div>
                <div className="burn">{Array.from({ length: Math.min(10, Math.round(burn[i] / 60)) }, (_, j) => <b key={j} style={{ '--k': j } as Vars} />)}</div>
              </div>;
            })}
          </PickPlot>
          <Xl labels={b.map((x) => x.label)} sel={sel} />
        </div>
        <Hint>按住左右拖，看{range === 'y1' ? '每个月的日均' : '每一天'}</Hint>
      </div>
    </div>
    <Stats items={[['日均摄入', avgIn ?? '—', 0, avgIn === null ? undefined : 'kcal'], ['运动合计', burnTotal, 0, 'kcal'], ['日均净摄入', avgIn === null ? '—' : Math.round(avgIn - burnTotal / days.length), 0, avgIn === null ? undefined : 'kcal']]} />
    <Note title="怎么看">上方按蛋白、碳水、脂肪折成千卡堆叠；基线以下每个珊瑚点约 60 kcal 运动消耗，按 MET 粗估。运动消耗只作参考，不计入每日总代谢：活动系数里已经包含了训练。</Note>
  </>;
}

export const SHEETS: Record<SheetId, (p: P) => ReactNode> = {
  volume: VolumeSheet, weight: WeightSheet, macro: MacroSheet, deficit: DeficitSheet, metab: MetabSheet, pr: PrSheet, body: BodySheet, energy: EnergySheet,
};
