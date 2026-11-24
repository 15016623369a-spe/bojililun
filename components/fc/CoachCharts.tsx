'use client';

import { useState, type CSSProperties } from 'react';
import { Bars, LineChart, Seg } from '@/components/review/charts';
import { fmt } from '@/components/review/wall-utils';
import type { CoachChart, CoachProgressChart, CoachSeriesChart, CoachTone } from '@/lib/coach-types';

/**
 * 教练回复下面的图表。数据由服务端随回复给出（lib/coach-data.ts），图沿用回顾抽屉的折线、柱状图和完成度条，
 * 颜色变量在 v-coach-preview.css 的 .coach-chart 里按教练的深色面板重新取值。
 */

type Vars = CSSProperties & Record<`--${string}`, string>;
const TONE: Record<CoachTone, string> = { lemon: 'var(--lemon)', mist: 'var(--mist)', coral: 'var(--coral)', lilac: 'var(--lilac)' };
/** 和回顾「三大营养完成度」同一组颜色 */
const MACRO: Record<string, string> = { protein: 'var(--rw-ink)', carbs: 'var(--rw-carb)', fat: 'var(--lilac)' };

function SeriesChart({ chart }: { chart: CoachSeriesChart }) {
  const [key, setKey] = useState(chart.focus ?? chart.series[0].key);
  const [picked, setPicked] = useState<number | null>(null);
  const series = chart.series.find((s) => s.key === key) ?? chart.series[0];
  const last = series.values.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);
  const def = chart.index ?? last;
  const at = picked ?? def;
  const value = at >= 0 ? series.values[at] : null;
  const color = TONE[chart.tone];
  const band = chart.band;
  const label = `${chart.title} · ${series.name}`;
  return <figure className="coach-chart" data-tone={chart.tone} style={{ '--coach-tone': color } as Vars}>
    <figcaption className="coach-chart-head"><b>{chart.title}</b></figcaption>
    {chart.series.length > 1 && <Seg options={chart.series.map((s) => ({ key: s.key, label: s.name }))} value={series.key}
      onChange={(k) => { setKey(k); setPicked(null); }} label="切换图上的数据" />}
    <div className="coach-chart-read">
      <span className="coach-chart-num">{value === null ? '—' : fmt(value, series.dec)}<small>{series.unit}</small></span>
      <span className="coach-chart-pick">{at >= 0 ? chart.picks[at] : ''}{at >= 0 && value === null ? ' · 没有数据' : ''}</span>
    </div>
    {last < 0 ? <p className="coach-chart-note">这段时间还没有{series.name}的记录。</p>
      : chart.kind === 'line'
        ? <LineChart key={series.key} values={series.values} labels={chart.labels} picked={picked} onPick={setPicked} def={def} color={color} H={136} label={label} />
        : <Bars key={series.key} values={series.values} labels={chart.labels} picked={picked} onPick={setPicked} def={def} selColor={color} height={118} label={label}
          band={band ? [band.from, band.to, band.label] : undefined}
          tone={band ? (v) => (v >= band.from && v <= band.to ? 'ok' : '') : undefined} />}
    {chart.note && <p className="coach-chart-note">{chart.note}</p>}
  </figure>;
}

function ProgressChart({ chart }: { chart: CoachProgressChart }) {
  return <figure className="coach-chart" data-tone={chart.tone} style={{ '--coach-tone': TONE[chart.tone] } as Vars}>
    <figcaption className="coach-chart-head"><b>{chart.title}</b><span>左边是每天的目标，右边是{chart.valueLabel}</span></figcaption>
    <div className="rw-progs">
      {chart.rows.map((r) => {
        const pct = r.value === null ? null : r.value / r.target;
        return <div key={r.key} className="rw-prog" style={{ '--c': MACRO[r.key] ?? TONE[chart.tone] } as Vars}>
          <div className="rw-prog-top">
            <b>{r.name}</b>
            <span><em>{fmt(r.target)}</em> {r.unit}</span>
            {pct !== null && <strong className={pct > 1.1 ? 'over' : undefined}>{fmt(r.value!)} {r.unit} · {Math.round(pct * 100)}%</strong>}
          </div>
          <div className="rw-track"><i style={{ width: `${(Math.min(pct ?? 0, 1.25) / 1.25) * 100}%` }} /><u /></div>
        </div>;
      })}
    </div>
    {chart.note && <p className="coach-chart-note">{chart.note}</p>}
  </figure>;
}

export default function CoachCharts({ charts }: { charts: CoachChart[] }) {
  if (!charts.length) return null;
  return <>{charts.map((chart) => (chart.kind === 'progress'
    ? <ProgressChart key={chart.id} chart={chart} />
    : <SeriesChart key={chart.id} chart={chart} />))}</>;
}
