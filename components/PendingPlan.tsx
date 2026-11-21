'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PlanItem } from '@/lib/types';
import Icon from './ui/Icon';

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

  return <section className="pending" aria-label="今日待练">
    <div className="pending-head">
      <p className="kicker"><i aria-hidden="true" />待练 · {items.length} 个动作</p>
      <Link className="chip" href={activeId ? `/train/${activeId}` : '/train'}>{activeId ? '继续训练' : '去训练'}<Icon name="arrow-right" size={14} stroke={2} /></Link>
      <button type="button" className="pending-toggle" aria-expanded={!collapsed} aria-controls="pending-plan-list"
        aria-label={collapsed ? '展开待练' : '收起待练'} onClick={() => setCollapsed(!collapsed)}>
        <Icon name="chevron-down" size={18} />
      </button>
    </div>
    <ul id="pending-plan-list" className="pending-list" data-collapsed={collapsed || undefined}>
      {items.map((item) => <li key={item.id}>
        <button className="pending-check" type="button" aria-label={`确认按计划完成${item.name}`}
          aria-pressed={completed === item.id} disabled={Boolean(activeId || pendingId || completed === item.id)}
          onClick={() => void complete(item)}>{completed === item.id && <Icon name="check" size={14} stroke={2.6} />}</button>
        <Link className="pending-item" href={`/exercises/${encodeURIComponent(item.exercise_id)}?from=today&item=${item.id}`}>
          <strong>{item.name}</strong>
          <small>{item.sets} × {item.reps}{item.weight ? ` · ${item.weight} kg` : ''}</small>
          <Icon name="chevron-right" size={16} className="row-chev" />
        </Link>
      </li>)}
    </ul>
    {error && <p className="form-err" role="alert">{error}</p>}
  </section>;
}
