'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import PlanBody from './fc/PlanBody';
import type { ExerciseChoice } from './fc/ExerciseSheet';
import type { SculptureVariant } from '@/lib/sculpture-groups';
import type { SupplementalExercise } from '@/lib/types';

export default function SupplementalWorkout({ variant }: { variant: SculptureVariant }) {
  const router = useRouter();
  const [exercises, setExercises] = useState<ExerciseChoice[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);

  function chooseExercise(exercise: ExerciseChoice) {
    if (locked.current) return;
    setExercises((current) => current.some(({ id }) => id === exercise.id) ? current : [...current, exercise]);
    requestAnimationFrame(() => document.getElementById(`supplemental-${exercise.id}`)?.focus());
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || exercises.length === 0) return;
    const form = new FormData(event.currentTarget);
    const supplementalExercises: SupplementalExercise[] = exercises.map(({ id }) => ({
      exerciseId: id,
      sets: Number(form.get(`sets-${id}`)),
      reps: Number(form.get(`reps-${id}`)),
      weight: Number(form.get(`weight-${id}`)),
      restSec: Number(form.get(`restSec-${id}`)),
    }));
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
      router.push(`/train/${result.session.id}`);
    } catch (err) {
      setError((err as Error).message);
      locked.current = false;
      setSubmitting(false);
    }
  }

  return <>
    <PlanBody heat={[]} variant={variant} onChooseExercise={chooseExercise} />
    {exercises.length > 0 && <section className="day-panel">
      <h2 className="day-heading">加练动作 <span>{exercises.length} 个动作</span></h2>
      <form className="plan-config" onSubmit={start}>
        {exercises.map(({ id, name }) => <div className="day-exercise" key={id}>
          <div className="day-exercise-name">
            <strong id={`supplemental-${id}`} tabIndex={-1}>{name}</strong>
            <button type="button" className="journal-chip" aria-label={`移除${name}`} disabled={submitting}
              onClick={() => setExercises((current) => current.filter((exercise) => exercise.id !== id))}>移除</button>
          </div>
          <div className="run-fields" role="group" aria-labelledby={`supplemental-${id}`}>
            <label>组数<input name={`sets-${id}`} type="number" min="1" max="20" defaultValue="3" required disabled={submitting} /></label>
            <label>每组次数<input name={`reps-${id}`} type="number" min="1" max="100" defaultValue="10" required disabled={submitting} /></label>
            <label>重量（kg）<input name={`weight-${id}`} type="number" min="0" max="1000" step="any" defaultValue="0" required disabled={submitting} /></label>
            <label>休息（秒）<input name={`restSec-${id}`} type="number" min="0" max="600" defaultValue="90" required disabled={submitting} /></label>
          </div>
        </div>)}
        {error && <p className="journal-error" role="alert">{error}</p>}
        <button type="submit" className="journal-primary" disabled={submitting}>{submitting ? '开始中…' : '开始加练'}</button>
      </form>
    </section>}
  </>;
}
