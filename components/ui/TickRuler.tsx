'use client';

import { useEffect, useRef } from 'react';

/**
 * 黑色胶囊刻度尺：横向滑动吸附到刻度，中间红针读数。重量、体重、份量共用。
 * 每过一格轻触一下（Android 振动；iOS 网页无振动接口时只有视觉吸附）。
 */
export default function TickRuler({ value, min, max, step, onChange, major = 10, label, unit = '' }: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** 每多少格一根长刻度并标数字 */
  major?: number;
  label: string;
  unit?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const last = useRef(value);
  const settling = useRef(false);
  const GAP = 9;
  const count = Math.round((max - min) / step);

  // 外部改值（输入框、±按钮）时把刻度尺滚到对应位置
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const target = Math.round((Math.min(max, Math.max(min, value)) - min) / step) * GAP;
    if (Math.abs(el.scrollLeft - target) > 1) {
      settling.current = true;
      el.scrollTo({ left: target, behavior: last.current === value ? 'auto' : 'smooth' });
      window.setTimeout(() => { settling.current = false; }, 420);
    }
    last.current = value;
  }, [value, min, max, step]);

  function onScroll() {
    const el = track.current;
    if (!el || settling.current) return;
    const index = Math.max(0, Math.min(count, Math.round(el.scrollLeft / GAP)));
    const next = +(min + index * step).toFixed(2);
    if (next !== last.current) {
      last.current = next;
      try { navigator.vibrate?.(3); } catch { /* 无振动接口 */ }
      onChange(next);
    }
  }

  function nudge(direction: number) {
    const next = Math.min(max, Math.max(min, +(value + direction * step).toFixed(2)));
    onChange(next);
  }

  return (
    <div className="tick-ruler" role="slider" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
      aria-valuetext={`${value}${unit}`} tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); nudge(1); }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); nudge(-1); }
      }}>
      <div className="tick-ruler-track" ref={track} onScroll={onScroll}>
        <div className="tick-ruler-ticks" style={{ width: count * GAP }}>
          {Array.from({ length: count + 1 }, (_, i) => {
            const isMajor = i % major === 0;
            const half = !isMajor && i % (major / 2) === 0;
            return <i key={i} className={isMajor ? 'major' : half ? 'half' : undefined} style={{ left: i * GAP }}>
              {isMajor && <b>{+(min + i * step).toFixed(1)}</b>}
            </i>;
          })}
        </div>
      </div>
      <span className="tick-ruler-needle" aria-hidden="true" />
    </div>
  );
}
