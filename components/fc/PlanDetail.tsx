'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import JournalIcon from '@/components/JournalIcon';
import type { MuscleId } from '@/lib/muscles';
import type { PlanPose } from '@/lib/plan-poses';

async function countOf(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error('count');
  return ((await res.json()) as { total?: number }).total ?? 0;
}

/** 点选肌群后的姿势详情：灰白石膏姿势 + 雾银抽屉（动作库 / 我的动作库 / 开始训练）。 */
export default function PlanDetail({ muscle, muscleLabel, region, pose, planCount, activeSession, closing, libraryOpen, onOpenLibrary, onClose }: {
  muscle: MuscleId;
  muscleLabel: string;
  region: string;
  pose: PlanPose;
  planCount: number;
  activeSession: number | null;
  closing: boolean;
  libraryOpen: boolean;
  onOpenLibrary: (which: 'all' | 'liked') => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<{ all?: number; liked?: number }>({});
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const request = new AbortController();
    setCounts({});
    const base = `/api/exercises?group=${muscle}&limit=1&order=plan`;
    Promise.all([countOf(base, request.signal), countOf(`${base}&preference=liked`, request.signal)])
      .then(([all, liked]) => setCounts({ all, liked }))
      .catch(() => { /* 数量只是提示，失败时不显示 */ });
    return () => request.abort();
  }, [muscle]);

  useEffect(() => {
    if (libraryOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, libraryOpen]);

  async function start() {
    if (starting) return;
    if (activeSession) { router.push(`/train/${activeSession}`); return; }
    if (planCount === 0) { onOpenLibrary('all'); return; }
    setStarting(true);
    setError('');
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guided: true }),
      });
      const data = (await res.json()) as { session?: { id: number }; error?: string };
      if (!res.ok || !data.session) throw new Error(data.error ?? '开始训练失败');
      try { navigator.vibrate?.(14); } catch { /* 无振动接口 */ }
      router.push(`/train/${data.session.id}`);
    } catch (err) {
      setError((err as Error).message);
      setStarting(false);
    }
  }

  const count = (n?: number) => (n === undefined ? '' : `${n} 个`);
  const startMeta = activeSession ? '继续上一节' : planCount ? `今日 ${planCount} 个动作` : '先挑动作';

  return (
    <div className="plan-detail" data-closing={closing || undefined} role="dialog" aria-modal="true" aria-label={`${region} · ${muscleLabel}`}>
      <header className="plan-detail-head">
        <div className="journal-brand"><JournalIcon name="brand" />FitCheck</div>
        <div className="journal-head-actions">
          <span className="journal-head-label">训练计划</span>
          <button type="button" className="journal-head-circle" onClick={onClose} aria-label="返回点选肌群">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </header>

      <figure className="plan-detail-figure">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/plan-poses/${pose}.jpg`} alt={`${region}展示姿势`} draggable={false} />
      </figure>

      <section className="plan-drawer">
        <button type="button" className="plan-drawer-grab" onClick={onClose} aria-label="收起" />
        <p className="plan-kicker"><i aria-hidden="true" />已选部位 · {region}</p>
        <h2 className="plan-drawer-title">{muscleLabel}</h2>
        <div className="plan-drawer-rows">
          <button type="button" onClick={() => onOpenLibrary('all')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></svg>
            <span>动作库</span><small>{count(counts.all)}</small>
            <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
          <button type="button" onClick={() => onOpenLibrary('liked')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M7 4h10v16l-5-4-5 4Z" /></svg>
            <span>我的动作库</span><small>{count(counts.liked)}</small>
            <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>
        {error && <p className="plan-error" role="alert">{error}</p>}
        <button type="button" className="plan-start" onClick={() => void start()} disabled={starting}>
          <span>{starting ? '正在开始…' : '开始训练'}</span>
          <span className="plan-start-meta">{startMeta}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
          </span>
        </button>
      </section>
    </div>
  );
}
