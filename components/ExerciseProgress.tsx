'use client';

import { useEffect, useRef, useState } from 'react';
import type { ExercisePerformance } from '@/lib/types';

const format = (weight: number) => weight.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
const load = (weight: number) => weight > 0 ? `${format(weight)} kg` : '自重';
const shortDate = (date: string) => date.slice(5).replace('-', '/');

type View = 'pr' | 'growth' | 'endurance';
const viewLabel = { pr: '估算 1RM', growth: '8–12 RM · 实练重量', endurance: '12–15 RM · 实练重量' };

export default function ExerciseProgress({ sessions, view }: { sessions: ExercisePerformance['sessions']; view: View }) {
  const [pickedId, setPickedId] = useState<number>();
  const scroll = useRef<HTMLDivElement>(null);
  const points = sessions.flatMap((session) => {
    const best = session[view];
    return best ? [{ ...best, id: session.id }] : [];
  }).reverse();
  const isTrend = points.length > 1;
  const latest = points.at(-1);
  const previous = points.at(-2);
  const picked = points.find(({ id }) => id === pickedId) ?? latest;
  const change = latest && previous ? Math.round((latest.value - previous.value) * 10) / 10 : undefined;

  useEffect(() => {
    if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth;
  }, [latest?.id]);

  const min = points.length ? Math.min(...points.map(({ value }) => value)) : 0;
  const max = Math.max(0, ...points.map(({ value }) => value));
  const step = Math.max(.5, (max - min) / 2);
  const lo = Math.max(0, Math.floor((min - step * .15) / step) * step);
  const hi = Math.ceil((max + step * .15) / step) * step;
  const coords = points.map(({ value }, i) => ({
    x: isTrend ? 5 + i / (points.length - 1) * 90 : 50,
    y: 92 - (value - lo) / (hi - lo) * 84,
  }));
  const line = coords.map(({ x, y }) => `${x},${y}`).join(' ');
  const chartWidth = Math.max(220, points.length * 38);
  const ticks = [hi, (hi + lo) / 2, lo];

  const matchingCounts = (weights: Record<number, number>) => Object.keys(weights).map(Number).filter((count) =>
    view === 'pr' || (view === 'growth' ? count >= 8 && count <= 12 : count >= 12 && count <= 15));
  const latestSession = sessions.find(({ weights }) => matchingCounts(weights).length > 0);
  const earlier = latestSession ? sessions.slice(sessions.indexOf(latestSession) + 1) : [];
  const counts = matchingCounts(latestSession?.weights ?? {});
  const preferred = latestSession?.[view]?.reps;
  const reps = (preferred === undefined ? counts : [preferred, ...counts.filter((count) => count !== preferred)])
    .find((count) => earlier.some(({ weights }) => weights[count] !== undefined));
  const comparable = reps === undefined ? undefined : earlier.find(({ weights }) => weights[reps] !== undefined);

  return <div className="exercise-progress">
    <div className="exercise-progress-panel">
      <div className="exercise-progress-head">
        <div><small>最近一次 · {viewLabel[view]}</small>
          {latest && <strong>{latest.value > 0 ? <>{format(latest.value)} <em>kg</em></> : '自重'}</strong>}
        </div>
        {change !== undefined && <span className="exercise-progress-delta">较上次 {change > 0 ? '+' : ''}{format(change)} kg</span>}
      </div>
      {picked ? <>
        <div className="exercise-progress-plot">
          <div className="exercise-progress-scale" aria-hidden="true">{ticks.map((tick, index) => <span key={index}>{format(tick)}</span>)}</div>
          <div className="exercise-progress-scroll" ref={scroll}>
            <div className="exercise-progress-chart" style={{ minWidth: chartWidth }}>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 8H100 M0 50H100 M0 92H100" className="exercise-progress-gridlines" />
                {isTrend && <>
                  <polygon points={`5,92 ${line} 95,92`} className="exercise-progress-area" />
                  <polyline points={line} className="exercise-progress-line" />
                </>}
              </svg>
              {points.map((point, index) => {
                const { x, y } = coords[index];
                const description = `${point.date}，${view === 'pr' ? `估算 ${format(point.value)} kg，` : ''}实练 ${load(point.weight)} × ${point.reps} 次`;
                return <button key={point.id} type="button" className="exercise-progress-point"
                  style={{ left: `${x}%`, top: `${y}%` }} aria-pressed={picked.id === point.id}
                  aria-label={description} title={description} onClick={() => setPickedId(point.id)} />;
              })}
            </div>
            <div className="exercise-progress-axis" aria-hidden="true" style={{ minWidth: chartWidth }}>
              {points.map((point, i) => <span key={point.id} style={{ left: `${coords[i].x}%` }}>{shortDate(point.date)}</span>)}
            </div>
          </div>
        </div>
        <div className="exercise-progress-source" role="status">
          <span>{picked.date} · {isTrend ? '选中训练' : '仅一条记录'}</span>
          <strong>实练 {load(picked.weight)} × {picked.reps} 次{view === 'pr' && isTrend ? ` · 估算 ${format(picked.value)} kg` : ''}</strong>
        </div>
      </> : <p className="exercise-progress-empty">
        {view === 'pr' ? '本周期暂无可估算 1RM 的负重组。' : view === 'growth' ? '本周期暂无 8–12 次实练组。' : '本周期暂无 12–15 次实练组。'}
      </p>}
    </div>
    <div className="exercise-progress-same">
      <h4>同次数重量变化 {reps !== undefined && <small>每组 {reps} 次</small>}</h4>
      {latestSession && comparable && reps !== undefined ? (
        [comparable, latestSession].map(({ id, date, weights }, index) => (
          <div key={id} className="exercise-progress-weight">
            <span>{shortDate(date)}{index ? ' · 最近' : ''}</span>
            <span className="exercise-progress-track" aria-hidden="true">
              <i style={{ width: `${weights[reps] / Math.max(1, comparable.weights[reps], latestSession.weights[reps]) * 100}%` }} />
            </span>
            <strong>{load(weights[reps])}</strong>
          </div>
        ))
      ) : <p>本周期暂无两次可比较的同次数记录。</p>}
    </div>
  </div>;
}
