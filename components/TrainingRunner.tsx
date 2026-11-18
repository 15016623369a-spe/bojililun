'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanItem, SessionRow } from '@/lib/types';

type Phase = 'idle' | 'working' | 'resting' | 'finished';

interface DoneSet {
  exercise: string;
  setNo: number;
  weight: number;
  reps: number;
  duration: number;
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const REST_CHOICES = [60, 90, 120, 180];

export default function TrainingRunner({
  session,
  plan,
  today,
}: {
  session: SessionRow;
  plan: PlanItem[];
  today: string;
}) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [setNo, setSetNo] = useState(1);
  const [phase, setPhase] = useState<Phase>(plan.length ? 'idle' : 'finished');
  const [elapsed, setElapsed] = useState(0);
  const [restLeft, setRestLeft] = useState(0);
  const [restTotal, setRestTotal] = useState(90);
  const [weight, setWeight] = useState(plan[0]?.weight ?? 0);
  const [reps, setReps] = useState(plan[0]?.reps ?? 10);
  const [restSec, setRestSec] = useState(plan[0]?.rest_sec ?? 90);
  const [done, setDone] = useState<DoneSet[]>([]);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const sessionStart = useRef(Date.now());
  const setStart = useRef(0);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  const item = plan[idx];
  const finishedAll = phase === 'finished' || !item;

