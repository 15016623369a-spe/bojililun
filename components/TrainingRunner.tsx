'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { idsForTarget } from '@/lib/energy';
import { planPoseFor } from '@/lib/plan-poses';
import type { SculptureVariant } from '@/lib/sculpture-groups';
import type { PlanItem, SessionRow, SetRow } from '@/lib/types';
import ExerciseMedia from './ExerciseMedia';
import EndTrainingButton from './EndTrainingButton';
import DotDigits from './ui/DotDigits';
import TickRuler from './ui/TickRuler';
import Stepper from './ui/Stepper';
import Icon from './ui/Icon';

function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function haptic(pattern: number | number[] = 8) { try { navigator.vibrate?.(pattern); } catch { /* iOS 网页无振动 */ } }

function pendingActions(plan: PlanItem[], sets: SetRow[]) {
  return plan.flatMap((item, index) => {
    const completed = sets.filter((set) => set.plan_item_id === item.id).length;
    return completed < item.sets ? [{ item, index, number: completed + 1 }] : [];
  });
}

const e1rm = (weight: number, reps: number) => (reps <= 0 || reps > 15 || weight <= 0 ? 0 : reps === 1 ? weight : weight * (1 + reps / 30));

export default function TrainingRunner({ session, plan, initialSets, demonstrations, priorBest = {}, variant, receiptHref }: {
  session: SessionRow;
  plan: PlanItem[];
  initialSets: SetRow[];
  demonstrations: Record<string, { image?: string; hasAnimation: boolean }>;
  priorBest?: Record<string, number>;
  variant: SculptureVariant;
  receiptHref: string;
}) {
  const router = useRouter();
  const [sets, setSets] = useState(initialSets);
  const [chosen, setChosen] = useState<number | null>(null);
  const [showActions, setShowActions] = useState(false);
  const actionsKey = `fitcheck-training-action:${session.id}`;
  const pending = pendingActions(plan, sets);
  const current = pending.find(({ item }) => item.id === chosen) ?? pending[0];
  const previous = sets.at(-1);
  const key = `fitcheck-training:${session.id}:${current?.item.id}:${current?.number}`;
  const [work, setWork] = useState<{ key: string; started: number } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [fields, setFields] = useState<{ key: string; weight: string; reps: string } | null>(null);
  const [extraRest, setExtraRest] = useState<{ setId: number; seconds: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(Boolean(session.ended_at));
  const [error, setError] = useState('');
  const [demo, setDemo] = useState(false);
  const lock = useRef(false);
  const restBuzzed = useRef<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      const started = Number(sessionStorage.getItem(key));
      if (started > 0) setWork({ key, started });
      const draft = sessionStorage.getItem(`${key}:fields`);
      if (draft) setFields({ key, ...JSON.parse(draft) });
    } catch {
      // Training still works when browser storage is unavailable.
    }
  }, [key]);

  useEffect(() => {
    try {
      const stored = Number(sessionStorage.getItem(actionsKey));
      if (stored > 0) setChosen(stored);
    } catch { /* 浏览器存储不可用时，从待练动作继续 */ }
  }, [actionsKey]);

  function chooseAction(id: number) {
    setChosen(id);
    setShowActions(false);
    setDemo(false);
    setError('');
    try { sessionStorage.setItem(actionsKey, String(id)); } catch { /* 当次切换仍生效 */ }
    haptic(8);
  }

  const item = current?.item;
  const demoMedia = item ? demonstrations[item.exercise_id] : undefined;
  const totalSets = plan.reduce((sum, entry) => sum + entry.sets, 0);
  const resting = Boolean(previous && work?.key !== key);
  const startedAt = work?.key === key ? work.started : Date.parse(session.started_at);
  const extra = previous && extraRest?.setId === previous.id ? extraRest.seconds : 0;
  const restTotal = previous ? previous.rest_sec + extra : 0;
  const restUntil = previous ? Date.parse(previous.created_at) + restTotal * 1000 : 0;
  const restLeft = now === null ? restTotal : Math.max(0, Math.ceil((restUntil - now) / 1000));
  const setSeconds = now === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  const sessionSeconds = now === null ? 0 : Math.max(0, Math.floor((now - Date.parse(session.started_at)) / 1000));
  const weight = item && fields?.key === key ? fields.weight : String(item?.weight ?? 0);
  const reps = item && fields?.key === key ? fields.reps : String(item?.reps ?? 0);

  // 休息结束时震两下
  useEffect(() => {
    if (!resting || !previous || now === null) return;
    if (restLeft === 0 && restBuzzed.current !== previous.id) {
      restBuzzed.current = previous.id;
      haptic([24, 70, 24]);
    }
  }, [resting, restLeft, previous, now]);

  function beginNextSet() {
    const started = Date.now();
    setWork({ key, started });
    setNow(started);
    haptic(10);
    try { sessionStorage.setItem(key, String(started)); } catch { /* 浏览器存储可用时支持刷新续练 */ }
  }

  async function saveSet() {
    if (lock.current || !current || resting) return;
    if (weight === '' || !Number.isFinite(Number(weight)) || Number(weight) < 0 || Number(weight) > 1000 || !Number.isInteger(Number(reps)) || Number(reps) < 1 || Number(reps) > 1000) {
      setError('请输入有效的重量和次数');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/session/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id, chooseExercise: current.item.id === chosen, planItemId: current.item.id, setIndex: current.number,
          exerciseId: current.item.exercise_id, exerciseName: current.item.name,
          bodyPart: current.item.body_part, target: current.item.target,
          weight: Number(weight), reps: Number(reps),
          durationSec: Math.max(1, Math.floor((Date.now() - startedAt) / 1000)),
          restSec: current.item.rest_sec,
          // 上一组的 created_at 是完成时间；本次开始时间减去它就是实际组间休息。
          previousSetId: previous?.id,
          previousRestSec: previous ? Math.max(0, Math.round((startedAt - Date.parse(previous.created_at)) / 1000)) : undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存失败，请重试');
      if (result.sets) setSets(result.sets);
      haptic(14);
      try { sessionStorage.removeItem(key); sessionStorage.removeItem(`${key}:fields`); } catch { /* 缓存清理不影响已保存的数据 */ }
      setNow(Date.now());
      if (result.ended) {
        setEnded(true);
        haptic([18, 60, 18, 60, 30]);
        router.replace(receiptHref);
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const endTraining = <EndTrainingButton sessionId={session.id} completedSets={sets.length} disabled={busy} onEnded={() => {
    try { sessionStorage.removeItem(key); sessionStorage.removeItem(`${key}:fields`); } catch { /* 缓存清理不影响已保存的数据 */ }
    router.replace(receiptHref);
    router.refresh();
  }} />;

  // ---------- 已结束且没有组 ----------
  if (ended && sets.length === 0) {
    return <div className="runner v-runner" data-mode="done">
      <header className="runner-head"><Link className="runner-back" href="/log"><Icon name="chevron-left" size={20} stroke={2} />记录</Link></header>
      <main className="runner-main runner-ended">
        <h1>训练已结束</h1>
        <Link className="ink-btn" href={receiptHref}><span>返回训练</span><span className="ink-btn-meta"><Icon name="arrow-right" size={20} /></span></Link>
      </main>
    </div>;
  }

  // ---------- 全部完成或已归档：小结 ----------
  if (ended || !current || !item) {
    const done = sets;
    const volume = done.reduce((sum, s) => sum + s.weight * s.reps, 0);
    const lastEnd = done.length ? Date.parse(done.at(-1)!.created_at) : Date.now();
    const duration = Math.max(0, Math.round((lastEnd - Date.parse(session.started_at)) / 1000));
    const byExercise = plan.map((p) => {
      const rows = done.filter((s) => s.plan_item_id === p.id);
      const best = Math.max(0, ...rows.map((s) => e1rm(s.weight, s.reps)));
      const top = rows.reduce<SetRow | null>((a, s) => (!a || e1rm(s.weight, s.reps) > e1rm(a.weight, a.reps) ? s : a), null);
      return { item: p, volume: rows.reduce((a, s) => a + s.weight * s.reps, 0), best, top, prior: priorBest[p.exercise_id] ?? 0 };
    }).filter((row) => row.top);
    const records = byExercise.filter((row) => row.prior > 0 && row.best > row.prior + .05).sort((a, b) => (b.best - b.prior) - (a.best - a.prior));
    const pr = records[0];
    const maxVolume = Math.max(1, ...byExercise.map((row) => row.volume));
    const span = Math.max(1, lastEnd - Date.parse(session.started_at));
    const time = clock(duration);
    return <div className="runner v-runner" data-mode="summary">
      <header className="runner-head">
        <Link className="runner-back" href="/train"><Icon name="chevron-left" size={20} stroke={2} />今日训练</Link>
        <span className="runner-head-meta">{ended && current ? '训练已结束' : '训练完成'}</span>
      </header>
      <main className="runner-main">
        {done.length === 0 ? <div className="runner-ended">
          <h1>这节训练没有动作</h1>
          {endTraining}
          {error && <p className="form-err" role="alert">{error}</p>}
        </div> : <>
          <section className="summary-time">
            <p className="kicker"><i aria-hidden="true" />总时长</p>
            <DotDigits text={time} cell={10} dimFrom={time.length - 2} label={`总时长 ${time}`} />
            <div className="summary-track" aria-hidden="true">
              {Array.from({ length: 72 }, (_, i) => <i key={i} />)}
              {done.map((s) => {
                const at = (Date.parse(s.created_at) - Date.parse(session.started_at)) / span;
                return <b key={s.id} style={{ left: `${Math.min(100, Math.max(0, at * 100)).toFixed(2)}%`, height: `${28 + Math.min(1, (s.weight * s.reps) / (maxVolume / 2 || 1)) * 46}%` }} />;
              })}
            </div>
            <div className="summary-axis"><span>{new Date(session.started_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              <span>{new Date(lastEnd).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></div>
          </section>
          <div className="summary-cards">
            <div className="tile lemon"><p className="kicker"><i className="ring" aria-hidden="true" />训练容量</p>
              <div className="tile-num"><b className="big-num">{Math.round(volume).toLocaleString()}</b><em>kg</em></div></div>
            <div className="tile"><p className="kicker"><i className="ring" aria-hidden="true" />完成组数</p>
              <div className="tile-num"><b className="big-num">{done.length}<span className="dim">/{totalSets}</span></b></div></div>
          </div>
          {pr && <div className="tile lilac pr-tile">
            <p className="kicker"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c0 6 4 10 10 10-6 0-10 4-10 10 0-6-4-10-10-10 6 0 10-4 10-10Z" fill="currentColor" /></svg>新纪录 · {pr.item.name}<span>估算 1RM</span></p>
            <div className="tile-num"><b className="big-num">{pr.best.toFixed(1).replace(/\.0$/, '')}</b><em>kg</em>
              <small><Icon name="arrow-up" size={13} stroke={2.2} /> {(pr.best - pr.prior).toFixed(1)} kg · {pr.top!.weight} kg × {pr.top!.reps}</small></div>
          </div>}
          <ul className="summary-list">
            {byExercise.map((row) => <li key={row.item.id}>
              <span className="name">{row.item.name}</span>
              <span className="meter-ticks" aria-hidden="true">{Array.from({ length: 36 }, (_, i) => <i key={i} data-on={i < Math.round(row.volume / maxVolume * 36) || undefined} />)}</span>
              <span className="val">{row.volume ? `${Math.round(row.volume).toLocaleString()} kg` : '自重'}</span>
            </li>)}
          </ul>
        </>}
      </main>
      {done.length > 0 && <footer className="runner-foot">
        {error && <p className="form-err" role="alert">{error}</p>}
        {ended ? <Link className="ink-btn" href={receiptHref}>
          <span>返回训练</span>
          <span className="ink-btn-meta"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>
        </Link> : endTraining}
      </footer>}
    </div>;
  }

  const itemSets = sets.filter((s) => s.plan_item_id === item.id);
  const target = idsForTarget(item.target)[0];
  const pose = target ? planPoseFor(target) : null;
  const actionChooser = <div className="runner-action-chooser">
    <button type="button" className="runner-action-toggle" aria-expanded={showActions}
      aria-controls="runner-action-list" onClick={() => setShowActions(!showActions)}>
      动作 {current.index + 1} / {plan.length} <Icon name="chevron-down" size={16} />
    </button>
    <ul id="runner-action-list" hidden={!showActions}>
      {plan.map((entry) => {
        const action = pending.find(({ item }) => item.id === entry.id);
        return <li key={entry.id}>
          <button type="button" disabled={busy || !action || entry.id === item.id} onClick={() => chooseAction(entry.id)}>
            {entry.name}<small>{entry.id === item.id ? '当前动作' : action ? `剩 ${entry.sets - action.number + 1} 组` : '已完成'}</small>
          </button>
        </li>;
      })}
    </ul>
  </div>;
  const header = <header className="runner-head">
    <Link className="runner-back" href="/train"><Icon name="chevron-left" size={20} stroke={2} />今日训练</Link>
    <span className="runner-head-meta">训练中 · <b>{clock(sessionSeconds)}</b></span>
    <span className="runner-progress" aria-label={`已完成 ${sets.length} / ${totalSets} 组`}>
      {Array.from({ length: totalSets }, (_, i) => <i key={i} data-on={i < sets.length || undefined} />)}
    </span>
  </header>;

  // ---------- 组间休息 ----------
  if (resting && previous) {
    const fraction = restTotal ? restLeft / restTotal : 0;
    const R = 120, C = 2 * Math.PI * R;
    const cols = 18, dots = Math.min(restTotal, 180), elapsed = restTotal - restLeft;
    const finished = restLeft === 0;
    return <div className="runner v-runner" data-mode="rest">
      {header}
      <main className="runner-main">
        <h1 className="runner-title">{finished ? '休息结束' : '组间休息'}</h1>
        <div className="rest-dial" data-finished={finished || undefined}>
          <svg viewBox="0 0 300 300" aria-hidden="true">
            {Array.from({ length: 60 }, (_, i) => {
              const a = (i / 60) * Math.PI * 2 - Math.PI / 2, major = i % 5 === 0;
              const r1 = major ? 104 : 109, r2 = 116;
              const f = (v: number) => +v.toFixed(2);
              return <line key={i} x1={f(150 + Math.cos(a) * r1)} y1={f(150 + Math.sin(a) * r1)} x2={f(150 + Math.cos(a) * r2)} y2={f(150 + Math.sin(a) * r2)}
                className={major ? 'major' : undefined} />;
            })}
            <circle className="rest-arc" cx="150" cy="150" r={R} strokeDasharray={`${(C * fraction).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 150 150)" />
          </svg>
          <div className="rest-dial-center">
            <b className="big-num" role="timer" aria-live="off">{clock(restLeft)}</b>
            <small>{finished ? '可以开始下一组' : '剩余时间'}</small>
          </div>
        </div>
        <div className="rest-next">
          <span>{item.name}</span>
          <b>第 <strong>{current.number}</strong> / {item.sets} 组</b>
        </div>
        <div className="rest-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} aria-hidden="true">
          {Array.from({ length: dots }, (_, i) => {
            const at = Math.floor(i * restTotal / dots);
            return <i key={i} data-state={at < elapsed ? 'done' : at === elapsed ? 'now' : undefined} />;
          })}
        </div>
      </main>
      <footer className="runner-foot rest-foot">
        {actionChooser}
        <span className="rest-total">总休息 <b>{clock(restTotal)}</b>
          <button type="button" className="chip" onClick={() => { haptic(5); setExtraRest({ setId: previous.id, seconds: extra + 15 }); }}>+15 秒</button>
        </span>
        <button type="button" className="ink-pill" onClick={beginNextSet} disabled={busy}>
          {finished ? `开始第 ${current.number} 组` : '跳过休息'}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
        </button>
        {endTraining}
      </footer>
    </div>;
  }

  // ---------- 记录一组 ----------
  const weightNum = Number(weight) || 0;
  const repsNum = Number(reps) || 0;
  function setField(patch: Partial<{ weight: string; reps: string }>) {
    const next = { key, weight, reps, ...patch };
    setFields(next);
    try { sessionStorage.setItem(`${key}:fields`, JSON.stringify(next)); } catch { /* 当前页面仍可调整 */ }
  }
  return <div className="runner v-runner" data-mode="set">
    {header}
    <main className="runner-main">
      <div className="runner-ex">
        <button type="button" className="thumb" onClick={() => setDemo(true)} aria-label={`查看${item.name}动作演示`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {pose || demoMedia?.image ? <img src={pose ? `/plan-poses/${variant === 'female' ? 'female/' : ''}${pose}.jpg` : demoMedia?.image} alt="" /> : null}
        </button>
        <div>
          <h1>{item.name}</h1>
          <p>第 <b>{current.number}</b> / {item.sets} 组<span className="sep">·</span>本组 {clock(setSeconds)}</p>
        </div>
      </div>

      <div className="runner-quantities">
        <Stepper readout label="重量" value={weightNum} unit="kg" step={0.5} min={0} max={1000} disabled={busy}
          onChange={(value) => setField({ weight: String(value) })} />
        <TickRuler value={weightNum} min={0} max={1000} step={0.5} major={10} label="重量刻度尺" unit="kg"
          onChange={(value) => setField({ weight: String(value) })} />
        <Stepper readout label="次数" value={repsNum} unit="次" step={1} min={1} max={1000} aside={`计划 ${item.reps} 次`}
          disabled={busy} onChange={(value) => setField({ reps: String(value) })} />
      </div>

      <div className="runner-set-dots" role="img" aria-label={`这个动作已完成 ${itemSets.length} / ${item.sets} 组`}>
        {Array.from({ length: item.sets }, (_, index) => (
          <i key={index} data-state={index < itemSets.length ? 'done' : index === current.number - 1 ? 'now' : undefined} />
        ))}
      </div>
    </main>
    <footer className="runner-foot">
      {actionChooser}
      {error && <p className="form-err" role="alert">{error}</p>}
      <button type="button" className="ink-btn" onClick={() => void saveSet()} disabled={busy}>
        <span>{busy ? '正在保存…' : `完成第 ${current.number} 组`}</span>
        <span className="ink-btn-meta">休息 {clock(item.rest_sec)}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
        </span>
      </button>
      {endTraining}
    </footer>

    {demo && <div className="demo-sheet" role="dialog" aria-modal="true" aria-label={`${item.name}动作演示`} onClick={() => setDemo(false)}>
      <div className="demo-card" onClick={(event) => event.stopPropagation()}>
        <div className="demo-card-head"><b>{item.name}</b><button type="button" className="chip" onClick={() => setDemo(false)}>关闭</button></div>
        <ExerciseMedia id={item.exercise_id} image={demoMedia?.image} name={item.name} hasAnimation={demoMedia?.hasAnimation ?? false} variant="runner" />
      </div>
    </div>}
  </div>;
}
