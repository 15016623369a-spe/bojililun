'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PlanItem, SessionRow, SetRow } from '@/lib/types';
import ExerciseMedia from './ExerciseMedia';
import DotDigits from './ui/DotDigits';
import TickRuler from './ui/TickRuler';
import HalftoneImage from './ui/HalftoneImage';
import Icon from './ui/Icon';

function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function haptic(pattern: number | number[] = 8) { try { navigator.vibrate?.(pattern); } catch { /* iOS 网页无振动 */ } }

function progress(plan: PlanItem[], sets: SetRow[]) {
  for (const [index, item] of plan.entries()) {
    const completed = sets.filter((set) => set.plan_item_id === item.id).length;
    if (completed < item.sets) return { item, index, number: completed + 1 };
  }
  return null;
}

const e1rm = (weight: number, reps: number) => (reps <= 0 || reps > 15 || weight <= 0 ? 0 : reps === 1 ? weight : weight * (1 + reps / 30));

/** 大号读数：整数墨黑、小数部分降一档灰。点一下可以直接输入。 */
function BigValue({ value, onChange, label, unit, step }: { value: string; onChange: (value: string) => void; label: string; unit: string; step: string }) {
  const [editing, setEditing] = useState(false);
  const [int, dec] = value.split('.');
  return <div className="big-value">
    {editing
      ? <input className="big-num" autoFocus type="number" inputMode="decimal" step={step} min="0" aria-label={label} value={value}
          onChange={(event) => onChange(event.target.value)} onBlur={() => setEditing(false)}
          onKeyDown={(event) => { if (event.key === 'Enter') setEditing(false); }} />
      : <button type="button" className="big-num" aria-label={`${label} ${value}${unit}，点按输入`} onClick={() => setEditing(true)}>
          {int || '0'}{dec ? <span className="dim">.{dec}</span> : null}
        </button>}
    <em>{unit}</em>
  </div>;
}

