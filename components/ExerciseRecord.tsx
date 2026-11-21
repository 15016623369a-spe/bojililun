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

export default function ExerciseRecord({ group, initiallyExpanded = false }: { group: ExerciseGroup; initiallyExpanded?: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [sets, setSets] = useState(group.sets);
  const [drafts, setDrafts] = useState(() => initialDrafts(group.sets));
  const [saving, setSaving] = useState<number | null>(null);
  const [pending, setPending] = useState<'add' | `del-${number}` | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const volume = Math.round(sets.reduce((total, set) => total + set.weight * set.reps, 0));
  const detailsId = `exercise-set-${group.sets[0]?.id ?? 0}-details`;
  const sessionId = group.sets[0]?.session_id ?? 0;
  const busy = saving !== null || pending !== null;

  function changeDraft(id: number, field: 'weight' | 'reps', value: string) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
    setMessage('');
    setError('');
  }

  /** 用服务端返回的最新组数据同步本地状态；已输入但还没保存的编辑尽量保留。 */
  function applySets(next: SetRow[]) {
    setSets(next);
    setDrafts((current) => Object.fromEntries(next.map((set) => [set.id, current[set.id] ?? {
      weight: String(set.weight),
      reps: String(set.reps),
    }])) as Record<number, { weight: string; reps: string }>);
  }

  async function save(event: FormEvent<HTMLFormElement>, set: SetRow, index: number) {
    event.preventDefault();
    if (busy) return;
    setSaving(set.id);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/session/set', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: set.id,
          weight: Number(drafts[set.id]?.weight ?? set.weight),
          reps: Number(drafts[set.id]?.reps ?? set.reps),
        }),
      });
      const result = await response.json() as { set?: SetRow; error?: string };
      if (!response.ok || !result.set) throw new Error(result.error || '保存失败，请重试');
      const saved = result.set;
      setSets((current) => current.map((entry) => entry.id === set.id ? saved : entry));
      setDrafts((current) => ({ ...current, [set.id]: { weight: String(saved.weight), reps: String(saved.reps) } }));
      setMessage(`第 ${index + 1} 组已保存，训练容量已更新`);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(null);
    }
  }

  async function addSet() {
    if (busy) return;
    setPending('add');
    setMessage('');
    setError('');
    try {
      const last = sets.at(-1);
      const response = await fetch('/api/session/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          append: true,
          sessionId,
          exerciseId: group.exercise_id,
          weight: last?.weight ?? 0,
          reps: last?.reps ?? 1,
        }),
      });
      const result = await response.json() as { sets?: SetRow[]; error?: string };
      if (!response.ok || !result.sets) throw new Error(result.error || '添加失败，请重试');
      applySets(result.sets);
      setExpanded(true);
      setMessage(`已添加第 ${result.sets.length} 组`);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function removeSet(set: SetRow, index: number) {
    if (busy) return;
    if (sets.length <= 1 && !window.confirm('这是该动作的最后一组，删除后这个动作会从当日记录里消失，确定删除？')) return;
    setPending(`del-${set.id}`);
    setMessage('');
    setError('');
    try {
      const response = await fetch(`/api/session/set?id=${set.id}`, { method: 'DELETE' });
      const result = await response.json() as { sets?: SetRow[]; error?: string };
      if (!response.ok || !result.sets) throw new Error(result.error || '删除失败，请重试');
      applySets(result.sets);
      setMessage(`已删除第 ${index + 1} 组`);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(null);
    }
  }

  if (sets.length === 0) {
    return <div className="day-exercise"><p className="hint">这个动作的训练组已全部删除。</p></div>;
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
        <p className="set-details-intro">每组可单独修改、删除，也可以在这里补一组；实际休息从本组完成计到下一组开始。</p>
        <ol className="set-detail-list">
          {sets.map((set, index) => <li className="set-detail-row" key={set.id}>
            <form onSubmit={(event) => void save(event, set, index)}>
              <div className="set-detail-heading">
                <strong>第 {index + 1} 组</strong>
                <span>本组用时 {formatSeconds(set.duration_sec)}</span>
                <button className="set-delete" type="button" disabled={busy}
                  aria-label={`删除第 ${index + 1} 组`} title="删除这一组"
                  onClick={() => void removeSet(set, index)}>
                  {pending === `del-${set.id}` ? '删除中…' : '删除'}
                </button>
              </div>
              <div className="set-edit-fields">
                <label>重量<span className="set-input"><input aria-label={`第 ${index + 1} 组重量（kg）`}
                  type="number" min="0" max="1000" step="0.5" inputMode="decimal" required
                  value={drafts[set.id]?.weight ?? String(set.weight)} onChange={(event) => changeDraft(set.id, 'weight', event.target.value)} /><small>kg</small></span></label>
                <label>次数<span className="set-input"><input aria-label={`第 ${index + 1} 组次数`}
                  type="number" min="1" max="1000" step="1" inputMode="numeric" required
                  value={drafts[set.id]?.reps ?? String(set.reps)} onChange={(event) => changeDraft(set.id, 'reps', event.target.value)} /><small>次</small></span></label>
                <button className="set-save" type="submit" disabled={busy}>{saving === set.id ? '保存中…' : '保存'}</button>
              </div>
              <p className="set-rest">{set.actual_rest_sec !== null
                ? `组后休息 ${formatSeconds(set.actual_rest_sec)}`
                : `组后休息 未记录${set.rest_sec > 0 ? ` · 目标 ${formatSeconds(set.rest_sec)}` : ''}`}</p>
            </form>
          </li>)}
        </ol>
        <button className="set-add" type="button" disabled={busy} onClick={() => void addSet()}>
          {pending === 'add' ? '添加中…' : '＋ 添加一组'}
        </button>
        {message && <p className="set-save-message" role="status">{message}</p>}
        {error && <p className="journal-error" role="alert">{error}</p>}
      </div>}
    </div>
  );
}
