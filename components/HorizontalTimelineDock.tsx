'use client';

import { useEffect, useRef, useState } from 'react';
import { TARGET_LABEL } from '@/lib/exercise-label';
import { formatClock, formatHHMM, type HorizontalSlot } from '@/lib/timeline';
import { playStepTick } from '@/lib/rest-alert';
import type { DemoMedia } from './TimelineBlockActive';

function haptic(ms = 6) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

/** 橡皮筋阻尼：超出阈值后产生弹性阻力 */
function rubberBand(val: number, limit: number) {
  const abs = Math.abs(val);
  if (abs <= limit) return val;
  return Math.sign(val) * (limit + (abs - limit) * 0.28);
}

type DragState = {
  planItemId: number;
  originIdx: number;
  currentIdx: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  tilt: number;
};

const STEP_PX = 52;

/** 当前卡单独居中，其余卡片按先后顺序左右各成一叠立体透视卡片栈 */
function deckMetrics(rel: number) {
  if (rel === 0) return { x: 0, y: 0, rotY: 0, scale: 1, zIndex: 60, opacity: 1 };
  const sign = rel < 0 ? -1 : 1;
  const k = Math.abs(rel);
  return {
    x: sign * (134 + (k - 1) * 20),
    y: -(k - 1) * 4,
    rotY: -sign * Math.min(48, 36 + (k - 1) * 4),
    scale: Math.max(0.66, 0.85 - (k - 1) * 0.06),
    zIndex: Math.max(2, 42 - k * 5),
    opacity: k > 4 ? 0 : Math.max(0.34, 0.92 - (k - 1) * 0.17),
  };
}

