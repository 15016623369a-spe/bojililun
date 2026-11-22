'use client';

import { useRef, useState } from 'react';

const CELLS = 5;
const haptic = (ms = 5) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };

/**
 * 今日精力：一节由圆点拼成的电池，分五格。点哪格充到哪格，也可以按住横向拖；
 * 充入时点阵从左往右依次亮起，右侧读出百分比。保存到 day_energy 表。
 */
export default function DayBattery({ date, initial }: { date: string; initial: number | null }) {
  const [level, setLevel] = useState<number | null>(initial);
  const [error, setError] = useState('');
  const saved = useRef<number | null>(initial);
  const drag = useRef<number | null>(null);
  const body = useRef<HTMLDivElement>(null);

  function levelAt(clientX: number) {
    const box = body.current?.getBoundingClientRect();
    if (!box) return null;
    return Math.min(CELLS, Math.max(1, Math.ceil(((clientX - box.left) / box.width) * CELLS)));
  }
  function preview(next: number | null) {
    if (next === null) return;
    setLevel((current) => {
      if (current !== next) haptic(4);
      return next;
    });
  }
  async function commit(next: number | null) {
    if (next === saved.current) return;
    const previous = saved.current;
    saved.current = next;
    setError('');
    try {
      const res = await fetch('/api/day-energy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, level: next }),
      });
      if (!res.ok) throw new Error();
      haptic(10);
    } catch {
      saved.current = previous;
      setLevel(previous);
      setError('没保存上，再点一次');
    }
  }

  return <section className="day-battery" aria-label="今日精力">
    <div className="day-battery-head">
      <span className="day-battery-label">精力</span>
      <span className="day-battery-read" aria-live="polite">
        {level ? <><b className="big-num">{level * 20}</b><em>%</em></> : <b className="big-num empty">--</b>}
      </span>
    </div>
    <div className="day-battery-shell">
      <div ref={body} className="day-battery-body" role="slider" tabIndex={0} aria-label="今日精力"
        aria-valuemin={1} aria-valuemax={CELLS} aria-valuenow={level ?? undefined} aria-valuetext={level ? `${level * 20}%` : '未记录'}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = event.pointerId;
          preview(levelAt(event.clientX));
        }}
        onPointerMove={(event) => { if (drag.current === event.pointerId) preview(levelAt(event.clientX)); }}
        onPointerUp={(event) => {
          if (drag.current !== event.pointerId) return;
          drag.current = null;
          const next = levelAt(event.clientX);
          if (next !== null) void commit(next);
        }}
        onPointerCancel={() => { drag.current = null; setLevel(saved.current); }}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? Math.min(CELLS, (level ?? 0) + 1)
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? Math.max(1, (level ?? 2) - 1) : null;
          if (next === null) return;
          event.preventDefault();
          setLevel(next);
          void commit(next);
        }}>
        {Array.from({ length: CELLS }, (_, i) => <span key={i} className="day-battery-cell" data-on={level !== null && i < level || undefined}
          style={{ '--i': i } as React.CSSProperties}>
          {Array.from({ length: 6 }, (__, d) => <i key={d} />)}
        </span>)}
      </div>
      <span className="day-battery-nub" aria-hidden="true" />
    </div>
    {error && <p className="day-battery-error" role="alert">{error}</p>}
  </section>;
}
