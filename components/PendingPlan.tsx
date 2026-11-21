'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PlanItem } from '@/lib/types';
import JournalIcon from './JournalIcon';

export default function PendingPlan({ items, activeId }: { items: PlanItem[]; activeId: number | null }) {
  const router = useRouter();
  const lock = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pendingId, setPendingId] = useState<number>();
  const [completed, setCompleted] = useState<number>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (completed !== undefined && !items.some((item) => item.id === completed)) setCompleted(undefined);
  }, [completed, items]);
  if (!items.length) return null;

  async function complete(item: PlanItem) {
    if (lock.current) return;
    lock.current = true;
    setError('');
    setPendingId(item.id);
    try {
      const response = await fetch('/api/plan', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: item.id, complete: true }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || '记录失败，请重试');
      setCompleted(item.id);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      lock.current = false;
      setPendingId(undefined);
    }
  }

  return <section className="pending-plan" aria-label="今日待练">
    <div className="pending-plan-head">
      <b>待练 · {items.length} 个动作</b>
      {activeId && <Link href={`/train/${activeId}`}>继续训练</Link>}
      <button type="button" aria-expanded={!collapsed} aria-controls="pending-plan-list"
        onClick={() => setCollapsed(!collapsed)}>{collapsed ? '展开' : '收起'}</button>
    </div>
    <ul id="pending-plan-list" hidden={collapsed}>
      {items.map((item) => <li key={item.id}>
        <button className="plan-check" type="button" aria-label={`确认按计划完成${item.name}`}
          aria-pressed={completed === item.id} disabled={Boolean(activeId || pendingId || completed === item.id)}
          onClick={() => void complete(item)}>{completed === item.id && <JournalIcon name="check" />}</button>
        <Link className="pending-plan-item" href={`/exercises/${encodeURIComponent(item.exercise_id)}?from=today&item=${item.id}`}>
          <strong>{item.name}</strong>
          <small>{item.sets}组 × {item.reps}次</small>
          <span aria-hidden="true">›</span>
        </Link>
      </li>)}
    </ul>
    {error && <p className="journal-error" role="alert">{error}</p>}
  </section>;
}
