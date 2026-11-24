'use client';

import { useEffect, useRef, useState } from 'react';
import type { Card } from '@/lib/export';
import type { CardPick } from '@/lib/ledger';
import LedgerCards from './fc/LedgerCards';
import { formatWorkoutSummary } from '@/lib/calculations';
import Icon, { type IconName } from './ui/Icon';

/** 卡片上要显示的内容由服务端按手账数据算好传进来（时间按 APP_TZ），这里只负责排版和交互。 */
export type DeckItem = {
  key: string;
  /** 手账卡 id；体重记录没有，不能在下方编辑 */
  cardId?: number;
  kind: 'workout' | 'meal' | 'plan_draft' | 'body_metrics';
  time: string;
  minutes: number;
  title: string;
  sub: string;
  pending: boolean;
};

const KIND: Record<DeckItem['kind'], { label: string; icon: IconName }> = {
  workout: { label: '训练', icon: 'dumbbell' },
  meal: { label: '饮食', icon: 'bowl' },
  plan_draft: { label: '轻计划', icon: 'note' },
  body_metrics: { label: '体重', icon: 'chart' },
};
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const haptic = (ms = 5) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };

/**
 * 记录页的一天（手账数据）：时间刻度上每条记录一根标记，下方横向卡片按时间排开；
 * 选中的手账卡在下面展开 main 原有的卡片编辑（快选、备注、份量重算）。
 */
