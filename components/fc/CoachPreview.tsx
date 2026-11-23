'use client';

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import Icon from '@/components/ui/Icon';

type Topic = 'meal' | 'strength' | 'plan';
type Exchange = { question: string; topic: Topic | null; approved?: boolean };

const TOPICS = {
  meal: {
    label: '晚饭怎么选',
    reply: '今天记了力量训练和一顿午餐。把你正在看的两份菜单发来，我会按你常点的口味和今天已知的记录帮你选。',
    evidence: '11 月 23 日 · 卧推、划船 · 午餐饭团、豆浆',
  },
  strength: {
    label: '复盘近 30 天',
    reply: '卧推同样是 50 kg，从 6 次到 8 次。深蹲期间换过器械，两段记录分开看。',
    evidence: '10 月 31 日 · 50 kg × 6；11 月 21 日 · 50 kg × 8',
  },
  plan: {
    label: '安排下次训练',
    reply: '先沿用上次的动作顺序，把 50 kg 卧推作为观察组。以当天的感受和完成次数为准，再决定下一次是否加重。',
    evidence: '近期可比的卧推记录 · 50 kg × 6 → 50 kg × 8',
  },
};

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
  const [draft, setDraft] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);

  function clearHold() {
    if (hold.current !== null) clearTimeout(hold.current);
    hold.current = null;
    start.current = null;
  }

  useEffect(() => clearHold, []);
  useEffect(() => {
    if (exchanges.length) latest.current?.scrollIntoView({ block: 'nearest' });
  }, [exchanges.length]);

  function open(held: boolean) {
    clearHold();
    const panel = dialog.current;
    const button = trigger.current;
    const avatar = mark.current;
    if (!panel || !button || !avatar || panel.open) return;

    const from = button.getBoundingClientRect();
    panel.showModal();
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

  function ask(question: string, topic: Topic | null) {
    if (!question.trim()) return;
    setExchanges(previous => [...previous, { question: question.trim(), topic }]);
    setDraft('');
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
            <div className="coach-preview-kicker"><span /> 最近 7 天 <small>示例</small></div>
            <h3 id="coach-preview-summary-title">你的卧推<br />多了<span>两次。</span></h3>
            <div className="coach-preview-result">
              <div><span>同样是 50 kg</span><b>6 <i>→</i> 8 <small>次</small></b></div>
              <div className="coach-preview-bars" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
            </div>
            <p>这周练了 3 次。下次可以先看看，同样的重量能不能稳定做出 8 次。</p>
            <details>
              <summary>查看记录依据</summary>
              <p>11 月 17 日 · 50 kg × 6<br />11 月 22 日 · 50 kg × 8</p>
            </details>
          </section>

          <div className="coach-preview-messages" aria-live="polite">
            {exchanges.map(({ question, topic, approved }, index) => (
              <div className="coach-preview-exchange" key={index}>
                <p className="coach-preview-question">{question}</p>
                <div className="coach-preview-reply">
                  <p>{topic ? TOPICS[topic].reply : '当前是交互预览。可试试下方的饮食建议、力量复盘和训练草案。'}</p>
                  {topic && <details><summary>查看记录依据</summary><p>{TOPICS[topic].evidence}</p></details>}
                  {topic === 'plan' && <button className="coach-preview-approve" type="button" disabled={approved}
                    onClick={() => setExchanges(previous => previous.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, approved: true } : item
                    )))}>
                    {approved ? '已确认 · 示例' : '确认草案'}
                  </button>}
                </div>
              </div>
            ))}
            <div ref={latest} />
          </div>
        </div>

        <div className="coach-preview-dock">
          <div className="coach-preview-topics">
            {(Object.keys(TOPICS) as Topic[]).map(topic => (
              <button key={topic} type="button" onClick={() => ask(TOPICS[topic].label, topic)}>{TOPICS[topic].label}</button>
            ))}
          </div>
          <form onSubmit={event => { event.preventDefault(); ask(draft, null); }}>
            <input aria-label="问教练" placeholder="接着问教练…" value={draft} onChange={event => setDraft(event.target.value)} />
            <button type="submit" aria-label="发送" disabled={!draft.trim()}><Icon name="arrow-up" size={20} /></button>
          </form>
        </div>
      </div>
    </dialog>
  </>;
}
