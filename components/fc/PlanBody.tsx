'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ExerciseChoice } from './ExerciseSheet';
import SculptureAtlas from './SculptureAtlas';
import type { HeatItem } from './MuscleDict';
import type { SculptureVariant } from '@/lib/sculpture-groups';

export default function PlanBody({ heat, variant = 'male', onChooseExercise, todayPlan }: {
  heat: HeatItem[];
  variant?: SculptureVariant;
  todayPlan?: { date: string; exerciseIds: string[] };
  onChooseExercise?: (exercise: ExerciseChoice) => void;
}) {
  const [back, setBack] = useState(false);
  const [body, setBody] = useState<SculptureVariant>(variant);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<{ source: string[]; ids: string[] }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const router = useRouter();
  const planned = new Set(saved && saved.source === todayPlan?.exerciseIds ? saved.ids : todayPlan?.exerciseIds);

  function toggle(exerciseId: string) {
    if (lock.current || planned.has(exerciseId)) return;
    setError('');
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(exerciseId)) next.delete(exerciseId);
      else next.add(exerciseId);
      return next;
    });
  }

  async function complete() {
    if (!todayPlan || lock.current || selected.size === 0) return false;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: todayPlan.date, exerciseIds: [...selected] }),
      });
      const result = await response.json() as { items?: { exercise_id: string }[]; error?: string };
      if (!response.ok || !result.items) throw new Error(result.error || '保存失败，请重试');
      setSaved({ source: todayPlan.exerciseIds, ids: result.items.map((item) => item.exercise_id) });
      setSelected(new Set());
      router.refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="fc-plan-stage">
      <div className="fc-plan-view">
        <button type="button" className={!back ? 'on' : ''} onClick={() => setBack(false)}>
          正面
        </button>
        <button type="button" className={back ? 'on' : ''} onClick={() => setBack(true)}>
          背面
        </button>
        <span className="fc-plan-sep" aria-hidden>·</span>
        <button type="button" className={body === 'male' ? 'on' : ''} onClick={() => setBody('male')}>
          男
        </button>
        <button type="button" className={body === 'female' ? 'on' : ''} onClick={() => setBody('female')}>
          女
        </button>
      </div>

      <div className="fc plan-embed">
        <SculptureAtlas heat={heat} back={back} hideTabs variant={body} onChooseExercise={onChooseExercise}
          selection={todayPlan ? { planned, selected, toggle, saving, error, complete } : undefined} />
      </div>
    </div>
  );
}
