'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

/** 打开抽屉的那块卡片：抽屉从它的轮廓长开，收起时缩回去 */
export type SheetOrigin = { el: HTMLElement; rect: DOMRect; keyboard: boolean };

const SPRING = 'linear(0, 0.006 1.1%, 0.024 2.2%, 0.094 4.5%, 0.393 11.5%, 0.615 17.4%, 0.77 23.1%, 0.878 29%, 0.947 35.3%, 0.988 42.2%, 1.008 50%, 1.015 59.3%, 1.013 71.3%, 1)';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const haptic = (ms = 5) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };

/**
 * 回顾数据块那种毛玻璃抽屉，回顾和记录共用（11 月 25 日从 ReviewWall 抽出来）。
 * 从点的那块卡片原位长开，背后页面缩到 0.93、不压暗不虚化；下拉、点背后、返回键或 Esc 收起，⤢ 展开全屏。
 * 打开前由调用方 history.pushState({ [historyKey]: … })，这样返回键先收抽屉。
 * parts 是跟着缩小的页面部分：默认整个页头和正文；记录页把底部录音条排除在外（它在正文里、是 fixed，跟着缩会跳位）。
 */
export default function GlassSheet({ title, kicker, origin, onClosed, historyKey, parts = '.journal-shell > :is(.journal-head, .journal-content)', children }: {
  title: ReactNode;
  /** 标题上方一行小字 */
  kicker?: ReactNode;
  origin: React.MutableRefObject<SheetOrigin | null>;
  onClosed: () => void;
  historyKey: string;
  parts?: string;
  children: ReactNode;
}) {
  const [full, setFull] = useState(false);
  const [phase, setPhase] = useState<'enter' | 'open' | 'closing'>('enter');
  const sheet = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ y0: number; last: number; t: number; v: number; dy: number; h: number } | null>(null);
  const closing = useRef(false);
  const shell = useCallback(() => document.querySelector<HTMLElement>('.journal-shell'), []);

  const insetOf = useCallback(() => {
    const s = sheet.current?.getBoundingClientRect();
    const o = origin.current?.rect;
    if (!s || !o) return null;
    const r = { t: o.top - s.top, l: o.left - s.left, r: s.right - o.right, b: s.bottom - o.bottom };
    return r.t >= 0 && r.b >= 0 ? r : null;
  }, [origin]);

  // 打开：背后页面缩小，抽屉从那块卡片的轮廓长开
  useLayoutEffect(() => {
    const root = shell();
    const html = document.documentElement;
    const scaled = [...document.querySelectorAll<HTMLElement>(parts)];
    for (const el of scaled) {
      el.setAttribute('data-rw-part', '');
      el.style.setProperty('--rw-oy', `${Math.round(70 - el.getBoundingClientRect().top)}px`);
    }
    root?.setAttribute('data-rw-open', '');
    html.classList.add('rw-lock');
    const r = insetOf();
    if (!reduced() && sheet.current) {
      if (r) sheet.current.animate([{ clipPath: `inset(${r.t}px ${r.r}px ${r.b}px ${r.l}px round 22px)` }, { clipPath: 'inset(0px 0px 0px 0px round 30px 30px 0px 0px)' }], { duration: 640, easing: SPRING });
      else sheet.current.animate([{ translate: '0 100%' }, { translate: '0 0' }], { duration: 620, easing: SPRING });
    }
    if (origin.current?.keyboard) window.setTimeout(() => closeBtn.current?.focus({ preventScroll: true }), 300);
    const t = window.setTimeout(() => setPhase('open'), 900);
    return () => {
      window.clearTimeout(t);
      root?.removeAttribute('data-rw-open');
      root?.removeAttribute('data-rw-drag');
      root?.style.removeProperty('--rw-p');
      html.classList.remove('rw-lock');
    };
  }, [insetOf, origin, parts, shell]);

  const finish = useCallback((viaDrag: boolean) => {
    if (closing.current) return;
    closing.current = true;
    setPhase('closing');
    const root = shell();
    root?.removeAttribute('data-rw-open');
    root?.style.removeProperty('--rw-p');
    const el = sheet.current;
    const r = insetOf();
    if (!el || reduced()) { onClosed(); return; }
    if (!viaDrag && !full && r) {
      const a = el.animate([{ clipPath: 'inset(0px 0px 0px 0px round 30px 30px 0px 0px)' }, { clipPath: `inset(${r.t}px ${r.r}px ${r.b}px ${r.l}px round 22px)` }],
        { duration: 460, easing: 'cubic-bezier(.3,.7,.1,1)', fill: 'forwards' });
      a.onfinish = onClosed;
      return;
    }
    const from = el.style.translate || '0 0';
    el.style.translate = '';
    const a = el.animate([{ translate: from }, { translate: '0 105%' }], { duration: 380, easing: 'cubic-bezier(.3,.7,.1,1)', fill: 'forwards' });
    a.onfinish = onClosed;
  }, [full, insetOf, onClosed, shell]);

  // 返回键：先收起抽屉
  const viaDragRef = useRef(false);
  useEffect(() => {
    const onPop = () => finish(viaDragRef.current);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [finish]);

  const close = useCallback((viaDrag = false) => {
    viaDragRef.current = viaDrag;
    if (history.state?.[historyKey] !== undefined) history.back();
    else finish(viaDrag);
  }, [finish, historyKey]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  function dragStart(e: PointerEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest('button') || !sheet.current) return;
    drag.current = { y0: e.clientY, last: e.clientY, t: performance.now(), v: 0, dy: 0, h: sheet.current.offsetHeight };
    shell()?.setAttribute('data-rw-drag', '');
    sheet.current.dataset.drag = '';
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function dragMove(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || !sheet.current) return;
    const now = performance.now(), raw = e.clientY - d.y0;
    d.v = (e.clientY - d.last) / Math.max(1, now - d.t); d.last = e.clientY; d.t = now;
    d.dy = raw < 0 ? raw * 0.18 : raw;
    sheet.current.style.translate = `0 ${d.dy}px`;
    shell()?.style.setProperty('--rw-p', String(Math.max(0, Math.min(1, d.dy / d.h))));
  }
  function dragEnd() {
    const d = drag.current;
    if (!d || !sheet.current) return;
    drag.current = null;
    delete sheet.current.dataset.drag;
    shell()?.removeAttribute('data-rw-drag');
    if (d.dy > 140 || d.v > 0.55) { haptic(8); close(true); return; }
    sheet.current.style.translate = '';
    shell()?.style.removeProperty('--rw-p');
  }
  const dragProps = { onPointerDown: dragStart, onPointerMove: dragMove, onPointerUp: dragEnd, onPointerCancel: dragEnd };

  return createPortal(<div className="rw-layer">
    <div className="rw-scrim" onClick={() => close()} />
    <section ref={sheet} className={`rw-sheet${full ? ' full' : ''}`} data-phase={phase} role="dialog" aria-modal="true" aria-labelledby="rw-sheet-title">
      <div className="rw-grab" {...dragProps}><i /></div>
      <header className="rw-sheet-head" {...dragProps}>
        <div className="rw-sheet-titles">
          {kicker && <p className="rw-sheet-kicker">{kicker}</p>}
          <h2 id="rw-sheet-title">{title}</h2>
        </div>
        <div className="rw-sheet-btns">
          <button type="button" className="rw-icon-btn" aria-label={full ? '收回' : '展开到全屏'} onClick={() => { haptic(); setFull(!full); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={full ? 'M4 14h6v6M20 10h-6V4M10 14l-6 6M14 10l6-6' : 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7'} />
            </svg>
          </button>
          <button ref={closeBtn} type="button" className="rw-icon-btn" aria-label="关闭" onClick={() => close()}><Icon name="close" size={15} stroke={2.3} /></button>
        </div>
      </header>
      <div className="rw-sheet-body">{children}</div>
    </section>
  </div>, document.body);
}
