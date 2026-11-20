'use client';

import { useId, useState } from 'react';
import { imageUrl } from '@/lib/exercise-label';
import type { ExercisePerformance as Exercise } from '@/lib/types';
import JournalIcon from './JournalIcon';

const views = {
  pr: { label: 'PR', description: '极限重量', empty: '暂无可估算的负重组' },
  growth: { label: '8–12 RM', description: '黄金增重重量', empty: '暂无 8–12 次记录' },
  endurance: { label: '12–15 RM', description: '肌耐力重量', empty: '暂无 12–15 次记录' },
} as const;
type View = keyof typeof views;

const format = (weight: number) => weight.toLocaleString('zh-CN', { maximumFractionDigits: 1 });

export default function ExercisePerformance({ exercises }: { exercises: Exercise[] }) {
  const [view, setView] = useState<View>('pr');
  const [formulaOpen, setFormulaOpen] = useState(false);
  const formulaId = useId();
  const ranked = [...exercises].sort((a, b) => (b[view]?.value ?? -1) - (a[view]?.value ?? -1));
  return <section className="block">
    <h2 className="block-title">动作表现</h2>
    <div className="exercise-performance-tabs" role="group" aria-label="动作表现指标">
      {(Object.keys(views) as View[]).map((key) => <button key={key} type="button"
        aria-pressed={view === key} onClick={() => setView(key)}>
        <strong>{views[key].label}</strong>
        <small>{views[key].description}</small>
      </button>)}
    </div>
    {view === 'pr' ? <>
      <div className="exercise-performance-note exercise-performance-note-with-help">
        <span>用实际负重组估算 1RM，取本周期最高值。</span>
        <button type="button" className="exercise-performance-help" aria-label="PR 计算公式"
          aria-expanded={formulaOpen} aria-controls={formulaId} onClick={() => setFormulaOpen((open) => !open)}>?</button>
      </div>
      <div id={formulaId} className="exercise-performance-formula" hidden={!formulaOpen}>
        <strong>Epley 公式</strong>
        <p>估算 1RM = 实际重量 ×（1 + 完成次数 ÷ 30）</p>
        <p>例如 30 kg 做了 12 次，估算 1RM 为 42 kg。</p>
        <p>做 1 次时直接用实举重量。PR 取本周期内 1–15 次负重组的最高值。</p>
      </div>
    </> : <p className="exercise-performance-note">显示本周期内该次数范围实际完成的最重一组。</p>}
    {ranked.length > 0 ? <div className="exercise-performance-grid">
      {ranked.map((exercise) => {
        const best = exercise[view];
        return <article key={exercise.id} className="exercise-performance-card">
          <header>
            <span className="exercise-performance-thumb">
              {exercise.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={imageUrl(exercise.image)} loading="lazy" alt="" />
                : <JournalIcon name="training" />}
            </span>
            <h3>{exercise.name}</h3>
          </header>
          {best ? <>
            <strong className="exercise-performance-value">
              {view === 'pr' && '约 '}{best.value > 0 ? `${format(best.value)} kg` : '自重'}
            </strong>
            <p>{best.weight > 0 ? `${format(best.weight)} kg` : '自重'} × {best.reps} 次 · {best.date}</p>
          </> : <p>{views[view].empty}</p>}
        </article>;
      })}
    </div> : <p className="hint">所选时段还没有已记录的动作组。</p>}
  </section>;
}
