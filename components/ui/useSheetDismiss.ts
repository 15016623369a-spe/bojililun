'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

const CLOSE_MS = 220;

export default function useSheetDismiss(active: boolean, blocked: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const gesture = useRef<{ id: number; start: number; y: number; time: number; speed: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeLatest = useRef(onClose);
  closeLatest.current = onClose;

  const offset = (y: number) => panel.current?.style.setProperty('--sheet-offset', `${y}px`);
  useEffect(() => {
    if (!active) {
      setClosing(false);
      setDragging(false);
      gesture.current = null;
      suppressClick.current = false;
    }
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [active]);

  const requestClose = useCallback(() => {
    if (blocked || timer.current !== null) return;
    setDragging(false);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      closeLatest.current();
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      closeLatest.current();
    }, CLOSE_MS);
  }, [blocked]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0 || blocked || closing) return;
    suppressClick.current = false;
    gesture.current = { id: event.pointerId, start: event.clientY, y: event.clientY, time: event.timeStamp, speed: 0, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    const delta = event.clientY - drag.start;
    if (Math.abs(delta) > 5) drag.moved = true;
    drag.speed = (event.clientY - drag.y) / Math.max(1, event.timeStamp - drag.time);
    drag.time = event.timeStamp;
    drag.y = event.clientY;
    offset(delta < 0 ? Math.max(-22, delta * .18) : delta);
  }

  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    gesture.current = null;
    suppressClick.current = cancelled || drag.moved;
    setDragging(false);
    const distance = event.clientY - drag.start;
    const fast = distance > 26 && event.timeStamp - drag.time < 95 && drag.speed > .65;
    if (!cancelled && drag.moved && (distance > (panel.current?.offsetHeight ?? 600) / 3 || fast)) requestClose();
    else offset(0);
  }

  return {
    panel, dragging, closing, requestClose,
    handle: {
      onPointerDown, onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(event),
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
      onClick: () => {
        if (!suppressClick.current) requestClose();
        suppressClick.current = false;
      },
    },
  };
}
