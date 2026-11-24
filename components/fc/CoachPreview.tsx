'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { COACH_STARTERS, type CoachEvidence, type CoachState, type CoachTopic } from '@/lib/coach-types';
import CoachCharts from './CoachCharts';
import { MicFillIcon, SparklesIcon } from './icons';
import { useHoldToSpeak } from './useHoldToSpeak';
import { useDraggableOrb } from './useDraggableOrb';

function CoachMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <path
        d="M3.5 16.5c3.7-1 6.7-5.9 9.5-5.9s5.8 4.9 9.5 5.9M5 11.3c3.2-.8 5.5-4.8 8-4.8s4.8 4 8 4.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="13" cy="19.6" r="1.35" fill="currentColor" />
    </svg>
  );
}

function RecordEvidence({ evidence }: { evidence: CoachEvidence[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!evidence.length) return null;
  return (
    <div className="coach-evidence">
      <button
        type="button"
        className="coach-evidence-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(prev => !prev)}
      >
        <span>引用了 {evidence.length} 条记录</span>
        <Icon name="chevron-down" size={14} className={expanded ? 'is-open' : undefined} />
      </button>
      {expanded && (
        <ul className="coach-evidence-list">
          {evidence.map(item => (
            <li key={`${item.cardId}:${item.label}`}>
              <a href={`/log?date=${item.date}&card=${item.cardId}`}>
                <span className="coach-evidence-date">{item.date.slice(5)}</span>
                <span className="coach-evidence-label">{item.label}</span>
                <Icon name="chevron-right" size={14} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 我的教练。entry 决定入口长什么样：
 * - orb：可拖动的悬浮圆钮（旧入口，保留给别的页面用）；
 * - tile：记录页上的一块「我的教练」入口（11 月 24 日用户要求：记录和教练是两个功能，教练需要时再点开）。
 */
export default function CoachPreview({ entry = 'orb' }: { entry?: 'orb' | 'tile' }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const latest = useRef<HTMLDivElement>(null);
  const running = useRef(false);
  const closing = useRef(false);
  const orb = useDraggableOrb(52);

  const [draft, setDraft] = useState('');
  const [voiceNote, setVoiceNote] = useState('');
  const [state, setState] = useState<CoachState | null>(null);
  const [loadingInit, setLoadingInit] = useState(false);
  const [optimistic, setOptimistic] = useState<{ id: string; question: string; topic?: CoachTopic } | null>(null);
  const [failedAsk, setFailedAsk] = useState<{ id: string; question: string; topic?: CoachTopic; message: string } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [insightOpen, setInsightOpen] = useState(false);
  const [reveal, setReveal] = useState<{ id: string; count: number } | null>(null);

  // 输入框为空时右边是麦克风：按住说话，松开就把识别出的话发给教练，上滑取消
  const voice = useHoldToSpeak({
    onText: text => void ask(text),
    onNotice: setVoiceNote,
  });
  const listening = voice.phase !== 'idle';

  useEffect(() => {
    if (!voiceNote) return;
    const timer = setTimeout(() => setVoiceNote(''), 2800);
    return () => clearTimeout(timer);
  }, [voiceNote]);

  const turns = state?.turns ?? [];
  const hasConversation = turns.length > 0 || Boolean(optimistic) || Boolean(failedAsk);
  const isSending = Boolean(optimistic);

  // Smooth progressive text reveal for newly received coach reply
  useEffect(() => {
    if (!reveal) return;
    const target = turns.find(turn => turn.id === reveal.id);
    if (!target || reveal.count >= target.reply.length) {
      setReveal(null);
      return;
    }
    const step = Math.max(2, Math.ceil(target.reply.length / 42));
    const timer = setTimeout(() => {
      setReveal(prev => (prev && prev.id === target.id ? { id: prev.id, count: Math.min(target.reply.length, prev.count + step) } : null));
    }, 20);
    return () => clearTimeout(timer);
  }, [reveal, turns]);

  // Keep conversation smoothly scrolled to bottom
  useEffect(() => {
    if (hasConversation) {
      latest.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [turns.length, optimistic?.id, failedAsk?.id, reveal?.count, hasConversation]);

  async function fetchState() {
    setLoadingInit(true);
    try {
      const res = await fetch('/api/coach', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setState(data as CoachState);
    } catch {
      // Ignore silent init error; user can still ask and see feedback
    } finally {
      setLoadingInit(false);
    }
  }

  function getOrbOrigin(panel: HTMLDialogElement) {
    const frame = panel.getBoundingClientRect();
    const button = trigger.current;
    if (!button) return { origin: `${frame.width - 42}px ${frame.height - 196}px`, startRadius: 25, endRadius: Math.hypot(frame.width, frame.height) };
    const from = button.getBoundingClientRect();
    const x = from.left + from.width / 2 - frame.left;
    const y = from.top + from.height / 2 - frame.top;
    const endRadius = Math.hypot(Math.max(x, frame.width - x), Math.max(y, frame.height - y));
    return { origin: `${x}px ${y}px`, startRadius: from.width / 2, endRadius };
  }

  function open() {
    const panel = dialog.current;
    if (!panel || panel.open || closing.current) return;

    panel.showModal();
    void fetchState();

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const { origin, startRadius, endRadius } = getOrbOrigin(panel);
    const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
    panel.getAnimations().forEach(a => a.cancel());
    panel.animate(
      [
        { clipPath: `circle(${startRadius}px at ${origin})`, opacity: 0.7 },
        { clipPath: `circle(${endRadius}px at ${origin})`, opacity: 1 },
      ],
      { duration: 340, easing },
    );

    if (layout.current) {
      layout.current.getAnimations().forEach(a => a.cancel());
      layout.current.animate(
        [
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 260, delay: 60, easing, fill: 'backwards' },
      );
    }
  }

  function close() {
    const panel = dialog.current;
    if (!panel || !panel.open || closing.current) return;

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      panel.close();
      return;
    }

    closing.current = true;
    const { origin, startRadius, endRadius } = getOrbOrigin(panel);
    const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';
    panel.getAnimations().forEach(a => a.cancel());

    if (layout.current) {
      layout.current.getAnimations().forEach(a => a.cancel());
      layout.current.animate(
        [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(8px)' },
        ],
        { duration: 150, easing, fill: 'forwards' },
      );
    }

    const anim = panel.animate(
      [
        { clipPath: `circle(${endRadius}px at ${origin})`, opacity: 1 },
        { clipPath: `circle(${Math.max(18, startRadius - 4)}px at ${origin})`, opacity: 0.2 },
      ],
      { duration: 240, easing, fill: 'forwards' },
    );

    anim.onfinish = () => {
      closing.current = false;
      panel.getAnimations().forEach(a => a.cancel());
      layout.current?.getAnimations().forEach(a => a.cancel());
      if (panel.open) panel.close();
    };
    anim.oncancel = () => {
      closing.current = false;
    };
  }

  async function ask(question: string, topic?: CoachTopic, retryId?: string) {
    const text = question.trim();
    if (!text || running.current) return;

    const id = retryId ?? crypto.randomUUID();
    running.current = true;
    setFailedAsk(null);
    setOptimistic({ id, question: text, topic });
    if (!topic) setDraft('');

    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, question: text, topic }),
      });
      const response = await res.json();
      if (!res.ok) throw new Error(response.error || '无法连接教练');
      const next = response as CoachState;
      setState(next);
      setOptimistic(null);

      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const latestTurn = next.turns.at(-1);
      if (!reduced && latestTurn && latestTurn.id === id && latestTurn.reply.length > 0) {
        setReveal({ id: latestTurn.id, count: 1 });
      }
    } catch (cause) {
      setOptimistic(null);
      setFailedAsk({
        id,
        question: text,
        topic,
        message: cause instanceof Error ? cause.message : '无法连接教练，请稍后重试',
      });
    } finally {
      running.current = false;
    }
  }

  async function confirmPlan(id: string) {
    if (running.current || confirmingId) return;
    running.current = true;
    setConfirmingId(id);
    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'confirm' }),
      });
      const response = await res.json();
      if (!res.ok) throw new Error(response.error || '加入训练单失败');
      setState(response as CoachState);
    } catch (cause) {
      setFailedAsk({
        id: crypto.randomUUID(),
        question: '确认训练草案',
        message: cause instanceof Error ? cause.message : '加入训练单失败',
      });
    } finally {
      running.current = false;
      setConfirmingId(null);
    }
  }

  const insight = state?.overview.insight ?? null;

  return (
    <>
      {entry === 'tile' ? (
        <button ref={trigger} className="coach-tile" type="button" aria-haspopup="dialog" onClick={open}>
          <span className="coach-tile-icon"><SparklesIcon /></span>
          <span className="coach-tile-t"><b>我的教练</b><small>问饮食、训练，或者排下次训练</small></span>
          <svg className="coach-tile-chev" viewBox="0 0 8 14" aria-hidden="true"><path d="m1.5 1.5 5 5.5-5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      ) : (
      /* 可拖动：按住拖到别处，松手贴到最近的一边；轻点仍是打开教练 */
      <button
        ref={trigger}
        className="coach-orb"
        type="button"
        aria-label="打开我的教练（可拖动）"
        aria-haspopup="dialog"
        data-dragging={orb.dragging || undefined}
        style={orb.style}
        {...orb.handlers}
        onClick={() => {
          if (orb.consumeDragClick()) return;
          open();
        }}
      >
        <CoachMark size={24} />
      </button>
      )}

      <dialog
        ref={dialog}
        className="coach-preview"
        aria-labelledby="coach-preview-title"
        onCancel={event => {
          event.preventDefault();
          close();
        }}
        onClick={event => {
          if (event.target === dialog.current) close();
        }}
        onClose={() => trigger.current?.focus({ preventScroll: true })}
      >
        <div className="coach-preview-layout" ref={layout}>
          <header className="coach-preview-head">
            <button
              type="button"
              className="coach-preview-back"
              aria-label="返回记录"
              onClick={close}
            >
              <Icon name="chevron-left" size={20} />
              <span>返回</span>
            </button>

            <div className="coach-preview-identity">
              <span className={`coach-preview-mark${isSending ? ' is-thinking' : ''}`}>
                <SparklesIcon />
              </span>
              <div className="coach-preview-title-wrap">
                <h2 id="coach-preview-title">我的教练</h2>
                <span className="coach-preview-subtitle">
                  {isSending ? '正在看记录…' : '结合你的训练与饮食记录'}
                </span>
              </div>
            </div>

            <span className="coach-preview-head-spacer" aria-hidden="true" />
          </header>

          <div className="coach-preview-body">
            {hasConversation ? (
              insight && (
                <div className="coach-insight-bar">
                  <button
                    type="button"
                    className="coach-insight-bar-btn"
                    aria-expanded={insightOpen}
                    onClick={() => setInsightOpen(prev => !prev)}
                  >
                    <span className="coach-dot" />
                    <span className="coach-insight-bar-text">{insight.title}</span>
                    <Icon name="chevron-down" size={14} className={insightOpen ? 'is-open' : undefined} />
                  </button>
                  {insightOpen && (
                    <div className="coach-insight-bar-detail">
                      <p>{insight.detail}</p>
                      <RecordEvidence evidence={insight.evidence} />
                    </div>
                  )}
                </div>
              )
            ) : (
              <section className="coach-hero" aria-labelledby="coach-preview-summary-title">
                <div className="coach-hero-card">
                  <div className="coach-hero-kicker">
                    <span className="coach-dot" />
                    <span>{insight ? '近 30 天发现' : `近 ${state?.overview.days ?? 7} 天概览`}</span>
                  </div>

                  <h3 id="coach-preview-summary-title" className="coach-hero-title">
                    {insight ? insight.title : '看看近期进展，或者聊聊下一餐怎么吃'}
                  </h3>

                  {insight ? (
                    <>
                      <p className="coach-hero-detail">{insight.detail}</p>
                      <RecordEvidence evidence={insight.evidence} />
                    </>
                  ) : state ? (
                    <div className="coach-hero-stats">
                      <div className="coach-stat">
                        <span>训练</span>
                        <b>{state.overview.trainingDays}<small>天</small></b>
                      </div>
                      <div className="coach-stat">
                        <span>饮食</span>
                        <b>{state.overview.mealDays}<small>天</small></b>
                      </div>
                    </div>
                  ) : loadingInit ? (
                    <p className="coach-hero-detail">正在读取近期记录…</p>
                  ) : null}

                  {state?.overview.latestWorkout && (
                    <a
                      className="coach-latest-pill"
                      href={`/log?date=${state.overview.latestWorkout.date}&card=${state.overview.latestWorkout.cardId}`}
                    >
                      <Icon name="dumbbell" size={14} />
                      <span className="coach-latest-text">上次训练 · {state.overview.latestWorkout.label}</span>
                      <Icon name="chevron-right" size={14} />
                    </a>
                  )}
                </div>

                <div className="coach-starter-list" aria-label="快捷提问">
                  {COACH_STARTERS.map(({ topic, question, label, hint }) => (
                    <button
                      key={topic}
                      type="button"
                      className="coach-starter-card"
                      disabled={isSending}
                      onClick={() => void ask(question, topic)}
                    >
                      <span className="coach-starter-title">{label}</span>
                      <span className="coach-starter-hint">{hint}</span>
                      <svg className="coach-starter-arrow" viewBox="0 0 8 14" aria-hidden="true"><path d="m1.5 1.5 5 5.5-5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="coach-preview-messages" aria-live="polite">
              {turns.map(({ id, question, reply, evidence, plan, charts, confirmed }) => {
                const isRevealing = reveal?.id === id;
                const displayReply = isRevealing ? reply.slice(0, reveal.count) : reply;
                return (
                  <div className="coach-preview-exchange" key={id}>
                    <div className="coach-msg-user">
                      <p>{question}</p>
                    </div>
                    <div className="coach-msg-coach">
                      <span className="coach-msg-avatar" aria-hidden="true">
                        <SparklesIcon />
                      </span>
                      <div className="coach-msg-bubble">
                        <p className={isRevealing ? 'is-streaming' : undefined}>{displayReply}</p>
                        {!isRevealing && <CoachCharts charts={charts} />}
                        {!isRevealing && <RecordEvidence evidence={evidence} />}
                        {!isRevealing && plan && (
                          <div className="coach-preview-plan">
                            <div className="coach-plan-head">
                              <b>{plan.date} 训练草案</b>
                              <span>{plan.exercises.length} 个动作</span>
                            </div>
                            <ul>
                              {plan.exercises.map(item => (
                                <li key={item.id}>
                                  <span className="coach-plan-name">{item.name}</span>
                                  <span className="coach-plan-meta">
                                    {item.sets}×{item.reps} · {item.weight}kg
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <button
                              className={`coach-preview-approve${confirmed ? ' is-confirmed' : ''}`}
                              type="button"
                              disabled={confirmed || confirmingId === id}
                              onClick={() => void confirmPlan(id)}
                            >
                              {confirmed && <Icon name="check" size={15} />}
                              <span>
                                {confirmed ? '已加入训练单' : confirmingId === id ? '正在加入…' : '确认并加入训练单'}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {optimistic && (
                <div className="coach-preview-exchange is-pending">
                  <div className="coach-msg-user">
                    <p>{optimistic.question}</p>
                  </div>
                  <div className="coach-msg-coach">
                    <span className="coach-msg-avatar is-thinking" aria-hidden="true">
                      <SparklesIcon />
                    </span>
                    <div className="coach-msg-bubble coach-msg-thinking" role="status">
                      <span className="coach-typing-dots" aria-hidden="true">
                        <i /><i /><i />
                      </span>
                      <span className="coach-thinking-text">正在核对你的记录…</span>
                    </div>
                  </div>
                </div>
              )}

              {failedAsk && (
                <div className="coach-preview-exchange">
                  <div className="coach-msg-user">
                    <p>{failedAsk.question}</p>
                  </div>
                  <div className="coach-msg-coach">
                    <span className="coach-msg-avatar" aria-hidden="true">
                      <SparklesIcon />
                    </span>
                    <div className="coach-msg-bubble coach-msg-error" role="alert">
                      <p>{failedAsk.message}</p>
                      <button
                        type="button"
                        className="coach-retry-btn"
                        onClick={() => void ask(failedAsk.question, failedAsk.topic, failedAsk.id)}
                      >
                        <Icon name="rotate" size={14} />
                        <span>重试</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div ref={latest} />
            </div>
          </div>

          <div className="coach-preview-dock">
            {listening && (
              <div className={`coach-listen${voice.phase === 'canceling' ? ' is-cancel' : ''}`} role="status">
                <div className="coach-listen-head">
                  <span className="coach-listen-wave" aria-hidden="true">
                    <i /><i /><i /><i /><i /><i /><i />
                  </span>
                  <b>{voice.phase === 'canceling' ? '松开取消' : voice.phase === 'finishing' ? '正在识别…' : '在听…'}</b>
                  {voice.phase === 'listening' && <span>松开发送，上滑取消</span>}
                </div>
                <p className={voice.heard ? undefined : 'is-placeholder'}>{voice.heard || '说出你的问题，比如「我最近的基础代谢是多少」'}</p>
              </div>
            )}
            {!listening && voiceNote && <p className="coach-voice-note" role="status">{voiceNote}</p>}
            {hasConversation && !listening && (
              <div className="coach-preview-topics" aria-label="快捷话题">
                {COACH_STARTERS.map(({ topic, question, label }) => (
                  <button
                    key={topic}
                    type="button"
                    disabled={isSending}
                    onClick={() => void ask(question, topic)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <form
              className="coach-input-form"
              onSubmit={event => {
                event.preventDefault();
                void ask(draft);
              }}
            >
              <input
                aria-label="问教练"
                placeholder="问代谢、三大营养、训练或饮食…"
                value={draft}
                maxLength={1500}
                disabled={listening}
                onChange={event => setDraft(event.target.value)}
              />
              {draft.trim() ? (
                <button
                  type="submit"
                  aria-label="发送"
                  disabled={isSending}
                >
                  <Icon name="arrow-up" size={18} />
                </button>
              ) : (
                <button
                  type="button"
                  className={`coach-mic${listening ? ' is-on' : ''}${voice.phase === 'canceling' ? ' is-cancel' : ''}`}
                  aria-label="按住说话，松开发送"
                  title="按住说话"
                  disabled={isSending}
                  {...voice.bind}
                >
                  <MicFillIcon />
                </button>
              )}
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