export default function TrainingRunner({ session, plan, initialSets, demonstrations, priorBest = {} }: {
  session: SessionRow;
  plan: PlanItem[];
  initialSets: SetRow[];
  demonstrations: Record<string, { image?: string; hasAnimation: boolean }>;
  priorBest?: Record<string, number>;
}) {
  const router = useRouter();
  const [sets, setSets] = useState(initialSets);
  const current = progress(plan, sets);
  const previous = sets.at(-1);
  const key = `fitcheck-training:${session.id}:${current?.item.id}:${current?.number}`;
  const [work, setWork] = useState<{ key: string; started: number } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [fields, setFields] = useState<{ itemId: number; weight: string; reps: string } | null>(null);
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
    } catch {
      // Training still works when browser storage is unavailable.
    }
  }, [key]);

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
  const weight = item && fields?.itemId === item.id ? fields.weight : String(item?.weight ?? 0);
  const reps = item && fields?.itemId === item.id ? fields.reps : String(item?.reps ?? 0);

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

  async function save(finishEarly: boolean) {
    if (lock.current || (!finishEarly && (!current || resting))) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const finishing = finishEarly || !current;
      const response = await fetch(finishing ? '/api/session' : '/api/session/set', {
        method: finishing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(finishing ? { id: session.id } : {
          sessionId: session.id, planItemId: current.item.id, setIndex: current.number,
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
      if (!finishing) haptic(14);
      try { sessionStorage.removeItem(key); } catch { /* 缓存清理不影响已保存的数据 */ }
      setNow(Date.now());
      if (finishing) {
        setEnded(true);
        router.replace('/log');
        router.refresh();
      } else if (result.ended) {
        // 最后一组完成，服务端已归档：留在本页展示小结
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
    return <div className="runner v-runner" data-mode="done">
      <header className="runner-head"><Link className="runner-back" href="/log"><Icon name="chevron-left" size={20} stroke={2} />记录</Link></header>
      <main className="runner-main runner-ended">
        <h1>训练已结束</h1>
        <Link className="ink-btn" href="/log"><span>查看今天的记录</span><span className="ink-btn-meta"><Icon name="arrow-right" size={20} /></span></Link>
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
        <Link className="runner-back" href="/train"><Icon name="chevron-left" size={20} stroke={2} />今日计划</Link>
        <span className="runner-head-meta">训练完成</span>
      </header>
      <main className="runner-main">
        {done.length === 0 ? <div className="runner-ended">
          <h1>这节训练没有动作</h1>
          <button type="button" className="ink-btn" onClick={() => void save(true)} disabled={busy}><span>结束训练</span></button>
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
        <button type="button" className="ink-btn" disabled={busy}
          onClick={() => { if (ended) { router.replace('/log'); router.refresh(); } else void save(true); }}>
          <span>{busy ? '正在保存…' : ended ? '完成，回到记录' : '保存到今天的记录'}</span>
          <span className="ink-btn-meta"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>
        </button>
      </footer>}
    </div>;
  }

  const itemSets = sets.filter((s) => s.plan_item_id === item.id);
  const next = current.number < item.sets ? null : plan[current.index + 1];
  const header = <header className="runner-head">
    <Link className="runner-back" href="/train"><Icon name="chevron-left" size={20} stroke={2} />今日计划</Link>
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
        <span className="rest-total">总休息 <b>{clock(restTotal)}</b>
          <button type="button" className="chip" onClick={() => { haptic(5); setExtraRest({ setId: previous.id, seconds: extra + 15 }); }}>+15 秒</button>
        </span>
        <button type="button" className="ink-pill" onClick={beginNextSet} disabled={busy}>
          {finished ? `开始第 ${current.number} 组` : '跳过休息'}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
        </button>
      </footer>
    </div>;
  }

  // ---------- 记录一组（柠檬黄整屏 = 正在产生容量） ----------
  const weightNum = Number(weight) || 0;
  const repsNum = Number(reps) || 0;
  const setField = (patch: Partial<{ weight: string; reps: string }>) => setFields({ itemId: item.id, weight, reps, ...patch });
  return <div className="runner v-runner" data-mode="set">
    {/* 上半屏炭黑：动作、组次和重量；下半屏冷银灰：次数和组次卡。刻度尺压在两块底色的交界上 */}
    <section className="runner-dark">
      {header}
      {demoMedia?.image && <button type="button" className="runner-figure" onClick={() => setDemo(true)} aria-label={`查看${item.name}动作演示`}>
        <HalftoneImage src={demoMedia.image} cell={3.4} />
      </button>}
      <div className="runner-title">
        <h1>{item.name}</h1>
        <p>第 {current.number} / {item.sets} 组</p>
        <small>动作 {current.index + 1} / {plan.length} · 本组 {clock(setSeconds)}</small>
      </div>
      <p className="field-label">重量</p>
      <BigValue value={weight} onChange={(v) => setField({ weight: v })} label="重量" unit="kg" step="0.5" />
    </section>
    <div className="runner-ruler">
      <TickRuler value={weightNum} min={0} max={300} step={0.5} major={5} gap={13} label="重量刻度尺" unit="kg"
        onChange={(v) => setField({ weight: String(v) })} />
    </div>
    <main className="runner-main">
      <div className="reps-row">
        <div>
          <p className="field-label">次数</p>
          <div className="big-value reps">
            <span className="big-num">{repsNum}<span className="dim"> /{item.reps}</span></span>
          </div>
        </div>
        <div className="reps-buttons">
          <button type="button" className="round" aria-label="减少一次" onClick={() => { haptic(5); setField({ reps: String(Math.max(0, repsNum - 1)) }); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
          </button>
          <button type="button" className="round ink" aria-label="增加一次" onClick={() => { haptic(5); setField({ reps: String(repsNum + 1) }); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>

      <ol className="set-strip">
        {Array.from({ length: item.sets }, (_, i) => {
          const doneSet = itemSets[i];
          const state = doneSet ? 'done' : i === current.number - 1 ? 'now' : 'todo';
          return <li key={i} data-state={state}>
            <small>第 {i + 1} 组{doneSet ? <Icon name="check" size={12} stroke={2.6} /> : null}</small>
            <b>{doneSet ? `${doneSet.weight} × ${doneSet.reps}` : state === 'now' ? `${weight} × ${reps}` : '—'}</b>
          </li>;
        })}
      </ol>

      {next && <div className="runner-next">
        <span className="thumb small">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {demonstrations[next.exercise_id]?.image ? <img src={demonstrations[next.exercise_id]!.image} alt="" /> : null}
        </span>
        <span><small>下一个</small><b>{next.name} · {next.sets} × {next.reps}</b></span>
      </div>}
    </main>
    <footer className="runner-foot">
      {error && <p className="form-err" role="alert">{error}</p>}
      <button type="button" className="ink-btn" onClick={() => void save(false)} disabled={busy}>
        <span>{busy ? '正在保存…' : `完成第 ${current.number} 组`}</span>
        <span className="ink-btn-meta">休息 {clock(item.rest_sec)}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
        </span>
      </button>
      <button type="button" className="runner-quiet" onClick={() => void save(true)} disabled={busy}>{sets.length ? '结束训练并归档' : '结束训练'}</button>
    </footer>

    {demo && <div className="demo-sheet" role="dialog" aria-modal="true" aria-label={`${item.name}动作演示`} onClick={() => setDemo(false)}>
      <div className="demo-card" onClick={(event) => event.stopPropagation()}>
        <div className="demo-card-head"><b>{item.name}</b><button type="button" className="chip" onClick={() => setDemo(false)}>关闭</button></div>
        <ExerciseMedia id={item.exercise_id} image={demoMedia?.image} name={item.name} hasAnimation={demoMedia?.hasAnimation ?? false} variant="runner" />
      </div>
    </div>}
  </div>;
}
