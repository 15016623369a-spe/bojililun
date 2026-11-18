'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function PlanExercise({ id, name, onDone, onAdded }: { id: string; name: string; onDone: () => void; onAdded: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          exerciseId: id,
          sets: Number(form.get('sets')),
          reps: Number(form.get('reps')),
          weight: Number(form.get('weight')),
          restSec: Number(form.get('restSec')),
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? '加入失败');
      router.refresh();
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <form className="plan-config" onSubmit={add}>
    <h3>{name}</h3>
    <div className="run-fields">
      <label>组数<input name="sets" type="number" min="1" max="20" defaultValue="3" required /></label>
      <label>每组次数<input name="reps" type="number" min="1" max="100" defaultValue="10" required /></label>
      <label>重量（kg）<input name="weight" type="number" min="0" max="1000" step="any" defaultValue="0" required /></label>
      <label>休息（秒）<input name="restSec" type="number" min="0" max="600" defaultValue="90" required /></label>
    </div>
    <button className="journal-primary" disabled={busy}>{busy ? '加入中…' : '加入今日计划'}</button>
    <button type="button" className="journal-quiet" onClick={onDone}>返回动作列表</button>
    {error && <p className="journal-error" role="alert">{error}</p>}
  </form>;
}