export default function HorizontalTimelineDock({
  slots,
  activePlanId,
  liftingPlanId,
  liveLiftSec = 0,
  demoMap,
  nowReady,
  onSelect,
  onReorder,
  onRemove,
  onOpenAdd,
}: {
  slots: HorizontalSlot[];
  activePlanId: number | null;
  liftingPlanId: number | null;
  liveLiftSec?: number;
  demoMap: Record<string, DemoMedia>;
  nowReady: boolean;
  onSelect: (planItemId: number) => void;
  onReorder: (draggedId: number, targetIdx: number) => void;
  onRemove: (planItemId: number) => void;
  onOpenAdd: () => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [settledId, setSettledId] = useState<number | null>(null);
  const [swipeDx, setSwipeDx] = useState(0);
  const [confirmRmId, setConfirmRmId] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const tiltTimer = useRef<number | null>(null);
  const edgeTimer = useRef<number | null>(null);
  const startPt = useRef({ x: 0, y: 0 });
  const lastMove = useRef({ x: 0, t: 0 });
  const edgeOffset = useRef(0);
  const swipeStart = useRef<number | null>(null);
  const rulerScrub = useRef<{ startX: number; stepAnchorX: number } | null>(null);
  const didDrag = useRef(false);

  const rawItems = slots
    .map((slot) => ({ slot, card: slot.cards[0] }))
    .filter((entry): entry is { slot: HorizontalSlot; card: HorizontalSlot['cards'][number] } => Boolean(entry.card));

  const baseActiveIdx = Math.max(
    0,
    rawItems.findIndex((it) => it.card.planItemId === activePlanId),
  );

  // 仅当前时间点之后的待练卡可自由排期，已练过的历史卡按真实时间顺序锁定
  const firstEditableRaw = rawItems.findIndex((it) => it.slot.isProjected && it.card.planItemId !== liftingPlanId);
  const firstEditableIdx = firstEditableRaw < 0 ? rawItems.length : firstEditableRaw;

  // 拖动时实时重排预览序列，让相邻待练卡片以弹簧动画物理让位
  const items = (() => {
    if (!drag || drag.originIdx === drag.currentIdx) return rawItems;
    const next = [...rawItems];
    const [moved] = next.splice(drag.originIdx, 1);
    if (moved) next.splice(drag.currentIdx, 0, moved);
    return next;
  })();
  const activeIdx = drag ? drag.currentIdx : baseActiveIdx;

  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const rawItemsRef = useRef(rawItems);
  rawItemsRef.current = rawItems;
  const firstEditableRef = useRef(firstEditableIdx);
  firstEditableRef.current = firstEditableIdx;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!drag) return;
    let moveRaf: number | null = null;
    let pendingPt: { x: number; y: number } | null = null;

    const flushMove = () => {
      moveRaf = null;
      const pt = pendingPt;
      const cur = dragRef.current;
      if (!pt || !cur) return;
      const now = performance.now();
      const dx = pt.x - startPt.current.x;
      const dy = pt.y - startPt.current.y;
      const vx = (pt.x - lastMove.current.x) / Math.max(8, now - lastMove.current.t);
      lastMove.current = { x: pt.x, t: now };
      const nextTilt = Math.max(-11, Math.min(11, vx * 12));
      updateEdgeAutoStep(pt.x);
      if (tiltTimer.current) window.clearTimeout(tiltTimer.current);
      tiltTimer.current = window.setTimeout(() => {
        setDrag((c) => (c ? { ...c, tilt: 0 } : null));
      }, 90);
      setDrag((c) => {
        if (!c) return null;
        const minIdx = firstEditableRef.current;
        const maxIdx = rawItemsRef.current.length - 1;
        const relSlots = c.currentIdx - c.originIdx - edgeOffset.current;
        let nextIdx = c.currentIdx;
        if (dx >= (relSlots + 0.62) * STEP_PX && c.currentIdx < maxIdx) {
          nextIdx = Math.min(maxIdx, Math.max(minIdx, c.originIdx + edgeOffset.current + Math.round(dx / STEP_PX)));
        } else if (dx <= (relSlots - 0.62) * STEP_PX && c.currentIdx > minIdx) {
          nextIdx = Math.max(minIdx, Math.min(maxIdx, c.originIdx + edgeOffset.current + Math.round(dx / STEP_PX)));
        }
        if (nextIdx !== c.currentIdx) { playStepTick(); haptic(6); }
        return { ...c, dx, dy, tilt: c.tilt * 0.45 + nextTilt * 0.55, currentIdx: nextIdx };
      });
    };

    const onWinMove = (event: PointerEvent) => {
      pendingPt = { x: event.clientX, y: event.clientY };
      if (moveRaf === null) moveRaf = window.requestAnimationFrame(flushMove);
    };
    const onWinUp = () => {
      if (moveRaf !== null) { window.cancelAnimationFrame(moveRaf); moveRaf = null; }
      clearTimers();
      const cur = dragRef.current;
      if (!cur) return;
      setDrag(null);
      setSettledId(cur.planItemId);
      window.setTimeout(() => setSettledId((c) => (c === cur.planItemId ? null : c)), 340);
      playStepTick();
      haptic(10);
      if (cur.currentIdx !== cur.originIdx) onReorderRef.current(cur.planItemId, cur.currentIdx);
      else onSelectRef.current(cur.planItemId);
    };
    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinUp);
    return () => {
      if (moveRaf !== null) window.cancelAnimationFrame(moveRaf);
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('pointercancel', onWinUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(drag)]);

  useEffect(() => () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    if (tiltTimer.current) window.clearTimeout(tiltTimer.current);
    if (edgeTimer.current) window.clearInterval(edgeTimer.current);
  }, []);

  function clearTimers() {
    if (longPressTimer.current) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (tiltTimer.current) { window.clearTimeout(tiltTimer.current); tiltTimer.current = null; }
    if (edgeTimer.current) { window.clearInterval(edgeTimer.current); edgeTimer.current = null; }
  }

  function stepCard(delta: number) {
    const nextIdx = Math.max(0, Math.min(rawItems.length - 1, baseActiveIdx + delta));
    if (nextIdx === baseActiveIdx) return;
    playStepTick();
    onSelect(rawItems[nextIdx].card.planItemId);
  }

  function updateEdgeAutoStep(clientX: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    const dir = !rect ? 0 : clientX < rect.left + 44 ? -1 : clientX > rect.right - 44 ? 1 : 0;
    if (dir === 0) {
      if (edgeTimer.current) { window.clearInterval(edgeTimer.current); edgeTimer.current = null; }
      return;
    }
    if (edgeTimer.current) return;
    edgeTimer.current = window.setInterval(() => {
      setDrag((cur) => {
        if (!cur) return null;
        const minIdx = firstEditableRef.current;
        const nextIdx = Math.max(minIdx, Math.min(rawItemsRef.current.length - 1, cur.currentIdx + dir));
        if (nextIdx === cur.currentIdx) return cur;
        edgeOffset.current += dir;
        playStepTick();
        haptic(6);
        return { ...cur, currentIdx: nextIdx };
      });
    }, 340);
  }

  // 刻度尺与卡片同频移动：切卡、跟手横滑、长按拖拽或直接拨动刻度尺都实时咬合
  const tapeOffsetPx = -activeIdx * 134 + (drag ? -rubberBand(drag.dx, 148) * 0.65 : swipeDx * 1.15);
  const liveTrackShift = drag ? -rubberBand(drag.dx, 148) * 0.25 : swipeDx * 0.55;

  return (
    <section className="ht-dock is-cf" aria-label="横向透视时间轴" data-dragging={drag !== null || undefined}>
      <div className="ht-bar-head">
        <span>{drag ? `待练第 ${drag.currentIdx - firstEditableIdx + 1} 位 · 松手落位` : '时间轴'}</span>
        <div className="ht-bar-actions">
          <button type="button" className="ht-mini-add" onClick={onOpenAdd}>+ 加动作</button>
        </div>
      </div>

      {/* 精密横向时间刻度尺（支持双向拨动、时长色带、与下方卡片同频咬合） */}
      <div
        className="ht-ruler"
        data-scrubbing={Boolean(drag || swipeDx !== 0) || undefined}
        onPointerDown={(e) => {
          if (drag || (e.target as HTMLElement).closest('button')) return;
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
          rulerScrub.current = { startX: e.clientX, stepAnchorX: e.clientX };
        }}
        onPointerMove={(e) => {
          const s = rulerScrub.current;
          if (!s || drag) return;
          const delta = e.clientX - s.stepAnchorX;
          setSwipeDx(rubberBand(delta, 72) * 0.45);
          if (Math.abs(delta) >= 48) {
            stepCard(delta < 0 ? 1 : -1);
            haptic(5);
            s.stepAnchorX = e.clientX;
            setSwipeDx(0);
          }
        }}
        onPointerUp={() => { rulerScrub.current = null; setSwipeDx(0); }}
        onPointerCancel={() => { rulerScrub.current = null; setSwipeDx(0); }}
      >
        <div
          className="ht-ruler-ticks"
          aria-hidden="true"
          style={{ transform: `translate3d(${tapeOffsetPx % 60}px, 0, 0)` }}
        />
        <div className="ht-ruler-labels">
          {items.map(({ slot, card }, idx) => {
            const rel = idx - activeIdx;
            if (Math.abs(rel) > 1) return null;
            const isLift = card.planItemId === liftingPlanId;
            const t = isLift ? '现在' : slot.isProjected ? (nowReady ? `~${formatHHMM(slot.startMs)}` : '') : formatHHMM(slot.startMs);
            const x = (rel === 0 ? 0 : rel * 134) + liveTrackShift;
            const spanSec = isLift
              ? Math.max(30, card.liftTotalSec + card.restTotalSec + liveLiftSec)
              : Math.max(45, Math.round((slot.endMs - slot.startMs) / 1000));
            const spanW = Math.max(26, Math.min(86, Math.round(spanSec / 10)));
            const spanState = isLift ? 'lifting' : card.setCount > 0 ? 'done' : 'upcoming';
            return (
              <button
                key={card.planItemId}
                type="button"
                className="ht-ruler-mark"
                data-active={rel === 0 || undefined}
                data-projected={slot.isProjected || undefined}
                style={{ transform: `translateX(calc(-50% + ${x}px))` }}
                onClick={() => { playStepTick(); onSelect(card.planItemId); }}
              >
                <span>{t}</span>
                <i aria-hidden="true" />
                <b className="ht-span-bar" data-state={spanState} style={{ width: `${spanW}px` }} aria-hidden="true" />
                {slot.transitionBeforeSec != null && rel === 0 && !drag && (
                  <em className="ht-ruler-trans">换项 {formatClock(slot.transitionBeforeSec)}</em>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 中央光针：把刻度尺当前锚点与下方居中卡片物理咬合 */}
      <div className="ht-needle-wrap" aria-hidden="true">
        <i className="ht-needle" data-active={Boolean(drag || liftingPlanId === items[activeIdx]?.card.planItemId) || undefined} />
      </div>

      {/* 当前卡单独居中，其余卡片左右立体叠放（支持抖音式长按物理拖拽与磁吸让位） */}
      <div
        ref={stageRef}
        className="ht-cf-stage"
        onPointerDown={(e) => { if (!drag) swipeStart.current = e.clientX; }}
        onPointerMove={(e) => {
          if (drag || swipeStart.current === null) return;
          const dx = e.clientX - swipeStart.current;
          if (Math.abs(dx) > 6) setSwipeDx(rubberBand(dx, 90) * 0.34);
        }}
        onPointerUp={(e) => {
          if (drag || swipeStart.current === null) { swipeStart.current = null; setSwipeDx(0); return; }
          const dx = e.clientX - swipeStart.current;
          swipeStart.current = null;
          setSwipeDx(0);
          if (Math.abs(dx) > 38) stepCard(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => { swipeStart.current = null; setSwipeDx(0); }}
      >
        {drag && <div className="ht-drop-well" aria-hidden="true" />}

        {items.map(({ slot, card }, idx) => {
          const rel = idx - activeIdx;
          const isDragging = drag?.planItemId === card.planItemId;
          if (!isDragging && Math.abs(rel) > 4) return null;
          const isActive = rel === 0;
          const isLifting = card.planItemId === liftingPlanId;
          const side = rel < 0 ? 'left' : rel > 0 ? 'right' : undefined;
          const media = demoMap[card.exerciseId];
          const target = TARGET_LABEL[card.target] ?? card.target;
          const sub = card.setCount > 0
            ? `${card.setCount} 组${card.weight > 0 ? ` · ${card.weight} kg` : ''}`
            : (card.weight > 0 ? `${target} · ${card.weight} kg` : target);
          const canRemove = card.setCount === 0 && !isLifting && isActive && !drag;
          const m = deckMetrics(rel);
          const dimOther = Boolean(drag && !isDragging);
          const tx = isDragging
            ? drag.startX + rubberBand(drag.dx, 148)
            : m.x + (swipeDx ? swipeDx * (isActive ? 1 : 0.45) : 0);
          const ty = isDragging
            ? drag.startY - 20 + rubberBand(drag.dy * 0.45, 26)
            : m.y;
          const rotY = isDragging ? 0 : m.rotY;
          const rotZ = isDragging ? drag.tilt : swipeDx && isActive ? swipeDx * 0.08 : 0;
          const scale = isDragging ? 1.08 : m.scale * (dimOther ? 0.94 : 1);
          const opacity = isDragging ? 1 : m.opacity * (dimOther ? 0.82 : 1);
          const zIndex = isDragging ? 100 : m.zIndex;

          return (
            <div
              key={card.planItemId}
              role="button"
              tabIndex={0}
              draggable={false}
              className="ht-deck-card"
              onContextMenu={(e) => e.preventDefault()}
              onDragStart={(e) => e.preventDefault()}
              data-ht-idx={idx}
              data-side={isDragging ? undefined : side}
              data-active={isActive || undefined}
              data-lifting={isLifting || undefined}
              data-done={card.setCount > 0 || undefined}
              data-dragging={isDragging || undefined}
              data-swiping={(!drag && swipeDx !== 0) || undefined}
              data-settled={settledId === card.planItemId || undefined}
              style={{
                transform: `translate3d(calc(-50% + ${tx}px), ${ty}px, 0px) rotateY(${rotY}deg) rotateZ(${rotZ.toFixed(2)}deg) scale(${scale.toFixed(3)})`,
                zIndex,
                opacity,
              }}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('button')) return;
                if (didDrag.current) { didDrag.current = false; return; }
                event.stopPropagation();
                setConfirmRmId(null);
                playStepTick();
                onSelect(card.planItemId);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setConfirmRmId(null);
                  onSelect(card.planItemId);
                }
              }}
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest('button')) return;
                if (event.pointerType === 'mouse') event.preventDefault();
                const originIdx = rawItems.findIndex((it) => it.card.planItemId === card.planItemId);
                didDrag.current = false;
                clearTimers();
                // 已练过的历史动作不能拖动改顺序，只能排期当前时间点之后的待练动作
                if (originIdx < firstEditableIdx) return;
                const startM = deckMetrics(originIdx - baseActiveIdx);
                startPt.current = { x: event.clientX, y: event.clientY };
                lastMove.current = { x: event.clientX, t: performance.now() };
                edgeOffset.current = 0;
                longPressTimer.current = window.setTimeout(() => {
                  didDrag.current = true;
                  swipeStart.current = null;
                  setSwipeDx(0);
                  setDrag({
                    planItemId: card.planItemId,
                    originIdx,
                    currentIdx: originIdx,
                    startX: startM.x,
                    startY: startM.y,
                    dx: 0,
                    dy: 0,
                    tilt: 0,
                  });
                  playStepTick();
                  haptic(16);
                }, 210);
              }}
              onPointerMove={(event) => {
                if (!drag && Math.hypot(event.clientX - startPt.current.x, event.clientY - startPt.current.y) > 9) {
                  clearTimers();
                }
              }}
              onPointerUp={() => { if (!drag) clearTimers(); }}
              onPointerCancel={() => { if (!drag) clearTimers(); }}
            >
              <div className="ht-deck-top">
                <span className="ht-card-name">{card.name}</span>
                {canRemove ? (
                  confirmRmId === card.planItemId ? (
                    <button type="button" className="ht-rm-ok" onClick={(e) => { e.stopPropagation(); setConfirmRmId(null); onRemove(card.planItemId); }}>移除</button>
                  ) : (
                    <button type="button" className="ht-rm-btn" aria-label={`移出${card.name}`} onClick={(e) => { e.stopPropagation(); setConfirmRmId(card.planItemId); }}>×</button>
                  )
                ) : (
                  <span className="ht-card-dot" aria-hidden="true" />
                )}
              </div>
              <div className="ht-deck-art">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {media?.image ? <img src={media.image} alt="" loading="lazy" draggable={false} /> : null}
              </div>
              <div className="ht-deck-foot">
                <small>{sub}</small>
              </div>
            </div>
          );
        })}
      </div>

      {items.length > 1 && (
        <div className="ht-cf-dots" aria-hidden="true">
          {items.map(({ slot }, idx) => (
            <i key={slot.slotKey} data-on={idx === activeIdx || undefined} />
          ))}
        </div>
      )}
    </section>
  );
}
