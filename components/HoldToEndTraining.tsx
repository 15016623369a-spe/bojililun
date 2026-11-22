'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import Icon from './ui/Icon';

const HOLD_THRESHOLD_MS = 300;
const FILL_DURATION_MS = 5000;
const CANCEL_DISTANCE_PX = 18;

export default function HoldToEndTraining({ href, ending, onEnd }: {
  href: string;
  ending: boolean;
  onEnd: () => void;
}) {
  const hintId = useId();
  const [seconds, setSeconds] = useState<number | null>(null);
  const holding = seconds !== null;
  const press = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const suppressClick = useRef(false);

  const cancel = useCallback(() => {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
    suppressClick.current = true;
    setSeconds(null);
  }, []);

  useEffect(() => {
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', cancel);
      if (press.current) window.clearTimeout(press.current.timer);
      press.current = null;
    };
  }, [cancel]);

  function begin(event: PointerEvent<HTMLAnchorElement>) {
    if (!event.isPrimary || event.button !== 0 || press.current || ending) return;
    suppressClick.current = false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, timer: 0 };
    press.current = pointer;
    pointer.timer = window.setTimeout(() => {
      suppressClick.current = true;
      const endAt = performance.now() + FILL_DURATION_MS;
      function tick() {
        const remaining = endAt - performance.now();
        if (remaining <= 0) {
          cancel();
          onEnd();
          return;
        }
        const nextSeconds = Math.ceil(remaining / 1000);
        setSeconds(nextSeconds);
        pointer.timer = window.setTimeout(tick, remaining - (nextSeconds - 1) * 1000);
      }
      tick();
    }, HOLD_THRESHOLD_MS);
  }

  function release(event: PointerEvent<HTMLAnchorElement>) {
    if (press.current?.id !== event.pointerId) return;
    const shouldSuppress = suppressClick.current;
    cancel();
    suppressClick.current = shouldSuppress;
  }

  return (
    <Link href={href} className="ink-btn training-hold" aria-label={ending ? '正在结束训练' : '继续训练'}
      aria-describedby={!holding && !ending ? hintId : undefined}
      aria-disabled={ending || undefined} data-holding={holding || undefined} data-ending={ending || undefined}
      draggable={false}
      onPointerDown={begin}
      onPointerMove={(event) => {
        const pointer = press.current;
        if (pointer?.id !== event.pointerId) return;
        const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
        const { clientX: x, clientY: y } = event;
        if (x < left || x > right || y < top || y > bottom ||
            Math.hypot(x - pointer.x, y - pointer.y) > CANCEL_DISTANCE_PX) cancel();
      }}
      onPointerUp={release}
      onPointerCancel={(event) => { if (press.current?.id === event.pointerId) cancel(); }}
      onLostPointerCapture={(event) => { if (press.current?.id === event.pointerId) cancel(); }}
      onContextMenu={(event) => { if (press.current) event.preventDefault(); }}
      onClick={(event) => { if (ending || (event.detail > 0 && suppressClick.current)) event.preventDefault(); }}>
      {(holding || ending) && (
        <span className="training-hold-fill" style={{ animationDuration: `${FILL_DURATION_MS}ms` }} aria-hidden="true" />
      )}
      <span className="training-hold-copy" aria-hidden="true">
        <strong>{ending ? '正在结束训练…' : holding ? '结束本次训练' : '继续训练'}</strong>
        {!ending && <small id={hintId}>{holding ? '松手取消' : '按住 5 秒可结束'}</small>}
      </span>
      {holding && <span className="training-hold-countdown" aria-hidden="true">{seconds}<small>秒</small></span>}
      {!holding && !ending && <Icon name="arrow-right" size={20} />}
    </Link>
  );
}