  useEffect(() => {
    const t = setInterval(() => {
      setTotalElapsed(Math.floor((Date.now() - sessionStart.current) / 1000));
      if (phaseRef.current === 'working') {
        setElapsed(Math.floor((Date.now() - setStart.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const goNext = useCallback(() => {
    if (!item) return;
    if (setNo < item.sets) {
      setSetNo((n) => n + 1);
      setPhase('idle');
      setElapsed(0);
      return;
    }
    if (idx + 1 < plan.length) {
      const next = plan[idx + 1];
      setIdx((i) => i + 1);
      setSetNo(1);
      setPhase('idle');
      setElapsed(0);
      setWeight(next.weight);
      setReps(next.reps);
      setRestSec(next.rest_sec);
      return;
    }
    setPhase('finished');
  }, [idx, item, plan, setNo]);

  // 休息倒计时
  useEffect(() => {
    if (phase !== 'resting') return;
    if (restLeft <= 0) {
      goNext();
      return;
    }
    const t = setTimeout(() => setRestLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, restLeft, goNext]);

  function startSet() {
    setStart.current = Date.now();
    setElapsed(0);
    setPhase('working');
  }

  async function endSet() {
    if (!item) return;
    const duration = Math.max(1, Math.floor((Date.now() - setStart.current) / 1000));
    const payload = {
      sessionId: session.id,
      planItemId: item.id,
      exerciseId: item.exercise_id,
      exerciseName: item.name,
      bodyPart: item.body_part,
      target: item.target,
      setIndex: setNo,
      weight,
      reps,
      durationSec: duration,
      restSec,
    };
    setDone((d) => [...d, { exercise: item.name, setNo, weight, reps, duration }]);
    setPhase('resting');
    setRestLeft(restSec);
    setRestTotal(restSec);
    try {
      const res = await fetch('/api/session/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? '保存失败');
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function patchRest(sec: number) {
    if (!item) return;
    setRestSec(sec);
    await fetch('/api/plan', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: item.id, restSec: sec }),
    });
  }

  async function finish() {
    if (saving) return;
    setSaving(true);
    try {
      await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: session.id }),
      });
      router.push(`/history/${today}`);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  if (plan.length === 0) {
    return (
      <div className="page">
        <header className="page-hdr">
          <div>
            <h1>开始训练</h1>
            <p>今天还没有安排动作</p>
          </div>
        </header>
        <div className="page-body">
          <div className="empty-card">
            <p>先去动作库挑几个动作加到今日清单。</p>
            <div className="row-btns">
              <Link className="btn primary" href="/exercises">
                去动作库
              </Link>
              <Link className="btn" href="/train">
                回训练页
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totalSets = plan.reduce((a, x) => a + x.sets, 0);
  const doneSets = done.length;
  const ringPct = phase === 'resting' ? (restTotal ? (restTotal - restLeft) / restTotal : 1) : Math.min(1, elapsed / 60);
  const C = 2 * Math.PI * 62;

  return (
    <div className="runner">
      <header className="runner-hdr">
        <Link href="/train" className="lib-back" aria-label="返回">
          ←
        </Link>
        <div>
          <div className="runner-title">训练中</div>
          <div className="runner-sub">
            总用时 {mmss(totalElapsed)} · 完成 {doneSets}/{totalSets} 组
          </div>
        </div>
      </header>

      <div className="runner-body">
        {finishedAll ? (
          <div className="finish-card">
            <div className="finish-emoji">💪</div>
            <h2>练完了</h2>
            <p>
              共 {doneSets} 组，总用时 {mmss(totalElapsed)}。
            </p>
            <button className="btn primary big" onClick={finish} disabled={saving}>
              {saving ? '保存中…' : '完成并保存'}
            </button>
          </div>
        ) : (
          <>
            <div className="runner-progress">
              <div className="rp-label">
                动作 {idx + 1}/{plan.length}
              </div>
              <div className="rp-bar">
                <i style={{ width: `${(doneSets / totalSets) * 100}%` }} />
              </div>
            </div>

            <div className="ex-now">
              <div className="ex-now-name">{item.name}</div>
              <div className="ex-now-meta">
                {item.target || item.body_part} · {item.equipment}
              </div>
              <div className="ex-now-plan">
                计划 {item.sets} 组 × {item.reps} 次 · {item.weight > 0 ? `${item.weight} kg` : '自重'}
              </div>
            </div>

            <div className="timer-wrap">
              <svg className="ring" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r="62" className="ring-bg" />
                <circle
                  cx="70"
                  cy="70"
                  r="62"
                  className={`ring-fg ${phase === 'resting' ? 'rest' : ''}`}
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - ringPct)}
                />
              </svg>
              <div className="timer-text">
                <b>{phase === 'resting' ? mmss(restLeft) : mmss(elapsed)}</b>
                <span>
                  {phase === 'resting' ? '组间休息' : phase === 'working' ? `第 ${setNo} / ${item.sets} 组进行中` : `准备第 ${setNo} / ${item.sets} 组`}
                </span>
              </div>
            </div>

            <div className="set-inputs">
              <label>
                <span>重量 kg</span>
                <input type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
              </label>
              <label>
                <span>次数</span>
                <input type="number" inputMode="numeric" value={reps} onChange={(e) => setReps(Number(e.target.value))} />
              </label>
            </div>

            {phase === 'idle' && (
              <button className="btn primary big" onClick={startSet}>
                开始第 {setNo} 组
              </button>
            )}
            {phase === 'working' && (
              <button className="btn primary big danger" onClick={endSet}>
                结束本组
              </button>
            )}
            {phase === 'resting' && (
              <div className="rest-actions">
                <button className="btn" onClick={() => goNext()}>
                  跳过休息
                </button>
                <button className="btn" onClick={() => setRestLeft((v) => v + 15)}>
                  +15s
                </button>
              </div>
            )}

            <div className="rest-setting">
              <span>组间休息</span>
              {REST_CHOICES.map((r) => (
                <button key={r} className={`rest-chip ${restSec === r ? 'on' : ''}`} onClick={() => patchRest(r)}>
                  {r}s
                </button>
              ))}
            </div>

            <button className="link-btn" onClick={finish} disabled={saving}>
              结束训练
            </button>

            {done.length > 0 && (
              <div className="done-list">
                <div className="done-title">已完成的组</div>
                {done.map((d, i) => (
                  <div className="done-row" key={i}>
                    <span>
                      {d.exercise} · 第 {d.setNo} 组
                    </span>
                    <em>
                      {d.weight}kg × {d.reps}
                    </em>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {err && <p className="form-err">{err}</p>}
      </div>
    </div>
  );
}
