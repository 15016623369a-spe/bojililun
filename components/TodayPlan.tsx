'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { PlanItem } from '@/lib/types';
import { TARGET_LABEL } from '@/lib/exercise-label';
import SupplementalMark from './SupplementalMark';
import Icon from './ui/Icon';
import EndTrainingButton from './EndTrainingButton';

function haptic(ms = 6) { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } }

/** 「今日已练」里计划以外的训练（语音、文字记的），一行一条 */
export type TrainedRow = { key: string; title: string; sub: string; href: string };

export default function TodayPlan({
  initialItems,
  images,
  completedByPlan = {},
  lastWeightByPlan = {},
  activeSession,
  trained,
}: {
  initialItems: PlanItem[];
  images: Record<string, string>;
  completedByPlan?: Record<number, number>;
  lastWeightByPlan?: Record<number, number>;
  activeSession: { id: number; startedAt: string; next?: { name: string; setsLeft: number }; completedSets?: number } | null;
  /** 今天已练的汇总（容量 · 组数 · 时长）和计划以外的训练 */
  trained?: { summary: string | null; rows: TrainedRow[] };
}) {
  const router = useRouter();
  const [items, setItems] = useState<PlanItem[]>(initialItems);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const savedItems = useRef(initialItems);
  const saveQueue = useRef(Promise.resolve());

  function save(url: string, options: RequestInit) {
    setSaving(true);
    setErr('');
    const request = saveQueue.current.then(async () => {
      try {
        const res = await fetch(url, options);
        const data = (await res.json()) as { items?: PlanItem[]; error?: string };
        if (!res.ok || !data.items) throw new Error(data.error ?? '更新列表失败');
        savedItems.current = data.items;
      } catch (e) {
        setErr((e as Error).message);
      }
    });
    saveQueue.current = request;
    void request.then(() => {
      if (request !== saveQueue.current) return;
      setItems(savedItems.current);
      setSaving(false);
      router.refresh();
    });
  }

  function remove(id: number) {
    haptic(6);
    setItems((prev) => prev.filter((it) => it.id !== id));
    setConfirmRemove(null);
    save(`/api/plan?id=${id}`, { method: 'DELETE' });
  }

  async function start(firstPlanItemId?: number) {
    if (busy || saving) return;
    const query = firstPlanItemId ? `?item=${firstPlanItemId}` : '';
    if (activeSession) {
      haptic(8);
      router.push(`/train/${activeSession.id}${query}`);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guided: true, ...(firstPlanItemId ? { firstPlanItemId } : {}) }),
      });
      const data = (await res.json()) as { session?: { id: number }; error?: string };
      if (!res.ok || !data.session) throw new Error(data.error ?? '开始训练失败');
      haptic(14);
      router.push(`/train/${data.session.id}${query}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const totalLogged = Object.values(completedByPlan).reduce((a, b) => a + b, 0);
  const doneCount = items.filter((x) => x.done === 1).length;
  const allDone = items.length > 0 && doneCount === items.length && !activeSession;
  const startedAt = activeSession ? new Date(activeSession.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  const pending = items.filter((x) => x.done !== 1);
  const finished = items.filter((x) => x.done === 1);
  const extraRows = trained?.rows ?? [];

  function rowSub(it: PlanItem, logged: number) {
    const target = TARGET_LABEL[it.target] ?? it.target;
    const w = lastWeightByPlan[it.id] ?? it.weight;
    if (logged > 0) return `已练 ${logged} 组${w > 0 ? ` · ${w} kg` : ''}`;
    return w > 0 ? `${target} · ${w} kg` : target;
  }

  return (
    <section className="today-plan is-free-plan" data-done={allDone || undefined}>
      {err && <p className="start-err" role="alert">{err}</p>}

      {allDone ? (
        <div className="plan-done" role="status">
          <span className="plan-done-mark" aria-hidden="true">
            {items.slice(0, 12).map((it, i, list) => <i key={it.id} style={{ transform: `rotate(${(i * 360 / list.length).toFixed(1)}deg)` }} />)}
            <Icon name="check" size={22} stroke={2.6} />
          </span>
          <span className="plan-done-text">
            <b>今日计划已完成</b>
            <small>{items.length} 个动作{totalLogged ? ` · ${totalLogged} 组` : ''}</small>
          </span>
          <Link href="/train/extra" className="plan-done-toggle">去加练</Link>
        </div>
      ) : activeSession ? (
        <div className="free-live-strip">
          <div className="free-live-info">
            <i aria-hidden="true" />
            <span>训练中 · {startedAt} 开始</span>
            {(activeSession.completedSets ?? 0) > 0 && <small>已记 {activeSession.completedSets} 组</small>}
          </div>
          <EndTrainingButton
            sessionId={activeSession.id}
            completedSets={activeSession.completedSets ?? 0}
            disabled={busy}
            onEnded={() => { haptic(12); router.refresh(); }}
          />
        </div>
      ) : items.length > 0 ? (
        <div className="free-plan-bar">
          <span>今日 {items.length} 个动作</span>
          <small>点任意动作直接开练</small>
        </div>
      ) : null}

      {allDone ? null : items.length === 0 ? (
        <div className="empty-plan">
          <b>今天还没排动作</b>
          <p>按部位自己挑，或者长按底部「记录」说一句「今天练胸，排四个动作」。</p>
          <Link className="ghost-pill" href="/body" prefetch={true}>按部位挑动作</Link>
        </div>
      ) : (
        <ol className="plan-rows">
          {pending.map((it) => {
            const logged = completedByPlan[it.id] ?? 0;
            const confirming = confirmRemove === it.id;
            return (
              <li key={it.id} className="plan-item" data-logged={logged > 0 || undefined}>
                <div className="plan-item-row">
                  <button
                    type="button"
                    className="plan-item-head"
                    disabled={busy}
                    onClick={() => { setConfirmRemove(null); void start(it.id); }}
                  >
                    <span className="thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {images[it.exercise_id] ? <img src={images[it.exercise_id]} alt="" loading="lazy" /> : null}
                    </span>
                    <span className="plan-item-main">
                      <b>{it.supplemental ? <SupplementalMark /> : null}{it.name}</b>
                      <small>{rowSub(it, logged)}</small>
                    </span>
                    {logged > 0 ? (
                      <span className="plan-logged-pill">{logged} 组</span>
                    ) : (
                      <Icon name="chevron-right" size={16} stroke={1.8} className="plan-row-chev" />
                    )}
                  </button>
                  {logged === 0 && (
                    confirming ? (
                      <button type="button" className="plan-rm-confirm" onClick={() => remove(it.id)}>移除</button>
                    ) : (
                      <button
                        type="button"
                        className="plan-item-more"
                        aria-label={`移出${it.name}`}
                        onClick={() => { haptic(4); setConfirmRemove(it.id); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!allDone && (
        <Link href="/body" prefetch={true} className="add-row">
          <span className="add-row-icon" aria-hidden="true"><Icon name="plus" size={18} /></span>
          添加动作
        </Link>
      )}

      {(finished.length > 0 || extraRows.length > 0) && (
        <section className="done-section" aria-label="今日已练">
          <h2 className="v-section-title"><span>今日已练</span>{trained?.summary && <small>{trained.summary}</small>}</h2>
          <ol className="plan-rows done-rows">
            {finished.map((it) => {
              const logged = completedByPlan[it.id] ?? it.sets;
              return (
                <li key={it.id} className="plan-item" data-done>
                  {activeSession ? (
                    <button type="button" className="plan-item-head" disabled={busy} onClick={() => void start(it.id)}>
                      <span className="thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {images[it.exercise_id] ? <img src={images[it.exercise_id]} alt="" loading="lazy" /> : null}
                      </span>
                      <span className="plan-item-main">
                        <b>{it.supplemental ? <SupplementalMark /> : null}{it.name}</b>
                        <small>{rowSub(it, logged)}</small>
                      </span>
                      <span className="done-check" aria-label="已练，点按可继续加组"><Icon name="check" size={15} stroke={2.6} /></span>
                    </button>
                  ) : (
                    <div className="plan-item-head">
                      <span className="thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {images[it.exercise_id] ? <img src={images[it.exercise_id]} alt="" loading="lazy" /> : null}
                      </span>
                      <span className="plan-item-main">
                        <b>{it.supplemental ? <SupplementalMark /> : null}{it.name}</b>
                        <small>{rowSub(it, logged)}</small>
                      </span>
                      <span className="done-check" aria-label="已练"><Icon name="check" size={15} stroke={2.6} /></span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {extraRows.length > 0 && (
            <div className="v-rows">
              {extraRows.map((row) => (
                <Link key={row.key} href={row.href} className="v-row">
                  <span><b>{row.title}</b><small>{row.sub}</small></span>
                  <Icon name="chevron-right" size={18} className="row-chev" />
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
