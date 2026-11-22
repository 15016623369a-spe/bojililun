'use client';

import { useEffect, useRef } from 'react';

const DRAG_THRESHOLD = 5;

/**
 * 黑色胶囊刻度尺：横向滑动、鼠标按住拖动或点刻度都能改值，松手吸附到刻度，中间红针读数。
 * 重量、体重、份量共用；gap 是每格的像素间距（训练中用更宽的格子）。
 */
export default function TickRuler({ value, min, max, step, onChange, major = 10, label, unit = '', gap = 9 }: {
  gap?: number;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** 每多少格一根长刻度并标数字。 */
  major?: number;
  label: string;
  unit?: string;
}) {
  const GAP = gap;
  const track = useRef<HTMLDivElement>(null);
  const indexRef = useRef<number | null>(null);
  const drag = useRef<{ pointer: number; x: number; scroll: number; moved: boolean } | null>(null);
  const ignoreClick = useRef(false);
  const count = Math.round((max - min) / step);
  const visibleValue = Math.min(max, Math.max(min, value));
  const index = Math.round((visibleValue - min) / step);

  useEffect(() => {
    if (index === indexRef.current) return;
    indexRef.current = index;
    if (track.current) track.current.scrollLeft = index * GAP;
  }, [index]);

  function publish(position: number) {
    const next = Math.max(0, Math.min(count, Math.round(position)));
    if (next === indexRef.current) return;
    indexRef.current = next;
    onChange(+(min + next * step).toFixed(6));
  }

  function select(position: number) {
    const next = Math.max(0, Math.min(count, position));
    publish(next);
    if (track.current) track.current.scrollLeft = next * GAP;
  }

  return (
    <div className="tick-ruler" role="slider" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={visibleValue}
      aria-valuetext={`${visibleValue} ${unit}`.trim()} tabIndex={0}
      onKeyDown={(event) => {
        const keys: Record<string, number> = {
          ArrowRight: index + 1, ArrowUp: index + 1, ArrowLeft: index - 1, ArrowDown: index - 1,
          Home: 0, End: count,
        };
        if (!Object.hasOwn(keys, event.key)) return;
        event.preventDefault();
        select(keys[event.key]);
      }}>
      <div className="tick-ruler-track" ref={track}
        onScroll={(event) => publish(event.currentTarget.scrollLeft / GAP)}
        onScrollEnd={(event) => {
          if (!drag.current) select(Math.round(event.currentTarget.scrollLeft / GAP));
        }}
        onPointerDown={(event) => {
          ignoreClick.current = false;
          if (event.pointerType !== 'mouse' || event.button !== 0) return;
          drag.current = { pointer: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const press = drag.current;
          if (!press || press.pointer !== event.pointerId) return;
          const travel = event.clientX - press.x;
          if (Math.abs(travel) >= DRAG_THRESHOLD) press.moved = true;
          if (press.moved) event.currentTarget.scrollLeft = press.scroll - travel;
        }}
        onPointerUp={(event) => {
          const press = drag.current;
          if (press?.pointer !== event.pointerId) return;
          drag.current = null;
          ignoreClick.current = press.moved;
          if (press.moved) select(Math.round(event.currentTarget.scrollLeft / GAP));
        }}
        onLostPointerCapture={() => { drag.current = null; }}
        onClick={(event) => {
          if (ignoreClick.current) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const offset = event.clientX - bounds.left - bounds.width / 2;
          select(Math.round((event.currentTarget.scrollLeft + offset) / GAP));
        }}>
        <div className="tick-ruler-ticks" style={{ width: count * GAP }} aria-hidden="true">
          {Array.from({ length: count + 1 }, (_, i) => {
            const isMajor = i % major === 0;
            const half = !isMajor && major % 2 === 0 && i % (major / 2) === 0;
            return <i key={i} className={isMajor ? 'major' : half ? 'half' : undefined} style={{ left: i * GAP }}>
              {isMajor && <b>{+(min + i * step).toFixed(2)}</b>}
            </i>;
          })}
        </div>
      </div>
      <span className="tick-ruler-needle" aria-hidden="true" />
    </div>
  );
}
