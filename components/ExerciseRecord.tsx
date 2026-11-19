'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { BODY_LABEL } from '@/lib/exercise-label';
import type { SetRow } from '@/lib/types';

interface ExerciseGroup {
  exercise_id: string;
  exercise_name: string;
  body_part: string;
  sets: SetRow[];
  volume: number;
}

function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.round(value));
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining ? `${minutes}分${remaining}秒` : `${minutes}分钟`;
}

function initialDrafts(sets: SetRow[]) {
  return Object.fromEntries(sets.map((set) => [set.id, {
    weight: String(set.weight),
    reps: String(set.reps),
  }])) as Record<number, { weight: string; reps: string }>;
}

export default function ExerciseRecord({ group }: { group: ExerciseGroup }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [sets, setSets] = useState(group.sets);
  const [drafts, setDrafts] = useState(() => initialDrafts(group.sets));
  const [saving, setSaving] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const volume = Math.round(sets.reduce((total, set) => total + set.weight * set.reps, 0));
  const detailsId = `exercise-set-${group.sets[0]?.id ?? 0}-details`;

  function changeDraft(id: number, field: 'weight' | 'reps', value: string) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
    setMessage('');
    setError('');
  }

  async function save(event: FormEvent<HTMLFormElement>, set: SetRow, index: number) {
    event.preventDefault();
    if (saving !== null) return;
    setSaving(set.id);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/session/set', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: set.id,
          weight: Number(drafts[set.id].weight),
          reps: Number(drafts[set.id].reps),
        }),
      });
      const result = await response.json() as { set?: SetRow; error?: string };
      if (!response.ok || !result.set) throw new Error(result.error || '保存失败，请重试');
      setSets((current) => current.map((entry) => entry.id === set.id ? result.set! : entry));
      setMessage(`第 ${index + 1} 组已保存，训练容量已更新`);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="day-exercise">
      <div className="day-exercise-name">
        <button className="day-exercise-toggle" type="button" aria-expanded={expanded} aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}>
          <strong>{group.exercise_name}<span aria-hidden="true">{expanded ? ' ▴' : ' ▾'}</span></strong>
          <small>{expanded ? '收起每组明细' : '查看每组用时与休息'}</small>
        </button>
        <span>{BODY_LABEL[group.body_part] ?? group.body_part} · {volume.toLocaleString('zh-CN')} kg</span>
      </div>
      <ol className="set-chips" aria-label={`${group.exercise_name}训练组摘要`}>
        {sets.map((set) => <li className="set-chip" key={set.id}>
          {set.weight > 0 ? `${set.weight} kg` : '自重'} × {set.reps}
        </li>)}
      </ol>

      {expanded && <div className="set-details" id={detailsId}>
        <p className="set-details-intro">每组可单独修改；实际休息从本组完成计到下一组开始。</p>
        <ol className="set-detail-list">
          {sets.map((set, index) => <li className="set-detail-row" key={set.id}>
            <form onSubmit={(event) => void save(event, set, index)}>
              <div className="set-detail-heading">
                <strong>第 {index + 1} 组</strong>
                <span>本组用时 {formatSeconds(set.duration_sec)}</span>
              </div>
              <div className="set-edit-fields">
                <label>重量<span className="set-input"><input aria-label={`第 ${index + 1} 组重量（kg）`}
                  type="number" min="0" max="1000" step="0.5" inputMode="decimal" required
                  value={drafts[set.id].weight} onChange={(event) => changeDraft(set.id, 'weight', event.target.value)} /><small>kg</small></span></label>
                <label>次数<span className="set-input"><input aria-label={`第 ${index + 1} 组次数`}
                  type="number" min="1" max="1000" step="1" inputMode="numeric" required
                  value={drafts[set.id].reps} onChange={(event) => changeDraft(set.id, 'reps', event.target.value)} /><small>次</small></span></label>
                <button className="set-save" type="submit" disabled={saving !== null}>{saving === set.id ? '保存中…' : '保存'}</button>
              </div>
              <p className="set-rest">{set.actual_rest_sec !== null
                ? `组后休息 ${formatSeconds(set.actual_rest_sec)}`
                : `组后休息 未记录${set.rest_sec > 0 ? ` · 目标 ${formatSeconds(set.rest_sec)}` : ''}`}</p>
            </form>
          </li>)}
        </ol>
        {message && <p className="set-save-message" role="status">{message}</p>}
        {error && <p className="journal-error" role="alert">{error}</p>}
      </div>}
    </div>
  );
}
