'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PlanItem, SetRow } from '@/lib/types';
import { buildHorizontalSlots, buildWorkoutTimeline, formatClock, formatHHMM } from '@/lib/timeline';
import { playCheckClick, playChime, playStepTick, unlockChime, useWakeLock } from '@/lib/rest-alert';
import EndTrainingButton from './EndTrainingButton';
import Icon from './ui/Icon';
import TimelineBlockActive, { type DemoMedia } from './TimelineBlockActive';
import HorizontalTimelineDock from './HorizontalTimelineDock';

function haptic(pattern: number | number[] = 8) {
  try { navigator.vibrate?.(pattern); } catch { /* iOS 网页无振动 */ }
}

const e1rm = (w: number, r: number) => (r <= 0 || r > 15 || w <= 0 ? 0 : r === 1 ? w : w * (1 + r / 30));

export type QuickRow = { key: string; title: string; sub: string; href: string };

export default function WorkoutTimeline({
  today,
  initialPlan,
  initialSession,
  initialSets,
  demonstrations,
  priorBest = {},
  quickRows = [],
}: {
  today: string;
  initialPlan: PlanItem[];
  initialSession: { id: number; startedAt: string } | null;
  initialSets: SetRow[];
  demonstrations: Record<string, DemoMedia>;
  priorBest?: Record<string, number>;
  quickRows?: QuickRow[];
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanItem[]>(initialPlan);
  const [session, setSession] = useState(initialSession);
  const [sets, setSets] = useState<SetRow[]>(initialSets);
  const [demoMap, setDemoMap] = useState(demonstrations);
  const [activePlanId, setActivePlanId] = useState<number | null>(() => {
    const lastPid = initialSets.at(-1)?.plan_item_id;
    return lastPid ?? initialPlan[0]?.id ?? null;
  });
  const [lifting, setLifting] = useState<{ planItemId: number; startedAtMs: number } | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { weight: string; reps: string }>>({});
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<{ id: string; zh_name: string; name: string }[]>([]);
  const [addBusyId, setAddBusyId] = useState<string | null>(null);

  const lock = useRef(false);
  const restBuzzed = useRef<number | null>(null);
  const liftKey = `fitcheck-wt-lift:${today}`;

  useEffect(() => { setPlan(initialPlan); }, [initialPlan]);
  useEffect(() => { setSession(initialSession); }, [initialSession]);
  useEffect(() => { setSets(initialSets); }, [initialSets]);
  useEffect(() => { setDemoMap((c) => ({ ...demonstrations, ...c })); }, [demonstrations]);

  useEffect(() => {
    setNowMs(Date.now());
    try {
      const raw = sessionStorage.getItem(liftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { planItemId?: number; startedAtMs?: number };
        if (parsed.planItemId && parsed.startedAtMs) {
          setLifting({ planItemId: parsed.planItemId, startedAtMs: parsed.startedAtMs });
          setActivePlanId(parsed.planItemId);
        }
      }
    } catch { /* ignore */ }
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [liftKey]);

  useEffect(() => {
    if (!addOpen) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`/api/exercises?order=plan&limit=24&q=${encodeURIComponent(addQuery.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d: { items?: { id: string; zh_name: string; name: string }[] }) => setAddResults(d.items ?? []))
        .catch(() => {});
    }, addQuery ? 120 : 0);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [addOpen, addQuery]);

  useWakeLock(Boolean(session || lifting));

  const timeline = buildWorkoutTimeline({
    plan,
    sets,
    activePlanItemId: activePlanId,
    liftingState: lifting,
    nowMs: nowMs ?? Date.parse(`${today}T12:00:00`),
  });

  // 组间歇到达目标时长轻响一次
  useEffect(() => {
    if (!timeline.lastSet || lifting || nowMs === null) return;
    const target = Math.max(15, timeline.lastSet.rest_sec || 90);
    if (timeline.liveRestSec >= target && timeline.liveRestSec <= target + 3 && restBuzzed.current !== timeline.lastSet.id) {
      restBuzzed.current = timeline.lastSet.id;
      haptic([24, 70, 24]);
      playChime();
    }
  }, [timeline.lastSet, timeline.liveRestSec, lifting, nowMs]);

  async function ensureSession(firstPlanItemId: number): Promise<{ id: number; startedAt: string }> {
    if (session) return session;
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guided: true, firstPlanItemId }),
    });
    const data = (await res.json()) as { session?: { id: number; started_at: string }; error?: string };
    if (!res.ok || !data.session) throw new Error(data.error ?? '开始训练失败');
    const created = { id: data.session.id, startedAt: data.session.started_at };
    setSession(created);
    return created;
  }

  async function handleStartLift(planItemId: number) {
    if (busy || lifting) return;
    unlockChime();
    setErr('');
    try {
      await ensureSession(planItemId);
      const next = { planItemId, startedAtMs: Date.now() };
      setLifting(next);
      setActivePlanId(planItemId);
      setNowMs(next.startedAtMs);
      playStepTick();
      haptic(12);
      try { sessionStorage.setItem(liftKey, JSON.stringify(next)); } catch { /* ignore */ }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function handleCancelLift() {
    setLifting(null);
    try { sessionStorage.removeItem(liftKey); } catch { /* ignore */ }
    haptic(6);
  }

  function valuesFor(planItemId: number, fallbackWeight: number, fallbackReps: number) {
    const d = drafts[planItemId];
    return {
      weight: d?.weight ?? String(fallbackWeight),
      reps: d?.reps ?? String(fallbackReps),
    };
  }

  async function handleFinishSet(planItemId: number, fallbackWeight: number, fallbackReps: number) {
    if (lock.current) return;
    const p = plan.find((entry) => entry.id === planItemId);
    if (!p) return;
    const { weight, reps } = valuesFor(planItemId, fallbackWeight, fallbackReps);
    const wVal = Number(weight);
    const rVal = Number(reps);
    if (weight === '' || !Number.isFinite(wVal) || wVal < 0 || wVal > 1000 || !Number.isInteger(rVal) || rVal < 1 || rVal > 1000) {
      setErr('请输入有效的重量和次数');
      return;
    }
    lock.current = true;
    setBusy(true);
    setErr('');
    unlockChime();
    const prior = priorBest[p.exercise_id] ?? 0;
    const isPr = prior > 0 && e1rm(wVal, rVal) > prior + 0.05;
    playCheckClick(isPr);
    haptic(isPr ? [16, 45, 26] : 14);
    try {
      const active = await ensureSession(planItemId);
      const now = Date.now();
      const prev = timeline.lastSet;
      const prevEndMs = prev ? Date.parse(prev.created_at) : Date.parse(active.startedAt);
      const isThisLift = lifting?.planItemId === planItemId;
      const liftStart = isThisLift ? lifting.startedAtMs : null;
      const actualRest = prev ? Math.max(0, Math.round(((liftStart ?? now) - prevEndMs) / 1000)) : undefined;
      const durationSec = liftStart ? Math.max(1, Math.round((now - liftStart) / 1000)) : 0;
      const setIndex = sets.filter((s) => s.plan_item_id === planItemId).length + 1;

      const res = await fetch('/api/session/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: active.id,
          chooseExercise: true,
          freeMode: true,
          planItemId: p.id,
          setIndex,
          exerciseId: p.exercise_id,
          exerciseName: p.name,
          bodyPart: p.body_part,
          target: p.target,
          weight: wVal,
          reps: rVal,
          durationSec,
          restSec: p.rest_sec,
          previousSetId: prev?.id,
          previousRestSec: actualRest,
        }),
      });
      const result = (await res.json()) as { sets?: SetRow[]; error?: string };
      if (!res.ok || !result.sets) throw new Error(result.error || '保存失败，请重试');
      setSets(result.sets);
      setLifting(null);
      try { sessionStorage.removeItem(liftKey); } catch { /* ignore */ }
      setNowMs(Date.now());
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function handleEditSet(id: number, weight: number, reps: number) {
    const res = await fetch('/api/session/set', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, weight, reps }),
    });
    const data = (await res.json()) as { set?: SetRow; error?: string };
    if (!res.ok || !data.set) { setErr(data.error || '修改失败'); return; }
    setSets((cur) => cur.map((s) => (s.id === data.set!.id ? data.set! : s)));
    haptic(8);
  }

  async function handleDeleteSet(id: number) {
    const res = await fetch(`/api/session/set?id=${id}&live=1`, { method: 'DELETE' });
    const data = (await res.json()) as { allSets?: SetRow[]; error?: string };
    if (!res.ok) { setErr(data.error || '删除失败'); return; }
    setSets(data.allSets ?? sets.filter((s) => s.id !== id));
    haptic(8);
  }

  async function removePlanItem(id: number) {
    haptic(6);
    if (activePlanId === id) {
      const idx = slots.findIndex((s) => s.cards[0]?.planItemId === id);
      const neighbor = slots[idx - 1]?.cards[0]?.planItemId ?? slots[idx + 1]?.cards[0]?.planItemId ?? null;
      setActivePlanId(neighbor);
    }
    setPlan((cur) => cur.filter((p) => p.id !== id));
    const res = await fetch(`/api/plan?id=${id}`, { method: 'DELETE' });
    const data = (await res.json().catch(() => ({}))) as { items?: PlanItem[] };
    if (res.ok && data.items) setPlan(data.items);
    router.refresh();
  }

  async function addExercise(exerciseId: string) {
    if (addBusyId) return;
    setAddBusyId(exerciseId);
    setErr('');
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exerciseId, date: today }),
      });
      const data = (await res.json()) as { item?: PlanItem; demonstration?: DemoMedia; error?: string };
      if (!res.ok || !data.item) throw new Error(data.error || '添加失败');
      setPlan((cur) => (cur.some((p) => p.id === data.item!.id) ? cur : [...cur, data.item!]));
      if (data.demonstration) setDemoMap((cur) => ({ ...cur, [data.item!.exercise_id]: data.demonstration! }));
      setAddOpen(false);
      setAddQuery('');
      setActivePlanId(data.item.id);
      haptic(8);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAddBusyId(null);
    }
  }

  function persistOrder(next: PlanItem[]) {
    void fetch('/api/plan', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reorder: next.map((p) => p.id), date: next[0]?.date ?? today }),
    }).catch(() => {});
  }

  const { slots } = buildHorizontalSlots(timeline, null, nowMs ?? Date.parse(`${today}T12:00:00`));

  function handleReorderCard(draggedId: number, targetIdx: number) {
    const firstFutureIdx = slots.findIndex((s) => s.isProjected && s.cards[0]?.planItemId !== lifting?.planItemId);
    if (firstFutureIdx < 0) return;
    const ids = slots.map((s) => s.cards[0]?.planItemId).filter((id): id is number => id != null);
    const fromIdx = ids.indexOf(draggedId);
    // 已练过的历史动作锁定在真实时间轴上，仅允许调整当前时间点之后的待练动作顺序
    if (fromIdx < firstFutureIdx) return;
    const clampedTarget = Math.max(firstFutureIdx, Math.min(ids.length - 1, targetIdx));
    if (clampedTarget === fromIdx) return;
    const nextIds = [...ids];
    const [moved] = nextIds.splice(fromIdx, 1);
    nextIds.splice(clampedTarget, 0, moved);
    const byId = new Map(plan.map((p) => [p.id, p]));
    const reordered = nextIds.map((id) => byId.get(id)).filter((p): p is PlanItem => Boolean(p));
    if (reordered.length > 0) {
      setPlan(reordered);
      persistOrder(reordered);
      setActivePlanId(draggedId);
    }
    haptic(10);
  }

  const allCards = slots.flatMap((s) => s.cards);
  const focusedCard = allCards.find((c) => c.planItemId === activePlanId) ?? allCards[0] ?? null;
  const focusedVals = focusedCard ? valuesFor(focusedCard.planItemId, focusedCard.weight, focusedCard.reps) : { weight: '0', reps: '10' };
  const focusedMedia = focusedCard ? demoMap[focusedCard.exerciseId] : undefined;
  const focusedCount = focusedCard ? sets.filter((s) => s.plan_item_id === focusedCard.planItemId).length : 0;
  const isLiftingFocused = Boolean(focusedCard && lifting?.planItemId === focusedCard.planItemId);
  const liftingCard = lifting ? allCards.find((c) => c.planItemId === lifting.planItemId) : undefined;
  const isSwitching = Boolean(focusedCard && timeline.lastSet && timeline.lastSet.exercise_id !== focusedCard.exerciseId);
  const startedAtText = session ? formatHHMM(Date.parse(session.startedAt)) : '';
  const totalLiftText = timeline.totalLiftSec > 0 ? ` · 力训 ${formatClock(timeline.totalLiftSec)}` : '';

  return (
    <section className="wt-shell">
      {err && <p className="start-err" role="alert">{err}</p>}

      {session ? (
        <div className="free-live-strip">
          <div className="free-live-info">
            <i aria-hidden="true" />
            <span>{startedAtText} 开始 · {timeline.totalSets} 组{totalLiftText}</span>
          </div>
          <EndTrainingButton
            sessionId={session.id}
            completedSets={timeline.totalSets}
            disabled={busy}
            onEnded={() => {
              setSession(null);
              setLifting(null);
              try { sessionStorage.removeItem(liftKey); } catch { /* ignore */ }
              haptic(12);
              router.refresh();
            }}
          />
        </div>
      ) : null}

      {focusedCard ? (
        <div className="wt-stage-box">
          <div className="wt-stage-head is-centered">
            <h2>{focusedCard.name}</h2>
          </div>
          <TimelineBlockActive
            key={focusedCard.planItemId}
            block={focusedCard}
            media={focusedMedia}
            weight={focusedVals.weight}
            reps={focusedVals.reps}
            nextSetNumber={focusedCount + 1}
            isLiftingThis={isLiftingFocused}
            isLiftingOther={Boolean(lifting && !isLiftingFocused)}
            liftingExerciseName={liftingCard?.name}
            hasPriorSet={Boolean(timeline.lastSet)}
            isSwitching={isSwitching}
            liveRestSec={timeline.liveRestSec}
            liveLiftSec={timeline.liveLiftSec}
            busy={busy}
            onWeightChange={(w) => setDrafts((c) => ({ ...c, [focusedCard.planItemId]: { ...focusedVals, weight: w } }))}
            onRepsChange={(r) => setDrafts((c) => ({ ...c, [focusedCard.planItemId]: { ...focusedVals, reps: r } }))}
            onStartLift={() => void handleStartLift(focusedCard.planItemId)}
            onCancelLift={handleCancelLift}
            onFinishSet={() => void handleFinishSet(focusedCard.planItemId, focusedCard.weight, focusedCard.reps)}
            onJumpToLifting={() => { if (lifting) setActivePlanId(lifting.planItemId); }}
            onEditSet={handleEditSet}
            onDeleteSet={handleDeleteSet}
          />
        </div>
      ) : (
        <div className="empty-plan">
          <b>今天的时间轴还是空的</b>
          <p>点下方「+ 加动作」添加今天要练的动作。</p>
          <button type="button" className="ghost-pill" onClick={() => setAddOpen(true)}>添加第一个动作</button>
        </div>
      )}

      <HorizontalTimelineDock
        slots={slots}
        activePlanId={focusedCard?.planItemId ?? null}
        liftingPlanId={lifting?.planItemId ?? null}
        liveLiftSec={timeline.liveLiftSec}
        demoMap={demoMap}
        nowReady={nowMs !== null}
        onSelect={(id) => { setActivePlanId(id); haptic(5); }}
        onReorder={handleReorderCard}
        onRemove={(id) => void removePlanItem(id)}
        onOpenAdd={() => setAddOpen(true)}
      />

      {quickRows.length > 0 && (
        <section className="done-section" aria-label="其他记录">
          <h2 className="v-section-title"><span>语音与文字记录</span></h2>
          <div className="v-rows">
            {quickRows.map((row) => (
              <Link key={row.key} href={row.href} className="v-row">
                <span><b>{row.title}</b><small>{row.sub}</small></span>
                <Icon name="chevron-right" size={18} className="row-chev" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {addOpen && (
        <div className="demo-sheet" role="dialog" aria-modal="true" aria-label="在时间轴添加动作" onClick={() => setAddOpen(false)}>
          <div className="demo-card rn-add-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="demo-card-head">
              <b>添加训练动作</b>
              <button type="button" className="chip" onClick={() => setAddOpen(false)}>关闭</button>
            </div>
            <input className="rn-add-search" type="search" autoFocus placeholder="搜动作名，如 卧推、深蹲、侧平举…" value={addQuery} onChange={(e) => setAddQuery(e.target.value)} />
            <ul className="rn-add-list">
              {addResults.length === 0 ? (
                <li className="rn-add-empty">没有找到对应动作</li>
              ) : (
                addResults.map((ex) => {
                  const existing = plan.find((p) => p.exercise_id === ex.id);
                  return (
                    <li key={ex.id}>
                      <button
                        type="button"
                        disabled={Boolean(addBusyId)}
                        onClick={() => {
                          if (existing) {
                            setAddOpen(false);
                            setAddQuery('');
                            setActivePlanId(existing.id);
                            haptic(6);
                            return;
                          }
                          void addExercise(ex.id);
                        }}
                      >
                        <span>{ex.zh_name || ex.name}</span>
                        <small>{existing ? '已在计划' : addBusyId === ex.id ? '加入中…' : '加入'}</small>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
