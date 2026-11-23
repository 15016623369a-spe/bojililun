'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { PlanItem } from '@/lib/types';
import { EQUIPMENT_LABEL, TARGET_LABEL } from '@/lib/exercise-label';
import SupplementalMark from './SupplementalMark';
import Stepper from './ui/Stepper';
import Icon from './ui/Icon';
import EndTrainingButton from './EndTrainingButton';

const REST_CHOICES = [60, 90, 120, 180];

function haptic(ms = 6) { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } }

export default function TodayPlan({
  initialItems,
  images,
  activeSession,
}: {
  initialItems: PlanItem[];
  images: Record<string, string>;
  activeSession: { id: number; startedAt: string; next?: { name: string; setsLeft: number }; completedSets?: number } | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<PlanItem[]>(initialItems);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showDone, setShowDone] = useState(false);
  const savedItems = useRef(initialItems);
  const saveQueue = useRef(Promise.resolve());

  function save(url: string, options: RequestInit) {
    setSaving(true);
    setErr('');
    const request = saveQueue.current.then(async () => {
      try {
        const res = await fetch(url, options);
        const data = (await res.json()) as { items?: PlanItem[]; error?: string };
        if (!res.ok || !data.items) throw new Error(data.error ?? '保存计划失败');
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

  function patch(id: number, body: Record<string, number>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...mapPatch(body) } : it)));
    save('/api/plan', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    });
  }

  function remove(id: number) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setOpen(null);
    save(`/api/plan?id=${id}`, { method: 'DELETE' });
  }

  async function start() {
    if (busy || saving) return;
    if (activeSession) {
      router.push(`/train/${activeSession.id}`);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guided: true }),
      });
      const data = (await res.json()) as { session?: { id: number }; error?: string };
      if (!res.ok || !data.session) throw new Error(data.error ?? '开始训练失败');
      haptic(14);
      router.push(`/train/${data.session.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const totalSets = items.reduce((a, x) => a + x.sets, 0);
  const doneCount = items.filter((x) => x.done === 1).length;
  // 计划里的动作都练完了：不再显示一张待办清单，主按钮改成加练
  const allDone = items.length > 0 && doneCount === items.length && !activeSession;
  const remainingSets = items.filter((x) => x.done !== 1).reduce((a, x) => a + x.sets, 0);
  const minutes = Math.round(items.reduce((a, x) => a + x.sets * (40 + x.rest_sec), 0) / 60);
  const startedAt = activeSession ? new Date(activeSession.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <section className="today-plan" data-done={allDone || undefined}>
      {allDone ? (
        <div className="plan-done" role="status">
          <span className="plan-done-mark" aria-hidden="true">
            {items.slice(0, 12).map((it, i, list) => <i key={it.id} style={{ transform: `rotate(${(i * 360 / list.length).toFixed(1)}deg)` }} />)}
            <Icon name="check" size={22} stroke={2.6} />
          </span>
          <span className="plan-done-text">
            <b>今日计划已完成</b>
            <small>{items.length} 个动作 · {totalSets} 组</small>
          </span>
          <button type="button" className="plan-done-toggle" aria-expanded={showDone} onClick={() => { haptic(4); setShowDone((v) => !v); }}>
            {showDone ? '收起' : '看清单'}<Icon name="chevron-down" size={15} stroke={2} />
          </button>
        </div>
      ) : (
        <div className="readouts">
          <div className="readout"><b className="big-num">{items.length}</b><span>个</span><em>{doneCount ? `动作 · 已练 ${doneCount}` : '动作'}</em></div>
          <div className="readout"><b className="big-num">{totalSets}</b><span>组</span><em>计划组数</em></div>
          <div className="readout"><b className="big-num">{minutes ? `≈${minutes}` : '—'}</b><span>分钟</span><em>含休息</em></div>
        </div>
      )}

      {activeSession && (
        <Link href={`/train/${activeSession.id}`} className="live-banner">
          <i aria-hidden="true" />训练进行中 · {startedAt} 开始<span>继续 <Icon name="arrow-right" size={16} stroke={2} /></span>
        </Link>
      )}
      {activeSession && (
        <div className="live-end">
          <EndTrainingButton sessionId={activeSession.id} completedSets={activeSession.completedSets ?? 0} disabled={busy}
            onEnded={() => { haptic(12); router.refresh(); }} />
        </div>
      )}

      {allDone && !showDone ? null : items.length === 0 ? (
        <div className="empty-plan">
          <b>还没有安排动作</b>
          <p>回到人体上点一块肌肉挑几个动作，或者直接说「今天练胸，给我排四个动作」。</p>
          <Link className="ghost-pill" href="/body" prefetch={true}>去点选肌群</Link>
        </div>
      ) : (
        <ol className="plan-rows">
          {items.map((it) => {
            const expanded = open === it.id;
            return (
              <li key={it.id} className="plan-item" data-open={expanded || undefined} data-done={it.done === 1 || undefined}>
                <button type="button" className="plan-item-head" aria-expanded={expanded} onClick={() => { haptic(4); setOpen(expanded ? null : it.id); }}>
                  <span className="thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {images[it.exercise_id] ? <img src={images[it.exercise_id]} alt="" loading="lazy" /> : null}
                  </span>
                  <span className="plan-item-main">
                    <b>{it.supplemental ? <SupplementalMark /> : null}{it.name}{it.done === 1 && <em className="tag">已练</em>}</b>
                    <small>{it.sets} × {it.reps} · {it.weight ? `${it.weight} kg` : '自重'}<span className="sep">·</span>{TARGET_LABEL[it.target] ?? it.target}</small>
                  </span>
                  <span className="set-dots" aria-label={`${it.sets} 组`}>
                    {Array.from({ length: Math.min(it.sets, 8) }, (_, i) => <i key={i} data-on={it.done === 1 || undefined} />)}
                  </span>
                </button>
                <div className="plan-item-editor" aria-hidden={!expanded}>
                  <div className="plan-item-editor-inner">
                    <div className="steppers">
                      <Stepper label="组数" value={it.sets} unit="组" step={1} min={1} max={20} onChange={(v) => patch(it.id, { sets: v })} />
                      <Stepper label="次数" value={it.reps} unit="次" step={1} min={1} max={50} onChange={(v) => patch(it.id, { reps: v })} />
                      <Stepper label="重量" value={it.weight} unit="kg" step={2.5} min={0} max={500} onChange={(v) => patch(it.id, { weight: v })} />
                    </div>
                    <div className="rest-seg" role="radiogroup" aria-label="组间休息">
                      <span>组间休息</span>
                      {REST_CHOICES.map((r) => (
                        <button key={r} type="button" role="radio" aria-checked={it.rest_sec === r} className={it.rest_sec === r ? 'on' : ''}
                          onClick={() => { haptic(4); patch(it.id, { restSec: r }); }}>{r}<em>s</em></button>
                      ))}
                    </div>
                    <div className="plan-item-foot">
                      <span>{EQUIPMENT_LABEL[it.equipment] ?? it.equipment}</span>
                      <button type="button" className="text-danger" onClick={() => remove(it.id)}>从计划移除</button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!allDone && <Link href="/body" prefetch={true} className="add-row">
        <span className="add-row-icon" aria-hidden="true"><Icon name="plus" size={18} /></span>从动作库添加 · 也可以说「再加一个飞鸟」
      </Link>}

      {items.length > 0 && (
        <div className="start-dock">
          {err && <p className="start-err" role="alert">{err}</p>}
          <button type="button" className="ink-btn" data-extra={allDone || undefined} disabled={busy || saving}
            onClick={allDone ? () => { haptic(10); router.push('/train/extra'); } : start}>
            <span>{busy ? '正在开始…' : activeSession ? '继续训练' : allDone ? '再加一组' : doneCount ? '接着练' : '开始训练'}</span>
            <span className="ink-btn-meta">{activeSession?.next ? `${activeSession.next.name} · 剩 ${activeSession.next.setsLeft} 组`
              : allDone ? '今日计划已完成' : doneCount ? `剩 ${remainingSets} 组` : `${totalSets} 组`}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
            </span>
          </button>
        </div>
      )}
    </section>
  );
}

function mapPatch(body: Record<string, number>): Partial<PlanItem> {
  const out: Record<string, number> = {};
  if (body.sets !== undefined) out.sets = body.sets;
  if (body.reps !== undefined) out.reps = body.reps;
  if (body.weight !== undefined) out.weight = body.weight;
  if (body.restSec !== undefined) out.rest_sec = body.restSec;
  return out as Partial<PlanItem>;
}