export default function LedgerDeck({ items, cards, picks, nowMinutes, past = false, selectedCard }: {
  /** 回看过去某天：空状态不提示录入 */
  past?: boolean;
  items: DeckItem[];
  cards: Card[];
  picks: Record<number, CardPick | null>;
  nowMinutes: number | null;
  selectedCard?: number;
}) {
  const deck = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const firstPending = items.findIndex((item) => item.pending);
  const [activeKey, setActiveKey] = useState(() => (
    items.find(item => selectedCard !== undefined && item.cardId === selectedCard)
    ?? items[firstPending >= 0 ? firstPending : items.length - 1]
  )?.key);
  const index = items.findIndex((item) => item.key === activeKey);
  const active = index >= 0 ? index : Math.max(0, items.length - 1);
  const [now, setNow] = useState(nowMinutes);

  const start = Math.max(0, Math.min(8 * 60, Math.floor((Math.min(...items.map((i) => i.minutes), 24 * 60) - 60) / 120) * 120));
  const end = Math.min(24 * 60, Math.max(20 * 60, Math.ceil((Math.max(...items.map((i) => i.minutes), now ?? 0) + 60) / 120) * 120));
  const span = end - start;
  const labels = Array.from({ length: Math.floor(span / 240) + 1 }, (_, i) => start + i * 240);
  const pick = items[active];
  const card = pick?.cardId !== undefined ? cards.find((c) => c.id === pick.cardId) : undefined;

  useEffect(() => {
    if (nowMinutes === null) return;
    const id = window.setInterval(() => setNow((m) => (m === null ? m : Math.min(24 * 60, m + 1))), 60_000);
    return () => window.clearInterval(id);
  }, [nowMinutes]);

  useEffect(() => {
    const el = deck.current;
    const target = el?.querySelectorAll<HTMLElement>('.deck-card')[active];
    if (el && target) el.scrollLeft = target.offsetLeft - el.offsetLeft - 24;
    // 只在初次挂载和记录条数变化时对齐
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  function go(index: number) {
    const el = deck.current;
    const target = el?.querySelectorAll<HTMLElement>('.deck-card')[index];
    if (!el || !target) return;
    haptic(4);
    setActiveKey(items[index]?.key);
    el.scrollTo({ left: target.offsetLeft - el.offsetLeft - 24, behavior: 'smooth' });
  }

  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = deck.current;
      if (!el) return;
      const list = [...el.querySelectorAll<HTMLElement>('.deck-card')];
      const left = el.scrollLeft + 24;
      let best = 0;
      list.forEach((c, i) => { if (Math.abs(c.offsetLeft - el.offsetLeft - left) < Math.abs(list[best].offsetLeft - el.offsetLeft - left)) best = i; });
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4) best = list.length - 1;
      setActiveKey(items[best]?.key);
    });
  }

  return <section className="day-deck ledger-deck" aria-label={past ? '这天的记录' : '今天的记录'}>
    <div className="day-ruler">
      <div className="day-ruler-ticks" aria-hidden="true">
        {Array.from({ length: span / 10 + 1 }, (_, i) => <i key={i} className={i % 6 === 0 ? 'hour' : undefined} />)}
      </div>
      {items.map((item, i) => <button key={item.key} type="button" className={`day-mark ${item.kind === 'workout' ? 'training' : item.kind === 'meal' ? 'meal' : item.kind === 'body_metrics' ? 'weight' : 'note'}`}
        data-active={i === active || undefined} style={{ left: `${((item.minutes - start) / span * 100).toFixed(2)}%` }}
        aria-label={`${item.time} ${KIND[item.kind].label}`} onClick={() => go(i)} />)}
      {now !== null && now >= start && now <= end && <span className="day-now" aria-hidden="true" style={{ left: `${((now - start) / span * 100).toFixed(2)}%` }} />}
    </div>
    <div className="day-ruler-axis" aria-hidden="true">
      {labels.map((m) => <span key={m} style={{ left: `${((m - start) / span * 100).toFixed(2)}%` }}>{hhmm(m)}</span>)}
    </div>

    <div className="deck" ref={deck} onScroll={onScroll}>
      {items.length === 0 && <div className="deck-card empty">
        <span className="deck-kind"><Icon name="mic" size={17} />开始记录</span>
        <b className="big-num">--:--</b>
        <strong>{past ? '这天没有记录' : '今天还没有记录'}</strong>
        <small>{past ? '可以在月历里换一天看看。' : '用下方的键盘、录音或相机记第一条。'}</small>
      </div>}
      {items.map((item, i) => <article key={item.key} className={`deck-card ${item.kind === 'workout' ? 'training' : item.kind === 'meal' ? 'meal' : item.kind === 'body_metrics' ? 'weight' : 'note'}`}
        data-active={i === active || undefined}>
        <button type="button" className="deck-card-body" aria-pressed={i === active} onClick={() => go(i)}>
          <span className="deck-kind"><Icon name={KIND[item.kind].icon} size={17} />{KIND[item.kind].label}
            {item.pending && <em className="deck-pending">{item.kind === 'meal' ? '可校正' : '待补'}</em>}</span>
          <strong>{item.title}</strong>
          <b className="big-num">{item.time}</b>
          {item.sub && <small>{item.sub}</small>}
        </button>
      </article>)}
      <span className="deck-tail" aria-hidden="true" />
    </div>

    {items.length > 1 && <div className="deck-dots" aria-hidden="true">
      {items.map((item, i) => <i key={item.key} data-active={i === active || undefined} data-pending={item.pending || undefined} />)}
    </div>}

    {pick && <div className="fc ledger-detail" key={pick.key}>
      <header className="ledger-detail-hd"><span>{KIND[pick.kind].label}明细</span><b>{pick.time}</b></header>
      {card?.entry_type === 'workout' && card.exercises.length > 0 && <ol className="ledger-moves">
        {card.exercises.map((m, i) => {
          const volume = m.sets.reduce((sum, set) => sum + (set.weight_kg ?? 0) * (set.reps ?? 0), 0);
          return <li key={i}>
            <b>{m.exercise_name}</b>
            <span>{m.sets.length ? formatWorkoutSummary(m.sets) : '组数待补'}</span>
            {volume > 0 && <small>{Math.round(volume).toLocaleString('zh-CN')}<i>kg</i></small>}
          </li>;
        })}
      </ol>}
      {card
        ? <LedgerCards cards={[card]} picks={{ [card.id]: picks[card.id] ?? null }} />
        : <div className="ledger-metric"><b>{pick.title.replace(/ kg$/, '')}<small>kg</small></b><p>{pick.sub}</p></div>}
    </div>}
  </section>;
}
