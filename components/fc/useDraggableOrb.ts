'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

/** 记下用户把圆钮放在哪：贴左边还是右边，离屏幕顶多少 */
type Spot = { side: 'left' | 'right'; y: number };
type Point = { x: number; y: number };

const KEY = 'fc-coach-orb';
/** 手指移动超过这个距离才算拖动，短于它仍是点按 */
const SLOP = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 可拖动的悬浮圆钮（像 iPhone 的辅助触控）：按住拖到哪就跟到哪，松手吸到最近的左边或右边，位置存在本机。
 * 拖动过的那次松手不算点按；没拖过时照常触发 onClick。
 */
export function useDraggableOrb(size: number) {
  const [pos, setPos] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; dx: number; dy: number; x0: number; y0: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  /** 可放的范围：左右和页面内容列对齐，上面留出状态栏，下面让开底部导航 */
  const bounds = useCallback((el?: Element | null) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const safe = el ? parseFloat(getComputedStyle(el).getPropertyValue('--orb-safe-b')) || 0 : 0;
    const inset = Math.max(18, (w - 524) / 2);
    return { left: inset, right: w - inset - size, top: 16, bottom: h - 104 - safe - size };
  }, [size]);

  const place = useCallback((spot: Spot, el?: Element | null): Point => {
    const b = bounds(el);
    return { x: spot.side === 'left' ? b.left : b.right, y: clamp(spot.y, b.top, Math.max(b.top, b.bottom)) };
  }, [bounds]);

  // 读回上次放的位置；窗口尺寸变了重新贴边
  useEffect(() => {
    const restore = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Spot | null;
        if (saved && (saved.side === 'left' || saved.side === 'right') && Number.isFinite(saved.y)) {
          setPos(place(saved, document.querySelector('.coach-orb')));
        }
      } catch {
        /* 本机存储不可用：用默认位置 */
      }
    };
    restore();
    window.addEventListener('resize', restore);
    return () => window.removeEventListener('resize', restore);
  }, [place]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top, x0: event.clientX, y0: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(event.clientX - d.x0, event.clientY - d.y0) < SLOP) return;
      d.moved = true;
      setDragging(true);
    }
    const b = bounds(event.currentTarget);
    setPos({
      x: clamp(event.clientX - d.dx, 8, window.innerWidth - size - 8),
      y: clamp(event.clientY - d.dy, b.top, Math.max(b.top, b.bottom)),
    });
  };

  const settle = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== event.pointerId || !d.moved) return;
    swallowClick.current = true;
    setDragging(false);
    const rect = event.currentTarget.getBoundingClientRect();
    const spot: Spot = { side: rect.left + size / 2 < window.innerWidth / 2 ? 'left' : 'right', y: rect.top };
    const next = place(spot, event.currentTarget);
    setPos(next);
    try {
      localStorage.setItem(KEY, JSON.stringify({ side: spot.side, y: next.y }));
    } catch {
      /* 存不下就只在这次有效 */
    }
  };

  /** 在 onClick 开头调用：刚拖完的那次松手返回 true，调用方直接 return */
  const consumeDragClick = () => {
    if (!swallowClick.current) return false;
    swallowClick.current = false;
    return true;
  };

  const style: CSSProperties | undefined = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;

  return {
    style,
    dragging,
    consumeDragClick,
    handlers: { onPointerDown, onPointerMove, onPointerUp: settle, onPointerCancel: settle },
  };
}
