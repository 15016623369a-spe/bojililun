'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import JournalIcon from '@/components/JournalIcon';
import type { MuscleId } from '@/lib/muscles';
import type { SculptureVariant } from '@/lib/sculpture-groups';
import type { PlanPose } from '@/lib/plan-poses';

async function countOf(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error('count');
  return ((await res.json()) as { total?: number }).total ?? 0;
}

/** 点选肌群后的姿势详情：灰白石膏姿势 + 雾银抽屉（动作库 / 我的动作库 / 开始训练）。 */
export default function PlanDetail({ muscle, muscleLabel, region, pose, variant, planCount, planDone = false, extra = false, activeSession, closing, libraryOpen, onOpenLibrary, onClose }: {
  muscle: MuscleId;
  /** 今日计划已全部练完：主按钮改成加练 */
  planDone?: boolean;
  /** 加练：主按钮直接打开动作库挑动作 */
  extra?: boolean;
  muscleLabel: string;
  region: string;
  pose: PlanPose;
  variant: SculptureVariant;
  planCount: number;
  activeSession: number | null;
  closing: boolean;
  /** 动作库抽屉开着时，Esc 交给抽屉处理 */
  libraryOpen: boolean;
  onOpenLibrary: (which: 'all' | 'liked') => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<{ all?: number; liked?: number }>({});
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  // 下拉抽屉关闭：跟手位移，人物同时轻微下沉放大，松手按距离或速度决定关闭还是回弹
  const [drag, setDrag] = useState<{ dy: number; live: boolean }>({ dy: 0, live: false });
  const dragStart = useRef<{ y: number; t: number; id: number } | null>(null);
  const moved = useRef(false);

  function onDragStart(event: PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('.plan-drawer-rows, .plan-start')) return;
    dragStart.current = { y: event.clientY, t: performance.now(), id: event.pointerId };
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ dy: 0, live: true });
  }
  function onDragMove(event: PointerEvent<HTMLElement>) {
    const start = dragStart.current;
    if (!start || start.id !== event.pointerId) return;
    const raw = event.clientY - start.y;
    if (Math.abs(raw) > 4) moved.current = true;
    setDrag({ dy: raw > 0 ? raw : raw * .22, live: true });
  }
  function onDragEnd(event: PointerEvent<HTMLElement>) {
    const start = dragStart.current;
    if (!start || start.id !== event.pointerId) return;
    dragStart.current = null;
    const dy = event.clientY - start.y;
    const speed = dy / Math.max(1, performance.now() - start.t);
    if (dy > 120 || (dy > 40 && speed > .7)) { onClose(); setDrag({ dy, live: false }); }
    else setDrag({ dy: 0, live: false });
  }

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
    if (planDone) { router.push('/train/extra'); return; }
    if (extra) { onOpenLibrary('liked'); return; }
    if (planCount === 0) { onOpenLibrary('liked'); return; }
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
  const startMeta = activeSession ? '继续上一节' : extra ? '加入今日计划' : planDone ? '今日计划已完成' : planCount ? `今日 ${planCount} 个动作` : '先挑动作';
  const startLabel = activeSession ? '继续训练' : extra ? '挑加练动作' : planDone ? '加练' : '开始训练';

  return (
    <div className="plan-detail" data-closing={closing || undefined} data-dragging={drag.live || undefined}
      style={{ '--drag': `${drag.dy.toFixed(1)}px` } as CSSProperties}
      role="dialog" aria-modal="true" aria-label={`${region} · ${muscleLabel}`}>
      <div className="plan-detail-dots" aria-hidden="true" />
      <header className="plan-detail-head">
        <div className="journal-brand"><JournalIcon name="brand" />FitCheck</div>
        <div className="journal-head-actions">
          <span className="journal-head-label">训练计划</span>
          <button type="button" className="journal-head-circle" onClick={onClose} aria-label="返回点选肌群">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </header>

      {/* 抽屉上方任意位置点一下就收起，回到点阵人体 */}
      <button type="button" className="plan-detail-backdrop" onClick={onClose} aria-label="收起，回到点选肌群" tabIndex={-1} />
      <figure className="plan-detail-figure" data-variant={variant} data-pose={pose}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/plan-poses/${variant === 'female' ? 'female/' : ''}${pose}.jpg`} alt={`${region}展示姿势`} draggable={false} />
      </figure>

      <section className="plan-drawer" onPointerDown={onDragStart} onPointerMove={onDragMove}
        onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
        <button type="button" className="plan-drawer-grab" onClick={() => { if (!moved.current) onClose(); }} aria-label="收起" />
        <p className="plan-kicker"><i aria-hidden="true" />已选部位 · {region}</p>
        <h2 className="plan-drawer-title">{muscleLabel}</h2>
        <div className="plan-drawer-rows">
          <button type="button" onClick={() => onOpenLibrary('liked')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M7 4h10v16l-5-4-5 4Z" /></svg>
            <span>我的动作库</span><small>{count(counts.liked)}</small>
            <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>
        {error && <p className="plan-error" role="alert">{error}</p>}
        <button type="button" className="plan-start" onClick={() => void start()} disabled={starting}>
          <span>{starting ? '正在开始…' : startLabel}</span>
          <span className="plan-start-meta">{startMeta}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
          </span>
        </button>
      </section>
    </div>
  );
}
