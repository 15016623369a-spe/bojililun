'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PlanItem } from '@/lib/types';
import { EQUIPMENT_LABEL, TARGET_LABEL } from '@/lib/exercise-label';
import SupplementalMark from './SupplementalMark';
import EndTrainingButton from './EndTrainingButton';
import Stepper from './ui/Stepper';
import Icon from './ui/Icon';

const REST_CHOICES = [60, 90, 120, 180];

function haptic(ms = 6) { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } }

export default function TodayPlan({
  date,
  isToday,
  initialItems,
  images,
  activeSession,
  hasCompletedTraining,
  completedSessionId,
}: {
  date: string;
  isToday: boolean;
  initialItems: PlanItem[];
  images: Record<string, string>;
  activeSession: { id: number; completedSets: number; totalSets: number | null } | null;
  hasCompletedTraining: boolean;
  completedSessionId: number | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<PlanItem[]>(initialItems);
  const [showList, setShowList] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [justEnded, setJustEnded] = useState(false);
  const [recentlyAdded, setRecentlyAdded] = useState<ReadonlySet<number>>(new Set());
  const savedItems = useRef(initialItems);
  const saveQueue = useRef(Promise.resolve());
  const planRows = useRef<HTMLOListElement>(null);
  const startDock = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const added = url.searchParams.getAll('added');
    if (added.length === 0) return;
    const ids = new Set(added.map(Number));
    setRecentlyAdded(new Set(initialItems.filter((item) => ids.has(item.id)).map((item) => item.id)));
    setShowList(true);
    url.searchParams.delete('added');
    window.history.replaceState(null, '', url);
  }, [initialItems, searchParams]);

  useEffect(() => {
    if (recentlyAdded.size === 0) return;
    const first = planRows.current?.querySelector('[data-added]');
    const visibleBottom = startDock.current?.getBoundingClientRect().top ?? window.innerHeight;
    const bounds = first?.getBoundingClientRect();
    if (bounds && (bounds.top < 0 || bounds.bottom > visibleBottom)) {
      first?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        block: 'center',
      });
    }
    const timer = window.setTimeout(() => setRecentlyAdded(new Set()), 3000);
    return () => window.clearTimeout(timer);
  }, [recentlyAdded]);

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
    setJustEnded(false);
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
  const completed = isToday && !activeSession && pendingSets === 0 && (items.length > 0 || hasCompletedTraining);
  const addHref = isToday ? '/body' : `/body?date=${date}`;

  return (
    <section className="today-plan">
      {!activeSession && justEnded && <p className="training-complete" role="status">本次训练已结束</p>}

      {items.length > 0 && (
        <button type="button" className="training-list-toggle" aria-expanded={showList} aria-controls="training-plan-list"
          onClick={() => setShowList(!showList)}>
          {showList ? '收起动作' : `查看 ${items.length} 个动作`}
          <Icon name="chevron-down" size={18} />
        </button>
      )}
      {items.length > 0 && (
        <ol className="plan-rows" ref={planRows} id="training-plan-list" hidden={!showList}>
          {items.map((it) => {
            const expanded = open === it.id;
            return (
              <li key={it.id} className="plan-item" data-open={expanded || undefined} data-done={it.done === 1 || undefined}
                data-added={recentlyAdded.has(it.id) || undefined}>
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
                <div className="plan-item-editor" inert={!expanded} aria-hidden={!expanded}>
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
      <p className="sr-only" role="status">{recentlyAdded.size > 0 ? `已加入 ${recentlyAdded.size} 个动作` : ''}</p>

      {!activeSession && items.length > 0 && !completed && showList && (
        <Link href={addHref} className="add-row">
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
        <div className={activeSession ? 'start-dock training-active-dock' : 'start-dock'} ref={startDock}>
          {activeSession ? (
            <EndTrainingButton key={activeSession.id} sessionId={activeSession.id} completedSets={activeSession.completedSets}
              resumeHref={`/train/${activeSession.id}`} onEnded={() => { setJustEnded(true); router.refresh(); }} />
          ) : isToday && pendingSets > 0 ? (
            <button type="button" className="ink-btn" onClick={start} disabled={busy || saving}>
              <span>{busy ? '正在开始…' : '开始今日训练'}</span>
              <span className="ink-btn-meta">{pendingSets} 组 <Icon name="arrow-right" size={20} /></span>
            </button>
          ) : (
            <Link href={addHref} className="ink-btn">{isToday ? '添加动作' : '安排这天的动作'} <Icon name="plus" size={20} /></Link>
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
