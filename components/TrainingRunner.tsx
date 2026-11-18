'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PlanItem, SessionRow, SetRow } from '@/lib/types';
import ExerciseMedia from './ExerciseMedia';
import JournalIcon from './JournalIcon';

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function progress(plan: PlanItem[], sets: SetRow[]) {
  for (const [index, item] of plan.entries()) {
    const completed = sets.filter((set) => set.plan_item_id === item.id).length;
    if (completed < item.sets) return { item, index, number: completed + 1 };
  }
  return null;
}

export default function TrainingRunner({ session, plan, initialSets, demonstrations }: {
  session: SessionRow;
  plan: PlanItem[];
  initialSets: SetRow[];
  demonstrations: Record<string, { image?: string; hasAnimation: boolean }>;
}) {
  const router = useRouter();
  const [sets, setSets] = useState(initialSets);
  const current = progress(plan, sets);
  const previous = sets.at(-1);
  const key = `fitcheck-training:${session.id}:${current?.item.id}:${current?.number}`;
  const [work, setWork] = useState<{ key: string; started: number } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [fields, setFields] = useState<{ itemId: number; weight: string; reps: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(Boolean(session.ended_at));
  const [error, setError] = useState('');
  const lock = useRef(false);

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
  const demo = item ? demonstrations[item.exercise_id] : undefined;
  const totalSets = plan.reduce((sum, entry) => sum + entry.sets, 0);
  const resting = Boolean(previous && work?.key !== key);
  const startedAt = work?.key === key ? work.started : Date.parse(session.started_at);
  const restUntil = previous ? Date.parse(previous.created_at) + previous.rest_sec * 1000 : 0;
  const seconds = now === null ? 0 : resting
    ? Math.max(0, Math.ceil((restUntil - now) / 1000))
    : Math.max(0, Math.floor((now - startedAt) / 1000));
  const weight = item && fields?.itemId === item.id ? fields.weight : String(item?.weight ?? 0);
  const reps = item && fields?.itemId === item.id ? fields.reps : String(item?.reps ?? 0);
  const nextAction = current?.number === 1 ? '下一动作' : '下一组';

  function beginNextSet() {
    const started = Date.now();
    setWork({ key, started });
    setNow(started);
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
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存失败，请重试');
      if (result.sets) setSets(result.sets);
      try { sessionStorage.removeItem(key); } catch { /* 缓存清理不影响已保存的数据 */ }
      setNow(Date.now());
      if (finishing || result.ended) {
        setEnded(true);
        router.replace((result.sets?.length ?? sets.length) > 0 ? '/?workout=saved' : '/');
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={`journal-shell runner-shell${!ended && current ? ' runner-active' : ''}`}>
      <header className="journal-head runner-top">
        <Link className="journal-back" href="/body">‹ 计划</Link>
        <span>完成 {sets.length} / {totalSets} 组</span>
        {totalSets > 0 && <progress className="runner-progress" max={totalSets} value={Math.min(sets.length, totalSets)} aria-label="训练进度" />}
      </header>
      <main className="journal-content run-content">
        {ended ? (
          <><h1>训练已结束</h1><Link className="journal-primary" href="/">查看记录</Link></>
        ) : current && item ? (
          <>
            <div className="run-title">
              <p className="journal-kicker">动作 {current.index + 1} / {plan.length}</p>
              <h1>{item.name}</h1>
            </div>

            <figure className="run-demonstration">
              <figcaption>{resting ? (current.number === 1 ? '下一动作预览' : '下一组预览') : '动作演示'}</figcaption>
              <ExerciseMedia id={item.exercise_id} image={demo?.image} name={item.name}
                hasAnimation={demo?.hasAnimation ?? false} variant="runner" />
            </figure>

            <div className={`run-clock ${resting ? 'rest' : ''}`}>
              <div className="run-clock-label">
                <span>{resting ? (now === null || seconds ? '组间休息' : '休息时间已到') : '本组用时'}</span>
                <span className="run-set-number">第 {current.number} / {item.sets} 组</span>
              </div>
              <strong role="timer">{clock(seconds)}</strong>
            </div>

            <div className="run-fields">
              <label>重量 <span>kg</span><input aria-label="重量（kg）" type="number" min="0" step="0.5" inputMode="decimal"
                value={weight} onChange={(event) => setFields({ itemId: item.id, weight: event.target.value, reps })} /></label>
              <label>次数 <span>次</span><input aria-label="次数" type="number" min="0" inputMode="numeric"
                value={reps} onChange={(event) => setFields({ itemId: item.id, reps: event.target.value, weight })} /></label>
            </div>

            <footer className="runner-actions">
              {error && <p className="journal-error" role="alert">{error}</p>}
              {resting ? (
                <button className="journal-primary" onClick={beginNextSet} disabled={busy}>结束休息，开始{nextAction}</button>
              ) : (
                <button className="journal-primary" onClick={() => void save(false)} disabled={busy}>
                  <JournalIcon name="check" />{busy ? '正在保存…' : '完成本组'}
                </button>
              )}
              <button className="journal-quiet" onClick={() => void save(true)} disabled={busy}>{sets.length ? '结束训练并归档' : '结束训练'}</button>
            </footer>
          </>
        ) : (
          <>
            <h1>{sets.length ? '所有动作已完成' : '这节训练没有动作'}</h1>
            <button className="journal-primary" onClick={() => void save(true)} disabled={busy}>结束训练</button>
            {error && <p className="journal-error" role="alert">{error}</p>}
          </>
        )}
      </main>
    </div>
  );
}
