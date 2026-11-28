'use client';

import Link from 'next/link';
import TrainingExercisePicker from './TrainingExercisePicker';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { PlanItem, SessionRow, SetRow } from '@/lib/types';
import ExerciseMedia from './ExerciseMedia';
import DotDigits from './ui/DotDigits';
import HalftoneImage from './ui/HalftoneImage';
import { playCheckClick, playChime, playStepTick, unlockChime, useWakeLock } from '@/lib/rest-alert';
import type { SculptureVariant } from '@/lib/sculpture-groups';
import Icon from './ui/Icon';

function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function haptic(pattern: number | number[] = 8) {
  try { navigator.vibrate?.(pattern); } catch { /* iOS 网页无振动 */ }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function hhmm(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const e1rm = (weight: number, reps: number) =>
  reps <= 0 || reps > 15 || weight <= 0 ? 0 : reps === 1 ? weight : weight * (1 + reps / 30);

type RestPhase = 'idle' | 'lifting' | 'recovering' | 'ready' | 'long' | 'gap';

/** 组间歇语义色相：恢复中（雾蓝）→ 可开组（绿）→ 偏长（珊瑚）→ 间隔（灰） */
function restPhase(seconds: number, targetSec: number, live: boolean): RestPhase {
  const target = Math.max(15, targetSec || 90);
  const longAt = Math.round(target * 1.5);
  if (seconds > 600) return 'gap';
  if (seconds > longAt) return 'long';
  if (live) return seconds >= target ? 'ready' : 'recovering';
  return seconds >= Math.round(target * 0.7) ? 'ready' : 'recovering';
}

export default function TrainingRunner({
  session,
  plan,
  initialSets,
  demonstrations,
  priorBest = {},
  initialItemId = null,
  receiptHref = '/train',
}: {
  session: SessionRow;
  plan: PlanItem[];
  initialSets: SetRow[];
  demonstrations: Record<string, { image?: string; hasAnimation: boolean; hasSculpture?: boolean; mp4Url?: string }>;
  priorBest?: Record<string, number>;
  variant?: SculptureVariant;
  /** 从今日训练点选具体动作直达时，直接落在该动作 */
  initialItemId?: number | null;
  /** 训练结束后回到哪里：当天的训练单，或过去那天的详情 */
  receiptHref?: string;
}) {
  const router = useRouter();
  const [planList, setPlanList] = useState(plan);
  const [demoMap, setDemoMap] = useState(demonstrations);
  const [sets, setSets] = useState(initialSets);
  const [chosen, setChosen] = useState<number | null>(initialItemId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState<'weight' | 'reps' | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusyId, setAddBusyId] = useState<string | null>(null);
  const actionsKey = `fitcheck-training-action:${session.id}`;
  useEffect(() => { setPlanList(plan); }, [plan]);
  useEffect(() => { setDemoMap((cur) => ({ ...demonstrations, ...cur })); }, [demonstrations]);
  // 自由选择任意动作：默认落在第一个未达计划组数的动作，也可随时切换去已达标动作加组
  const firstUnfinished = planList.find((entry) => sets.filter((s) => s.plan_item_id === entry.id).length < entry.sets);
  const activeItem = planList.find((entry) => entry.id === chosen) ?? firstUnfinished ?? planList[0];
  const activeIndex = activeItem ? planList.findIndex((entry) => entry.id === activeItem.id) : -1;
  const activeItemSets = activeItem ? sets.filter((s) => s.plan_item_id === activeItem.id) : [];
  const current = activeItem ? { item: activeItem, index: activeIndex, number: activeItemSets.length + 1 } : undefined;
  const previous = sets.at(-1);
  const key = `fitcheck-training:${session.id}:${current?.item.id}:${current?.number}`;

  // 两拍分段计时：liftingAt 非空表示正在做力训，为空表示组间休息/准备开组
  const liftKey = `fitcheck-training-lift:${session.id}`;
  const [liftingAt, setLiftingAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [fields, setFields] = useState<{ key: string; weight: string; reps: string } | null>(null);
  const [editingSet, setEditingSet] = useState<{ id: number; setIndex: number; weight: string; reps: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [justDoneId, setJustDoneId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const dragStartY = useRef(0);
  const dragMoved = useRef(false);
  const planListRef = useRef(planList);
  planListRef.current = planList;
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(Boolean(session.ended_at));
  const [error, setError] = useState('');
  const [demo, setDemo] = useState(false);
  const lock = useRef(false);
  const restBuzzed = useRef<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    try {
      const savedLift = Number(sessionStorage.getItem(liftKey));
      if (savedLift > 0) setLiftingAt(savedLift);
    } catch { /* 忽略存储异常 */ }
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [liftKey]);

  function startLift() {
    unlockChime();
    const ts = Date.now();
    setLiftingAt(ts);
    setNow(ts);
    setAdjustOpen(null);
    playStepTick();
    haptic(12);
    try { sessionStorage.setItem(liftKey, String(ts)); } catch { /* 当次仍生效 */ }
  }

  function cancelLift() {
    setLiftingAt(null);
    try { sessionStorage.removeItem(liftKey); } catch { /* 忽略 */ }
    haptic(6);
  }

  function persistPlanOrder(next: PlanItem[]) {
    void fetch('/api/plan', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reorder: next.map((p) => p.id), date: session.date }),
    }).catch(() => {});
  }

  useEffect(() => {
    try {
      const draft = sessionStorage.getItem(`${key}:fields`);
      if (draft) setFields({ key, ...JSON.parse(draft) });
    } catch {
      /* 浏览器存储不可用时仍可训练 */
    }
  }, [key]);

  useEffect(() => {
    try {
      if (initialItemId) {
        setChosen(initialItemId);
        sessionStorage.setItem(actionsKey, String(initialItemId));
        return;
      }
      const stored = Number(sessionStorage.getItem(actionsKey));
      if (stored > 0) setChosen(stored);
    } catch {
      /* 浏览器存储不可用时从待练动作继续 */
    }
  }, [actionsKey, initialItemId]);

  function chooseAction(id: number) {
    setChosen(id);
    setMenuOpen(false);
    setConfirmEnd(false);
    setAdjustOpen(null);
    setDemo(false);
    setEditingSet(null);
    setError('');
    try { sessionStorage.setItem(actionsKey, String(id)); } catch { /* 当次切换仍生效 */ }
    haptic(8);
  }

  async function addExerciseMidSession(exerciseId: string) {
    if (addBusyId) return;
    setAddBusyId(exerciseId);
    setError('');
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exerciseId, date: session.date }),
      });
      const data = (await res.json()) as {
        item?: PlanItem;
        demonstration?: { image?: string; hasAnimation: boolean; hasSculpture?: boolean; mp4Url?: string };
        error?: string;
      };
      if (!res.ok || !data.item) throw new Error(data.error || '添加动作失败');
      setPlanList((cur) => (cur.some((entry) => entry.id === data.item!.id) ? cur : [...cur, data.item!]));
      if (data.demonstration) {
        setDemoMap((cur) => ({ ...cur, [data.item!.exercise_id]: data.demonstration! }));
      }
      setAddOpen(false);
      chooseAction(data.item.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddBusyId(null);
    }
  }

  const item = current?.item;
  const demoMedia = item ? demoMap[item.exercise_id] : undefined;
  const totalSets = planList.reduce((sum, entry) => sum + entry.sets, 0);
  const sessionSeconds = now === null ? 0 : Math.max(0, Math.floor((now - Date.parse(session.started_at)) / 1000));
  const allPlannedMet = planList.length > 0 && planList.every((entry) => sets.filter((s) => s.plan_item_id === entry.id).length >= entry.sets);

  // 苹果秒表式正计时：上一组完成后从 00:00 静静往上走，到点轻响不打断
  const targetRestSec = previous ? Math.max(15, previous.rest_sec || 90) : (item?.rest_sec || 90);
  const sincePrevSec = previous && now !== null ? Math.max(0, Math.floor((now - Date.parse(previous.created_at)) / 1000)) : 0;

  // 下一组默认沿用这个动作上一组的重量与次数；还没练过就用计划里的配置
  const lastOfItem = item ? sets.filter((s) => s.plan_item_id === item.id).at(-1) : undefined;
  const weight = item && fields?.key === key ? fields.weight : String(lastOfItem?.weight ?? item?.weight ?? 0);
  const reps = item && fields?.key === key ? fields.reps : String(lastOfItem?.reps ?? item?.reps ?? 10);

  // 屏幕常亮
  useWakeLock(!ended);

  // 正计时首次到达目标休息时长时轻响提示（只提醒一次，不弹窗不打断）
  useEffect(() => {
    if (!previous || ended || !current || now === null) return;
    if (sincePrevSec >= targetRestSec && sincePrevSec <= targetRestSec + 3 && restBuzzed.current !== previous.id) {
      restBuzzed.current = previous.id;
      haptic([24, 70, 24]);
      playChime();
    }
  }, [previous, ended, current, now, sincePrevSec, targetRestSec]);

  async function saveEditedSet() {
    if (!editingSet || editBusy) return;
    const w = Number(editingSet.weight);
    const r = Number(editingSet.reps);
    if (!Number.isFinite(w) || w < 0 || w > 1000 || !Number.isInteger(r) || r < 1 || r > 1000) {
      setError('请输入有效的重量和次数');
      return;
    }
    setEditBusy(true);
    setError('');
    try {
      const res = await fetch('/api/session/set', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: editingSet.id, weight: w, reps: r }),
      });
      const data = (await res.json()) as { set?: SetRow; error?: string };
      if (!res.ok || !data.set) throw new Error(data.error || '修改失败');
      setSets((cur) => cur.map((s) => (s.id === data.set!.id ? data.set! : s)));
      setEditingSet(null);
      haptic(8);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEditBusy(false);
    }
  }

  async function removeSet(id: number) {
    if (editBusy) return;
    setEditBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/session/set?id=${id}&live=1`, { method: 'DELETE' });
      const data = (await res.json()) as { allSets?: SetRow[]; error?: string };
      if (!res.ok) throw new Error(data.error || '撤回失败');
      if (data.allSets) setSets(data.allSets);
      else setSets((cur) => cur.filter((s) => s.id !== id));
      setEditingSet(null);
      haptic(8);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEditBusy(false);
    }
  }

  async function save(finishEarly: boolean) {
    if (lock.current || (!finishEarly && !current)) return;
    if (!finishEarly) unlockChime();
    if (
      !finishEarly &&
      (weight === '' ||
        !Number.isFinite(Number(weight)) ||
        Number(weight) < 0 ||
        Number(weight) > 1000 ||
        !Number.isInteger(Number(reps)) ||
        Number(reps) < 1 ||
        Number(reps) > 1000)
    ) {
      setError('请输入有效的重量和次数');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    const finishing = finishEarly || !current;
    const wVal = Number(weight);
    const rVal = Number(reps);
    const prior = !finishing && current ? (priorBest[current.item.exercise_id] ?? 0) : 0;
    const isPrSet = Boolean(!finishing && prior > 0 && e1rm(wVal, rVal) > prior + 0.05);
    if (!finishing) {
      playCheckClick(isPrSet);
      haptic(isPrSet ? [16, 45, 26] : 14);
    }
    try {
      const nowMs = Date.now();
      const prevEndMs = previous ? Date.parse(previous.created_at) : Date.parse(session.started_at);
      // 有主动按「开组」时精确拆分：休息时长 = 开组时刻 - 上组结束；力训时长 = 完组时刻 - 开组时刻
      const actualRest = previous
        ? Math.max(0, Math.round(((liftingAt ?? nowMs) - prevEndMs) / 1000))
        : undefined;
      const liftDuration = liftingAt ? Math.max(1, Math.round((nowMs - liftingAt) / 1000)) : 0;

      const response = await fetch(finishing ? '/api/session' : '/api/session/set', {
        method: finishing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          finishing
            ? { id: session.id }
            : {
                sessionId: session.id,
                chooseExercise: true,
                freeMode: true,
                planItemId: current.item.id,
                setIndex: current.number,
                exerciseId: current.item.exercise_id,
                exerciseName: current.item.name,
                bodyPart: current.item.body_part,
                target: current.item.target,
                weight: wVal,
                reps: rVal,
                durationSec: liftDuration,
                restSec: current.item.rest_sec,
                previousSetId: previous?.id,
                previousRestSec: actualRest,
              },
        ),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存失败，请重试');
      if (result.sets) {
        setSets(result.sets);
        if (!finishing) {
          const newest = (result.sets as SetRow[]).at(-1);
          if (newest) setJustDoneId(newest.id);
        }
      }
      if (!finishing) {
        setEditingSet(null);
        setAdjustOpen(null);
        setLiftingAt(null);
        try { sessionStorage.removeItem(liftKey); } catch { /* 忽略 */ }
      }
      try {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(`${key}:fields`);
      } catch {
        /* 缓存清理不影响已保存的数据 */
      }
      setNow(Date.now());
      if (finishing) {
        setMenuOpen(false);
        setConfirmEnd(false);
        setEnded(true);
        if (sets.length === 0) router.replace(receiptHref);
        router.refresh();
      } else if (result.ended) {
        setEnded(true);
        haptic([18, 60, 18, 60, 30]);
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  // ---------- 已结束且没有组 ----------
  if (ended && sets.length === 0) {
    return (
      <div className="runner v-runner" data-mode="done">
        <header className="runner-head">
          <Link className="runner-back" href="/log">
            <Icon name="chevron-left" size={20} stroke={2} />记录
          </Link>
        </header>
        <main className="runner-main runner-ended">
          <h1>训练已结束</h1>
          <Link className="ink-btn" href="/log">
            <span>查看今天的记录</span>
            <span className="ink-btn-meta">
              <Icon name="arrow-right" size={20} />
            </span>
          </Link>
        </main>
      </div>
    );
  }

  // ---------- 全部完成或已归档：小结 ----------
  if (ended || !current || !item) {
    const done = sets;
    const volume = done.reduce((sum, s) => sum + s.weight * s.reps, 0);
    const lastEnd = done.length ? Date.parse(done.at(-1)!.created_at) : Date.now();
    const duration = Math.max(0, Math.round((lastEnd - Date.parse(session.started_at)) / 1000));
    const byExercise = planList
      .map((p) => {
        const rows = done.filter((s) => s.plan_item_id === p.id);
        const best = Math.max(0, ...rows.map((s) => e1rm(s.weight, s.reps)));
        const top = rows.reduce<SetRow | null>(
          (a, s) => (!a || e1rm(s.weight, s.reps) > e1rm(a.weight, a.reps) ? s : a),
          null,
        );
        return {
          item: p,
          volume: rows.reduce((a, s) => a + s.weight * s.reps, 0),
          best,
          top,
          prior: priorBest[p.exercise_id] ?? 0,
        };
      })
      .filter((row) => row.top);
    const records = byExercise
      .filter((row) => row.prior > 0 && row.best > row.prior + 0.05)
      .sort((a, b) => b.best - b.prior - (a.best - a.prior));
    const pr = records[0];
    const maxVolume = Math.max(1, ...byExercise.map((row) => row.volume));
    const span = Math.max(1, lastEnd - Date.parse(session.started_at));
    const time = clock(duration);
    return (
      <div className="runner v-runner" data-mode="summary">
        <header className="runner-head">
          <Link className="runner-back" href="/train">
            <Icon name="chevron-left" size={20} stroke={2} />今日训练
          </Link>
          <span className="runner-head-meta">训练完成</span>
        </header>
        <main className="runner-main">
          {done.length === 0 ? (
            <div className="runner-ended">
              <h1>这节训练没有动作</h1>
              <button type="button" className="ink-btn" onClick={() => void save(true)} disabled={busy}>
                <span>{busy ? '正在结束…' : '结束训练'}</span>
              </button>
              {error && <p className="form-err" role="alert">{error}</p>}
            </div>
          ) : (
            <>
              <section className="summary-time">
                <p className="kicker"><i aria-hidden="true" />总时长</p>
                <DotDigits text={time} cell={10} dimFrom={time.length - 2} label={`总时长 ${time}`} />
                <div className="summary-track" aria-hidden="true">
                  {Array.from({ length: 72 }, (_, i) => <i key={i} />)}
                  {done.map((s) => {
                    const at = (Date.parse(s.created_at) - Date.parse(session.started_at)) / span;
                    return (
                      <b
                        key={s.id}
                        style={{
                          left: `${Math.min(100, Math.max(0, at * 100)).toFixed(2)}%`,
                          height: `${28 + Math.min(1, (s.weight * s.reps) / (maxVolume / 2 || 1)) * 46}%`,
                        }}
                      />
                    );
                  })}
                </div>
                <div className="summary-axis">
                  <span>{new Date(session.started_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>{new Date(lastEnd).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </section>
              <div className="summary-cards">
                <div className="tile lemon">
                  <p className="kicker"><i className="ring" aria-hidden="true" />训练容量</p>
                  <div className="tile-num"><b className="big-num">{Math.round(volume).toLocaleString()}</b><em>kg</em></div>
                </div>
                <div className="tile">
                  <p className="kicker"><i className="ring" aria-hidden="true" />完成组数</p>
                  <div className="tile-num"><b className="big-num">{done.length}<span className="dim">/{totalSets}</span></b></div>
                </div>
              </div>
              {pr && (
                <div className="tile lilac pr-tile">
                  <p className="kicker">
                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 2c0 6 4 10 10 10-6 0-10 4-10 10 0-6-4-10-10-10 6 0 10-4 10-10Z" fill="currentColor" />
                    </svg>
                    新纪录 · {pr.item.name}<span>估算 1RM</span>
                  </p>
                  <div className="tile-num">
                    <b className="big-num">{pr.best.toFixed(1).replace(/\.0$/, '')}</b><em>kg</em>
                    <small>
                      <Icon name="arrow-up" size={13} stroke={2.2} /> {(pr.best - pr.prior).toFixed(1)} kg · {pr.top!.weight} kg × {pr.top!.reps}
                    </small>
                  </div>
                </div>
              )}
              <ul className="summary-list">
                {byExercise.map((row) => (
                  <li key={row.item.id}>
                    <span className="name">{row.item.name}</span>
                    <span className="meter-ticks" aria-hidden="true">
                      {Array.from({ length: 36 }, (_, i) => (
                        <i key={i} data-on={i < Math.round((row.volume / maxVolume) * 36) || undefined} />
                      ))}
                    </span>
                    <span className="val">{row.volume ? `${Math.round(row.volume).toLocaleString()} kg` : '自重'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </main>
        {done.length > 0 && (
          <footer className="runner-foot">
            {error && <p className="form-err" role="alert">{error}</p>}
            <button
              type="button"
              className="ink-btn"
              disabled={busy}
              onClick={() => {
                if (ended) {
                  router.replace(receiptHref);
                  router.refresh();
                } else {
                  void save(true);
                }
              }}
            >
              <span>{busy ? '正在保存…' : ended ? '完成，回到训练' : '保存这节训练'}</span>
              <span className="ink-btn-meta">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              </span>
            </button>
          </footer>
        )}
      </div>
    );
  }

  // ---------- 正在训练：苹果秒表极简自由 × 清晰健身语义 ----------
  const itemSets = activeItemSets;
  const weightNum = Number(weight) || 0;
  const repsNum = Number(reps) || 0;

  // 仅当组间确有高低差时，轻标最佳那一组（相同重量和次数不无意义变绿）
  const bestSetId = (() => {
    if (itemSets.length < 2) return null;
    const score = (s: SetRow) => e1rm(s.weight, s.reps) || s.weight * s.reps || s.reps;
    const scores = itemSets.map(score);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    if (maxScore <= minScore) return null;
    return itemSets[scores.indexOf(maxScore)]?.id ?? null;
  })();

  function restBetween(earlier: SetRow, later: SetRow): number | null {
    if (earlier.actual_rest_sec != null && earlier.actual_rest_sec > 0) return earlier.actual_rest_sec;
    const raw = Math.round((Date.parse(later.created_at) - Date.parse(earlier.created_at)) / 1000);
    const diff = raw - (later.duration_sec || 0);
    return diff > 0 ? diff : null;
  }

  const isLifting = liftingAt !== null;
  const liftingSec = liftingAt && now !== null ? Math.max(0, Math.floor((now - liftingAt) / 1000)) : 0;
  const lockedRestSec = liftingAt && previous ? Math.max(0, Math.round((liftingAt - Date.parse(previous.created_at)) / 1000)) : null;
  const isSwitching = Boolean(previous && previous.exercise_id !== item.exercise_id);
  const livePhase: RestPhase = isLifting ? 'lifting' : previous ? restPhase(sincePrevSec, targetRestSec, true) : 'idle';
  const liveClock = isLifting ? clock(liftingSec) : previous ? clock(sincePrevSec) : '00:00';
  const liveCaption = isLifting
    ? `力训中 · 第 ${current.number} 组`
    : livePhase === 'idle'
      ? '准备开组 · 点右侧开始计时'
      : livePhase === 'recovering'
        ? `${isSwitching ? '换项休息' : '组间休息'} · 目标 ${clock(targetRestSec)}`
        : livePhase === 'ready'
          ? `${isSwitching ? '换项就绪' : '已休满'} · 可开下组`
          : livePhase === 'long'
            ? `${isSwitching ? '换项偏长' : '休息偏长'}`
            : '距上一组';
  const showWeightKg = weightNum > 0;
  const weightText = showWeightKg ? `${weight}` : '自重';
  const setTag = current.number > item.sets ? `第 ${current.number} 组 · 加练` : `第 ${current.number} 组`;

  function setField(patch: Partial<{ weight: string; reps: string }>) {
    const next = { key, weight, reps, ...patch };
    setFields(next);
    try {
      sessionStorage.setItem(`${key}:fields`, JSON.stringify({ weight: next.weight, reps: next.reps }));
    } catch {
      /* 当前页面仍可调整 */
    }
  }

  function stepWeight(delta: number) {
    haptic(5);
    playStepTick();
    setField({ weight: String(Math.max(0, Math.min(500, +(weightNum + delta).toFixed(2)))) });
  }

  function stepReps(delta: number) {
    haptic(5);
    playStepTick();
    setField({ reps: String(Math.max(1, repsNum + delta)) });
  }

  return (
    <div className="runner v-runner is-min-runner" data-mode="set">
      <div className="rn-min-stage">
        <header className="rn-min-head">
          <Link className="rn-min-icon-btn" href="/train" aria-label="返回今日训练">
            <Icon name="chevron-left" size={22} stroke={1.9} />
          </Link>
          <button
            type="button"
            className="rn-min-title"
            onClick={() => demoMedia?.image && setDemo(true)}
            aria-label={demoMedia?.image ? `${item.name}，点按查看演示` : item.name}
          >
            <h1>{item.name}</h1>
          </button>
          <button
            type="button"
            className="rn-min-icon-btn"
            data-ready={allPlannedMet || undefined}
            aria-expanded={menuOpen}
            aria-label="更多操作"
            onClick={() => {
              setMenuOpen((v) => !v);
              setConfirmEnd(false);
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>

          {menuOpen && (
            <div className="rn-min-menu" role="menu">
              <div className="rn-min-menu-meta">
                <span>已练 {clock(sessionSeconds)}</span>
                <span>{sets.length} 组</span>
              </div>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setAddOpen(true); }}>
                中途添加动作
              </button>
              {demoMedia?.image && (
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDemo(true); }}>
                  动作演示
                </button>
              )}
              {confirmEnd ? (
                <div className="rn-min-menu-confirm">
                  <button type="button" className="is-danger" disabled={busy} onClick={() => void save(true)}>
                    {busy ? '正在结束…' : '确认结束训练'}
                  </button>
                  <button type="button" onClick={() => setConfirmEnd(false)}>取消</button>
                </div>
              ) : (
                <button type="button" role="menuitem" className="is-end" onClick={() => setConfirmEnd(true)}>
                  结束本次训练
                </button>
              )}
            </div>
          )}
        </header>

        <section className="rn-min-hero" data-phase={livePhase} aria-label={liveCaption}>
          {(demoMedia?.hasSculpture && demoMedia.mp4Url) || demoMedia?.hasAnimation || demoMedia?.image ? (
            <div className="rn-min-bg" aria-hidden="true">
              {demoMedia?.hasSculpture && demoMedia.mp4Url ? (
                <video
                  key={item.exercise_id}
                  className="rn-min-bg-video"
                  src={demoMedia.mp4Url}
                  poster={demoMedia.image}
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : demoMedia?.hasAnimation ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={item.exercise_id}
                  className="rn-min-bg-gif"
                  src={`/api/gif/${item.exercise_id}`}
                  alt=""
                />
              ) : demoMedia?.image ? (
                <HalftoneImage src={demoMedia.image} cell={5} color="#b6babf" className="rn-min-bg-halftone" />
              ) : null}
              <span className="rn-min-bg-dots" />
            </div>
          ) : null}
          <div className="rn-min-timer-wrap">
            <b className="rn-min-timer" role="timer" aria-live="off">{liveClock}</b>
            <i className="rn-min-dot" aria-hidden="true" />
          </div>
          <p className="rn-min-sub">{liveCaption}</p>
        </section>

        <section className="rn-min-action" aria-label={`记录${setTag}`}>
          <div className="rn-min-action-left">
            <span className="rn-min-set-tag">{setTag}</span>
            <div className="rn-min-readout">
              <button
                type="button"
                className="rn-min-val"
                data-open={adjustOpen === 'weight' || undefined}
                onClick={() => setAdjustOpen((v) => (v === 'weight' ? null : 'weight'))}
                aria-label={`调整重量 ${weightText}`}
              >
                <b>{weightText}</b>
                {showWeightKg && <em>kg</em>}
              </button>
              <span className="rn-min-x" aria-hidden="true">×</span>
              <button
                type="button"
                className="rn-min-val"
                data-open={adjustOpen === 'reps' || undefined}
                onClick={() => setAdjustOpen((v) => (v === 'reps' ? null : 'reps'))}
                aria-label={`调整次数 ${reps} 次`}
              >
                <b>{reps}</b>
                <em>次</em>
              </button>
            </div>
          </div>
          <div className="rn-min-action-right">
            {isLifting ? (
              <>
                <button
                  type="button"
                  className="rn-min-stamp is-lifting"
                  disabled={busy}
                  onClick={() => void save(false)}
                  aria-label={`完成第 ${current.number} 组`}
                >
                  {busy ? (
                    <span className="rn-check-spin" aria-hidden="true" />
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </button>
                <button type="button" className="rn-min-quick" onClick={cancelLift}>取消</button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="rn-min-stamp is-start"
                  disabled={busy}
                  onClick={startLift}
                  aria-label={`开始第 ${current.number} 组力训`}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                  </svg>
                </button>
                <button type="button" className="rn-min-quick" disabled={busy} onClick={() => void save(false)}>直接记</button>
              </>
            )}
          </div>
        </section>

        {adjustOpen && (
          <div className="rn-min-adjust">
            {adjustOpen === 'weight' ? (
              <>
                <button type="button" onClick={() => stepWeight(-2.5)}>−2.5</button>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0"
                  aria-label="重量"
                  value={weight}
                  onChange={(e) => setField({ weight: e.target.value })}
                />
                <button type="button" onClick={() => stepWeight(2.5)}>+2.5</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => stepReps(-1)}>−1</button>
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="1"
                  aria-label="次数"
                  value={reps}
                  onChange={(e) => setField({ reps: e.target.value })}
                />
                <button type="button" onClick={() => stepReps(1)}>+1</button>
              </>
            )}
            <button type="button" className="is-done" onClick={() => setAdjustOpen(null)}>好</button>
          </div>
        )}

        <main className="rn-min-laps-wrap">
          {error && <p className="form-err" role="alert">{error}</p>}

          <ol className="rn-ftl">
            {sets.map((doneSet, i) => {
              const prevSet = sets[i - 1];
              const switched = !prevSet || prevSet.exercise_id !== doneSet.exercise_id;
              const restBefore = prevSet ? restBetween(prevSet, doneSet) : null;
              const restBeforePhase = restBefore != null ? restPhase(restBefore, prevSet.rest_sec || 90, false) : null;
              const isBest = doneSet.plan_item_id === item.id && bestSetId === doneSet.id;
              const isFresh = justDoneId === doneSet.id;
              const isEditing = editingSet?.id === doneSet.id;
              const planTarget = planList.find((p) => p.id === doneSet.plan_item_id || p.exercise_id === doneSet.exercise_id);
              return (
                <Fragment key={doneSet.id}>
                  {prevSet && restBefore != null && restBeforePhase && (
                    <li className={`rn-ftl-gap${switched ? ' is-switch' : ''}`} data-phase={restBeforePhase}>
                      <span className="rn-ftl-rail" aria-hidden="true" />
                      <em>{switched ? `换项 ${clock(restBefore)}` : `休 ${clock(restBefore)}`}</em>
                    </li>
                  )}
                  {switched && (
                    <li className="rn-ftl-group">
                      <span className="rn-ftl-time">{hhmm(doneSet.created_at)}</span>
                      {planTarget ? (
                        <button type="button" className="rn-ftl-ex" data-current={planTarget.id === item.id || undefined} onClick={() => chooseAction(planTarget.id)}>
                          {doneSet.exercise_name}
                        </button>
                      ) : (
                        <span className="rn-ftl-ex">{doneSet.exercise_name}</span>
                      )}
                    </li>
                  )}
                  <li className="rn-ftl-set" data-best={isBest || undefined} data-fresh={isFresh || undefined}>
                    <span className="rn-ftl-dot" aria-hidden="true" />
                    <div className="rn-ftl-body">
                      <button
                        type="button"
                        className="rn-ftl-row"
                        onClick={() =>
                          setEditingSet(
                            isEditing
                              ? null
                              : { id: doneSet.id, setIndex: doneSet.set_index, weight: String(doneSet.weight), reps: String(doneSet.reps) },
                          )
                        }
                      >
                        <span className="rn-min-idx">第 {pad2(doneSet.set_index)} 组</span>
                        <span className="rn-ftl-right">
                          <b className="rn-min-pair">
                            {doneSet.weight > 0 ? `${doneSet.weight} kg × ${doneSet.reps}` : `自重 × ${doneSet.reps}`}
                          </b>
                          {doneSet.duration_sec > 0 && <small className="rn-ftl-dur">力训 {clock(doneSet.duration_sec)}</small>}
                        </span>
                      </button>
                      {isEditing && editingSet && (
                        <div className="rn-edit-inline rn-min-edit">
                          <label>
                            <span>重量</span>
                            <input type="number" inputMode="decimal" step="0.5" min="0" aria-label="重量" value={editingSet.weight} onChange={(e) => setEditingSet({ ...editingSet, weight: e.target.value })} />
                            <em>kg</em>
                          </label>
                          <label>
                            <span>次数</span>
                            <input type="number" inputMode="numeric" step="1" min="1" aria-label="次数" value={editingSet.reps} onChange={(e) => setEditingSet({ ...editingSet, reps: e.target.value })} />
                            <em>次</em>
                          </label>
                          <button type="button" className="rn-edit-save" disabled={editBusy} onClick={() => void saveEditedSet()}>保存</button>
                          <button type="button" className="rn-min-del" disabled={editBusy} onClick={() => void removeSet(doneSet.id)}>删除</button>
                          <button type="button" className="rn-edit-cancel" onClick={() => setEditingSet(null)}>取消</button>
                        </div>
                      )}
                    </div>
                  </li>
                </Fragment>
              );
            })}

            {isLifting && (
              <>
                {previous && lockedRestSec != null && lockedRestSec > 0 && (
                  <li className={`rn-ftl-gap${isSwitching ? ' is-switch' : ''}`} data-phase={restPhase(lockedRestSec, targetRestSec, false)}>
                    <span className="rn-ftl-rail" aria-hidden="true" />
                    <em>{isSwitching ? `换项 ${clock(lockedRestSec)}` : `休 ${clock(lockedRestSec)}`}</em>
                  </li>
                )}
                {(!previous || isSwitching) && (
                  <li className="rn-ftl-group">
                    <span className="rn-ftl-time">{hhmm(new Date(liftingAt!).toISOString())}</span>
                    <span className="rn-ftl-ex" data-current="true">{item.name}</span>
                  </li>
                )}
                <li className="rn-ftl-set is-live-lift">
                  <span className="rn-ftl-dot" aria-hidden="true" />
                  <div className="rn-ftl-row">
                    <span className="rn-min-idx">第 {pad2(current.number)} 组</span>
                    <span className="rn-ftl-right">
                      <b className="rn-min-pair">{showWeightKg ? `${weight} kg × ${reps}` : `自重 × ${reps}`}</b>
                      <small className="rn-ftl-dur is-live">力训 {clock(liftingSec)}</small>
                    </span>
                  </div>
                </li>
              </>
            )}
          </ol>

          <section className="rn-up-sec" aria-label="时间轴动作安排">
            <div className="rn-up-head">
              <span>时间轴安排</span>
              <small>点选切换 · 长按拖动排顺序</small>
            </div>
            <ol className="rn-up-list">
              {planList.map((entry) => {
                const doneCount = sets.filter((s) => s.plan_item_id === entry.id).length;
                const media = demoMap[entry.exercise_id];
                const isDragging = dragId === entry.id;
                return (
                  <li
                    key={entry.id}
                    data-up-id={entry.id}
                    className="rn-up-card"
                    data-active={entry.id === item.id || undefined}
                    data-dragging={isDragging || undefined}
                    onPointerDown={(event) => {
                      if (busy) return;
                      const el = event.currentTarget;
                      const pid = event.pointerId;
                      dragStartY.current = event.clientY;
                      dragMoved.current = false;
                      if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
                      longPressTimer.current = window.setTimeout(() => {
                        try { el.setPointerCapture(pid); } catch { /* 忽略 */ }
                        dragMoved.current = true;
                        setDragId(entry.id);
                        haptic(14);
                        playStepTick();
                      }, 240);
                    }}
                    onPointerMove={(event) => {
                      if (dragId !== entry.id) {
                        if (Math.abs(event.clientY - dragStartY.current) > 8 && longPressTimer.current) {
                          window.clearTimeout(longPressTimer.current);
                          longPressTimer.current = null;
                        }
                        return;
                      }
                      const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-up-id]') as HTMLElement | null;
                      const overId = Number(hit?.dataset.upId);
                      if (!overId || overId === entry.id) return;
                      setPlanList((cur) => {
                        const from = cur.findIndex((p) => p.id === entry.id);
                        const to = cur.findIndex((p) => p.id === overId);
                        if (from < 0 || to < 0 || from === to) return cur;
                        const next = [...cur];
                        const [moved] = next.splice(from, 1);
                        next.splice(to, 0, moved);
                        playStepTick();
                        haptic(5);
                        return next;
                      });
                    }}
                    onPointerUp={() => {
                      if (longPressTimer.current) {
                        window.clearTimeout(longPressTimer.current);
                        longPressTimer.current = null;
                      }
                      if (dragId === entry.id) {
                        setDragId(null);
                        persistPlanOrder(planListRef.current);
                        return;
                      }
                      if (!dragMoved.current && entry.id !== item.id) chooseAction(entry.id);
                    }}
                    onPointerCancel={() => {
                      if (longPressTimer.current) {
                        window.clearTimeout(longPressTimer.current);
                        longPressTimer.current = null;
                      }
                      setDragId(null);
                    }}
                  >
                    <span className="rn-up-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {media?.image ? <img src={media.image} alt="" /> : null}
                    </span>
                    <span className="rn-up-info">
                      <b>{entry.name}</b>
                      <small>{doneCount > 0 ? `已练 ${doneCount} 组` : entry.weight > 0 ? `${entry.weight} kg` : '待开练'}</small>
                    </span>
                    <span className="rn-up-grip" aria-hidden="true">⋮⋮</span>
                  </li>
                );
              })}
              <li>
                <button type="button" className="rn-up-add" onClick={() => setAddOpen(true)}>
                  + 在时间轴上添加动作
                </button>
              </li>
            </ol>
          </section>
        </main>
      </div>

      {addOpen && <TrainingExercisePicker busyId={addBusyId} onClose={() => setAddOpen(false)}
        actionLabel={id => planList.some(p => p.exercise_id === id) ? '再加一项' : '加入'}
        onChoose={id => void addExerciseMidSession(id)} error={error} />}

      {demo && (
        <div className="demo-sheet" role="dialog" aria-modal="true" aria-label={`${item.name}动作演示`} onClick={() => setDemo(false)}>
          <div className="demo-card" onClick={(event) => event.stopPropagation()}>
            <div className="demo-card-head">
              <b>{item.name}</b>
              <button type="button" className="chip" onClick={() => setDemo(false)}>关闭</button>
            </div>
            <ExerciseMedia
              id={item.exercise_id}
              image={demoMedia?.image}
              name={item.name}
              hasAnimation={demoMedia?.hasAnimation ?? false}
              variant="runner"
            />
          </div>
        </div>
      )}
    </div>
  );
}
