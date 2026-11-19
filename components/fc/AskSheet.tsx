'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AskAction, AskAnswer, AskFact } from '@/lib/ask';

type Meta = Omit<AskAnswer, 'text'>;

/** 底部升起的临时问答浮层：流式吐字 + 一键胶囊，划走即散，不留聊天记录 */
export default function AskSheet({ question, onClose }: { question: string; onClose: () => void }) {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [text, setText] = useState('');
  const [done, setDone] = useState(false);
  const [actionState, setActionState] = useState<Record<string, 'busy' | 'done' | 'err'>>({});
  const [toast, setToast] = useState('');

  const [dragY, setDragY] = useState(0);
  const dragRef = useRef<{ start: number; id: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error('答不上来');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done: finished } = await reader.read();
          if (finished) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) continue;
            const payload = JSON.parse(line.slice(5).trim()) as
              | { type: 'meta'; answer: Meta }
              | { type: 'chunk'; text: string }
              | { type: 'done' };
            if (cancelled) return;
            if (payload.type === 'meta') setMeta(payload.answer);
            else if (payload.type === 'chunk') setText((prev) => prev + payload.text);
            else setDone(true);
          }
        }
      } catch {
        if (!cancelled) {
          setText('网络好像断了，再问一次试试。');
          setDone(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [question]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const runAction = useCallback(
    async (a: AskAction) => {
      if (actionState[a.id] === 'busy' || actionState[a.id] === 'done') return;
      setActionState((prev) => ({ ...prev, [a.id]: 'busy' }));
      try {
        if (a.id === 'plan' && a.exerciseId) {
          const res = await fetch('/api/plan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ exerciseId: a.exerciseId }),
          });
          if (!res.ok) throw new Error('加入失败');
          setActionState((prev) => ({ ...prev, [a.id]: 'done' }));
          setToast('已加入今日训练');
          router.refresh();
          return;
        }
        if (a.id === 'log' && a.text) {
          const res = await fetch('/api/log', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: a.text, items: a.items }),
          });
          const data = (await res.json()) as { ok?: boolean; error?: string };
          if (!res.ok || !data.ok) throw new Error(data.error || '记录失败');
          setActionState((prev) => ({ ...prev, [a.id]: 'done' }));
          setToast('已记入今天');
          router.refresh();
          setTimeout(onClose, 700);
          return;
        }
      } catch (e) {
        setActionState((prev) => ({ ...prev, [a.id]: 'err' }));
        setToast((e as Error).message);
      }
    },
    [actionState, onClose, router],
  );

  /* 向下划走 */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { start: e.clientY, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dy = Math.max(0, e.clientY - dragRef.current.start);
    setDragY(dy);
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (dragY > 90) onClose();
    else setDragY(0);
  };

  return (
    <div className="fc-ask-mask" onClick={onClose}>
      <div
        className="fc-ask"
        style={{ transform: `translateY(${dragY}px)`, transition: dragY ? 'none' : 'transform 0.22s ease' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="fc-ask-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <i />
        </div>

        <div className="fc-ask-q">{question}</div>

        <div className="fc-ask-body">
          {meta?.media && (
            <div className="fc-ask-media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/gif/${meta.media.id}`} alt={meta.media.name} />
              <span>{meta.media.name}</span>
            </div>
          )}

          <p className="fc-ask-text">
            {text}
            {!done && <i className="fc-ask-caret" />}
          </p>

          {done && meta && meta.facts.length > 0 && (
            <div className="fc-ask-facts">
              {meta.facts.map((f: AskFact) => (
                <div key={f.label}>
                  <span>{f.label}</span>
                  <b>{f.value}</b>
                </div>
              ))}
            </div>
          )}

          {done && meta && meta.actions.length > 0 && (
            <div className="fc-ask-actions">
              {meta.actions.map((a) => {
                const state = actionState[a.id] ?? 'idle';
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`fc-ask-cap${state === 'done' ? ' done' : ''}`}
                    onClick={() => void runAction(a)}
                    disabled={state === 'busy'}
                  >
                    {state === 'done' ? '✓ 已记' : state === 'err' ? '再试一次' : a.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <p className="fc-ask-hint">向下划走</p>
        {toast && <div className="fc-ask-toast">{toast}</div>}
      </div>
    </div>
  );
}
