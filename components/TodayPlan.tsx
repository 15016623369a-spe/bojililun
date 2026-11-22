'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { PlanItem } from '@/lib/types';
import { EQUIPMENT_LABEL, TARGET_LABEL } from '@/lib/exercise-label';
import SupplementalMark from './SupplementalMark';
import Stepper from './ui/Stepper';
import Icon from './ui/Icon';

const REST_CHOICES = [60, 90, 120, 180];

function haptic(ms = 6) { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } }

export default function TodayPlan({
  date,
  initialItems,
  images,
  activeSession,
  hasCompletedTraining,
  completedSessionId,
}: {
  date: string;
  initialItems: PlanItem[];
  images: Record<string, string>;
  activeSession: { id: number; completedSets: number; totalSets: number | null } | null;
  hasCompletedTraining: boolean;
  completedSessionId: number | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<PlanItem[]>(initialItems);
  const [open, setOpen] = useState<number | null>(null);
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
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const pendingSets = items.reduce((sum, item) => sum + (item.done ? 0 : item.sets), 0);
  const totalSets = items.reduce((a, x) => a + x.sets, 0);
  const minutes = Math.round(items.reduce((a, x) => a + x.sets * (40 + x.rest_sec), 0) / 60);
  const completed = !activeSession && pendingSets === 0 && (items.length > 0 || hasCompletedTraining);

  return (
    <section className="today-plan">
      {items.length > 0 && !activeSession && <div className="readouts">
        <div className="readout"><b className="big-num">{items.length}</b><span>个</span><em>动作</em></div>
        <div className="readout"><b className="big-num">{totalSets}</b><span>组</span><em>计划组数</em></div>
        <div className="readout"><b className="big-num">{minutes ? `≈${minutes}` : '—'}</b><span>分钟</span><em>含休息</em></div>
      </div>}

      {activeSession && (
        <p className="live-banner">
          <i aria-hidden="true" />训练进行中
          <span>已完成 {activeSession.completedSets}{activeSession.totalSets ? ` / ${activeSession.totalSets}` : ''} 组</span>
        </p>
      )}

      {completed && <p className="training-complete">今日训练已完成</p>}

      {items.length === 0 && !activeSession && !completed && (
        <div className="empty-plan">
          <b>还没有安排动作</b>
        </div>
      )}

      {items.length > 0 && (
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

      {!activeSession && items.length > 0 && !completed && (
        <Link href="/body" className="add-row">
          <span className="add-row-icon" aria-hidden="true"><Icon name="plus" size={18} /></span>添加动作
        </Link>
      )}
      {completed && (
        <div className="completed-actions">
          <Link href={completedSessionId ? `/train/${completedSessionId}` : `/history/${date}`} className="ink-btn">
            {completedSessionId ? '查看本次训练' : '查看今日记录'} <Icon name="arrow-right" size={20} />
          </Link>
          <Link href="/train/extra?from=train" className="ghost-pill">加练</Link>
        </div>
      )}

      {err && <p className="form-err" role="alert">{err}</p>}

      {!completed && (
        <div className="start-dock">
          {activeSession ? (
            <Link href={`/train/${activeSession.id}`} className="ink-btn">继续训练 <Icon name="arrow-right" size={20} /></Link>
          ) : pendingSets > 0 ? (
            <button type="button" className="ink-btn" onClick={start} disabled={busy || saving}>
              <span>{busy ? '正在开始…' : '开始训练'}</span>
              <span className="ink-btn-meta">{pendingSets} 组 <Icon name="arrow-right" size={20} /></span>
            </button>
          ) : (
            <Link href="/body" className="ink-btn">添加动作 <Icon name="plus" size={20} /></Link>
          )}
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
