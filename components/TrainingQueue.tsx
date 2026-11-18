'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PlanItem } from '@/lib/types';
import JournalIcon from './JournalIcon';

export default function TrainingQueue({ items, activeId }: { items: PlanItem[]; activeId: number | null }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = items.filter((item) => !item.done);
  const firstItem = pending.find((item) => item.id === selected) ?? pending[0];

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  async function start() {
    if (busy || activeId || !firstItem) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ firstPlanItemId: firstItem.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '开始训练失败');
      setOpen(false);
      router.push(`/train/${data.session.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="journal-icon-button queue-toggle" aria-label="今日训练清单" title="今日训练清单" onClick={() => {
        setSelected(null);
        setError('');
        setOpen(true);
        router.refresh();
      }}><JournalIcon name="queue" />{pending.length > 0 && <span>{pending.length}</span>}</button>
      {open && <dialog className="journal-dialog" ref={dialog} aria-labelledby="queue-title" onClose={() => setOpen(false)}>
        <div className="dialog-head"><h2 id="queue-title">今日训练</h2><button aria-label="关闭清单" className="journal-icon-button" onClick={() => dialog.current?.close()}>×</button></div>
        {items.length > 0 ? (
          <div className="queue-list">
            {items.map((item) => <button key={item.id} type="button" className="queue-item" aria-pressed={!activeId && firstItem?.id === item.id} disabled={Boolean(item.done || activeId)} onClick={() => setSelected(item.id)}>
              <strong>{!activeId && firstItem?.id === item.id && <span aria-hidden="true">✓ </span>}{item.name}</strong>
              <span>{item.sets} 组 × {item.reps} 次 · {item.rest_sec} 秒休息{item.done ? ' · 已完成' : ''}</span>
            </button>)}
          </div>
        ) : <p className="journal-muted">在计划里点选肌肉，加入今天想练的动作。</p>}
        {activeId ? <Link className="journal-primary" href={`/train/${activeId}`} onClick={() => setOpen(false)}>继续训练</Link>
          : pending.length > 0 ? <button className="journal-primary" disabled={busy} onClick={() => void start()}>{busy ? '开始中…' : '开始训练'}</button>
          : <Link className="journal-primary" href="/body" onClick={() => setOpen(false)}>去计划</Link>}
        {error && <p className="journal-error" role="alert">{error}</p>}
      </dialog>}
    </>
  );
}
