'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import ExerciseSheet, { type ExerciseChoice } from './fc/ExerciseSheet';
import SculptureBody, { type SculptureAnchor } from './fc/SculptureBody';
import Icon from './ui/Icon';
import Stepper from './ui/Stepper';
import type { MuscleId } from '@/lib/muscles';
import { canonicalMuscle, sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';
import type { SupplementalExercise } from '@/lib/types';

type Pick = ExerciseChoice & { sets: number; reps: number; weight: number; restSec: number; muscle?: string };
const REST = [60, 90, 120];
const haptic = (ms: number | number[] = 6) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };

/** 加练：在点阵人体上点肌群挑动作，下方逐个调组次，直接开练。 */
export default function SupplementalWorkout({ variant }: { variant: SculptureVariant }) {
  const router = useRouter();
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [muscle, setMuscle] = useState<MuscleId | null>(null);
  const [sheet, setSheet] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [fresh, setFresh] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const group = muscle ? sculptureGroup(muscle) : null;
  const anchor: SculptureAnchor = muscle && group ? { muscle, label: group.label } : null;

  function choose(exercise: ExerciseChoice) {
    if (locked.current) return;
    haptic(12);
    setPicks((current) => current.some(({ id }) => id === exercise.id) ? current
      : [...current, { ...exercise, sets: 3, reps: 10, weight: 0, restSec: 90, muscle: group?.label }]);
    setFresh(exercise.id);
    window.setTimeout(() => document.getElementById(`extra-${exercise.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }

  function update(id: string, patch: Partial<Pick>) {
    setPicks((current) => current.map((pick) => pick.id === id ? { ...pick, ...patch } : pick));
  }

  async function start() {
    if (locked.current || picks.length === 0) return;
    const supplementalExercises: SupplementalExercise[] = picks.map(({ id, sets, reps, weight, restSec }) => ({ exerciseId: id, sets, reps, weight, restSec }));
    locked.current = true;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ supplementalExercises }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '开始加练失败');
      haptic(16);
      router.push(`/train/${result.session.id}`);
    } catch (err) {
      setError((err as Error).message);
      locked.current = false;
      setSubmitting(false);
    }
  }

  const totalSets = picks.reduce((sum, pick) => sum + pick.sets, 0);

  return <div className="extra">
    <div className="extra-stage">
      <div className="plan-dots" aria-hidden="true" />
      <SculptureBody look="halftone" key={variant} variant={variant} side={side} selected={muscle} anchor={anchor}
        onPick={(id) => { haptic(); setMuscle(canonicalMuscle(id) ?? id); setSheet(true); }} />
    </div>
    <button type="button" className="plan-rotate extra-rotate" onClick={() => setSide((s) => (s === 'front' ? 'back' : 'front'))}>
      <Icon name="rotate" size={15} />{side === 'front' ? '转到背面' : '转到正面'} · 点肌群挑动作
    </button>

    <section className="v-section extra-list" aria-label="加练动作">
      <div className="extra-head">
        <h2 className="v-section-title"><Icon name="spark" size={13} className="extra-spark" />加练动作</h2>
        <span>{picks.length ? `${picks.length} 个动作 · ${totalSets} 组` : '还没有挑'}</span>
      </div>
      {picks.length === 0 ? <p className="extra-empty">在上面的人体上点一块肌肉，从动作库里挑一个；可以连续挑几个，最后一起开始。</p>
        : <ol className="plan-rows">
          {picks.map((pick) => <li key={pick.id} id={`extra-${pick.id}`} className="plan-item extra-item" data-open data-fresh={fresh === pick.id || undefined}>
            <div className="plan-item-head extra-item-head">
              <span className="plan-item-main">
                <b>{pick.name}</b>
                <small>{pick.muscle ?? '加练'}<span className="sep">·</span>{pick.sets} × {pick.reps} · {pick.weight ? `${pick.weight} kg` : '自重'}</small>
              </span>
              <button type="button" className="extra-remove" aria-label={`移除${pick.name}`} disabled={submitting}
                onClick={() => { haptic(5); setPicks((current) => current.filter(({ id }) => id !== pick.id)); }}>
                <Icon name="close" size={14} stroke={2} />
              </button>
            </div>
            <div className="steppers">
              <Stepper label="组数" value={pick.sets} unit="组" step={1} min={1} max={20} onChange={(v) => update(pick.id, { sets: v })} />
              <Stepper label="次数" value={pick.reps} unit="次" step={1} min={1} max={100} onChange={(v) => update(pick.id, { reps: v })} />
              <Stepper label="重量" value={pick.weight} unit="kg" step={2.5} min={0} max={1000} onChange={(v) => update(pick.id, { weight: v })} />
            </div>
            <div className="rest-seg" role="radiogroup" aria-label={`${pick.name}组间休息`}>
              <span>组间休息</span>
              {REST.map((r) => <button key={r} type="button" role="radio" aria-checked={pick.restSec === r} className={pick.restSec === r ? 'on' : ''}
                onClick={() => { haptic(4); update(pick.id, { restSec: r }); }}>{r}<em>s</em></button>)}
            </div>
          </li>)}
        </ol>}
      {error && <p className="form-err" role="alert">{error}</p>}
    </section>

    {picks.length > 0 && <div className="start-dock">
      <button type="button" className="ink-btn" onClick={() => void start()} disabled={submitting}>
        <span>{submitting ? '正在开始…' : '开始加练'}</span>
        <span className="ink-btn-meta">{totalSets} 组<Icon name="arrow-right" size={20} /></span>
      </button>
    </div>}

    {/* 动作抽屉沿用 .fc 作用域的样式；只包住抽屉，页面按钮不受旧的 .fc button 重置影响 */}
    <div className="fc extra-sheet">
      <ExerciseSheet muscle={sheet ? muscle : null} grouped onClose={() => setSheet(false)}
        onChooseExercise={(exercise) => choose(exercise)} />
    </div>
  </div>;
}
