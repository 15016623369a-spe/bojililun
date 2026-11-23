'use client';

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import Icon from '@/components/ui/Icon';
import { COACH_TOPICS, type CoachState, type CoachTopic } from '@/lib/coach-types';

function CoachMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <path d="M3.5 16.5c3.7-1 6.7-5.9 9.5-5.9s5.8 4.9 9.5 5.9M5 11.3c3.2-.8 5.5-4.8 8-4.8s4.8 4 8 4.8"
        stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
      <circle cx="13" cy="19.6" r="1.3" fill="currentColor" />
    </svg>
  );
}

export default function CoachPreview() {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef<HTMLDivElement>(null);
  const running = useRef(false);
  const pendingAsk = useRef<{ id: string; question: string; topic?: CoachTopic } | null>(null);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<CoachState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function clearHold() {
    if (hold.current !== null) clearTimeout(hold.current);
    hold.current = null;
    start.current = null;
  }

  useEffect(() => clearHold, []);
  useEffect(() => {
    if (state?.turns.length) latest.current?.scrollIntoView({ block: 'nearest' });
  }, [state?.turns.length]);

  async function request(body?: object) {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/coach', body ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      } : { cache: 'no-store' });
      const response = await res.json();
      if (!res.ok) throw new Error(response.error || '无法连接教练');
      setState(response as CoachState);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法连接教练');
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function open(held: boolean) {
    clearHold();
    const panel = dialog.current;
    const button = trigger.current;
    const avatar = mark.current;
    if (!panel || !button || !avatar || panel.open) return;

    const from = button.getBoundingClientRect();
    panel.showModal();
    void request();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const frame = panel.getBoundingClientRect();
    const to = avatar.getBoundingClientRect();
    const x = from.left + from.width / 2;
    const y = from.top + from.height / 2;
    const origin = `${x - frame.left}px ${y - frame.top}px`;
    const radius = Math.hypot(frame.width, frame.height);
    const duration = held ? 620 : 300;
    const easing = 'cubic-bezier(.22,.8,.24,1)';
    panel.getAnimations().forEach(animation => animation.cancel());
    avatar.getAnimations().forEach(animation => animation.cancel());
    panel.animate([
      { clipPath: `circle(${from.width / 2}px at ${origin})` },
      { clipPath: `circle(${radius}px at ${origin})` },
    ], { duration, easing });
    avatar.animate([
      { transform: `translate(${x - to.left - to.width / 2}px, ${y - to.top - to.height / 2}px) scale(${from.width / to.width})` },
      { transform: 'none' },
    ], { duration, easing });
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    start.current = { x: event.clientX, y: event.clientY };
    hold.current = setTimeout(() => open(true), 420);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const point = start.current;
    if (point && Math.hypot(event.clientX - point.x, event.clientY - point.y) > 10) clearHold();
  }

  async function ask(question: string, topic?: CoachTopic) {
    const text = question.trim();
    if (!text || running.current) return;
    if (pendingAsk.current?.question !== text || pendingAsk.current?.topic !== topic) {
      pendingAsk.current = { id: crypto.randomUUID(), question: text, topic };
    }
    if (await request(pendingAsk.current)) {
      pendingAsk.current = null;
      if (!topic) setDraft('');
    }
  }

  return <>
    <button ref={trigger} className="coach-orb" type="button" aria-label="打开我的教练"
      aria-haspopup="dialog" onClick={() => open(false)} onPointerDown={onPointerDown}
      onPointerMove={onPointerMove} onPointerUp={clearHold} onPointerCancel={clearHold}
      onPointerLeave={clearHold} onContextMenu={event => event.preventDefault()}>
      <CoachMark />
    </button>

    <dialog ref={dialog} className="coach-preview" aria-labelledby="coach-preview-title"
      onClose={() => trigger.current?.focus({ preventScroll: true })}>
      <div className="coach-preview-layout">
        <header className="coach-preview-head">
          <span className="coach-preview-mark" ref={mark}><CoachMark /></span>
          <h2 id="coach-preview-title">我的教练</h2>
          <button type="button" className="coach-preview-close" aria-label="返回记录" onClick={() => dialog.current?.close()}>
            <Icon name="close" size={21} />
          </button>
        </header>

        <div className="coach-preview-body">
          <section className="coach-preview-summary" aria-labelledby="coach-preview-summary-title">
            <div className="coach-preview-kicker"><span /> 最近 {state?.overview.days ?? 7} 天</div>
            <h3 id="coach-preview-summary-title">聊聊你的<br /><span>训练与饮食</span></h3>
            {state && <div className="coach-preview-result">
              <div><span>有训练记录</span><b>{state.overview.trainingDays} <small>天</small></b></div>
              <div><span>有饮食记录</span><b>{state.overview.mealDays} <small>天</small></b></div>
            </div>}
            {state?.overview.latestWorkout && <p className="coach-preview-latest">
              上次训练 · <a href={`/log?date=${state.overview.latestWorkout.date}&card=${state.overview.latestWorkout.cardId}`}>
                {state.overview.latestWorkout.label}
              </a>
            </p>}
          </section>

          <div className="coach-preview-messages" aria-live="polite">
            {state?.turns.map(({ id, question, reply, evidence, plan, confirmed }) => (
              <div className="coach-preview-exchange" key={id}>
                <p className="coach-preview-question">{question}</p>
                <div className="coach-preview-reply">
                  <p>{reply}</p>
                  {evidence.length > 0 && <details>
                    <summary>查看记录依据</summary>
                    <ul>{evidence.map(item => <li key={`${item.cardId}:${item.label}`}>
                      <a href={`/log?date=${item.date}&card=${item.cardId}`}>{item.date} · {item.label}</a>
                    </li>)}</ul>
                  </details>}
                  {plan && <div className="coach-preview-plan">
                    <b>{plan.date} 训练草案</b>
                    <ul>{plan.exercises.map(item => <li key={item.id}>
                      {item.name} · {item.sets} 组 × {item.reps} 次 · {item.weight} kg
                    </li>)}</ul>
                    <button className="coach-preview-approve" type="button" disabled={confirmed || busy}
                      onClick={() => void request({ id, action: 'confirm' })}>
                      {confirmed ? '已加入训练单' : '确认并加入训练单'}
                    </button>
                  </div>}
                </div>
              </div>
            ))}
            <div ref={latest} />
          </div>
        </div>

        <div className="coach-preview-dock">
          {busy && <p className="coach-preview-status" role="status">正在读取记录…</p>}
          {error && <p className="coach-preview-status" role="alert">{error}</p>}
          <div className="coach-preview-topics">
            {(Object.keys(COACH_TOPICS) as CoachTopic[]).map(topic => (
              <button key={topic} type="button" disabled={busy} onClick={() => void ask(COACH_TOPICS[topic], topic)}>{COACH_TOPICS[topic]}</button>
            ))}
          </div>
          <form onSubmit={event => { event.preventDefault(); void ask(draft); }}>
            <input aria-label="问教练" placeholder="接着问教练…" value={draft} maxLength={1500} onChange={event => setDraft(event.target.value)} />
            <button type="submit" aria-label="发送" disabled={busy || !draft.trim()}><Icon name="arrow-up" size={20} /></button>
          </form>
        </div>
      </div>
    </dialog>
  </>;
}
