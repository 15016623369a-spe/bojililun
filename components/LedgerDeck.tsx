'use client';

import { useEffect, useRef, useState } from 'react';
import type { Card } from '@/lib/export';
import type { CardPick } from '@/lib/ledger';
import LedgerCards from './fc/LedgerCards';
import GlassSheet, { type SheetOrigin } from './ui/GlassSheet';
import { calcMealTotals, formatWorkoutSummary } from '@/lib/calculations';
import Icon, { type IconName } from './ui/Icon';

/** 卡片上要显示的内容由服务端按手账数据算好传进来（时间按 APP_TZ），这里只负责排版和交互。 */
export type DeckItem = {
  key: string;
  /** 手账卡 id；体重记录没有，不能编辑 */
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
  plan_draft: { label: '计划草稿', icon: 'note' },
  body_metrics: { label: '体重', icon: 'chart' },
};
const KIND_CLASS: Record<DeckItem['kind'], string> = { workout: 'training', meal: 'meal', plan_draft: 'note', body_metrics: 'weight' };
const haptic = (ms = 5) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };
const fmt = (n: number) => Math.round(n).toLocaleString('zh-CN');
/** 背面最多列几行，多出来的写「还有 n 样 / 个动作」：饮食一行一样，训练一个动作占两行（名字 + 组次） */
const BACK_ROWS = { meal: 3, workout: 2 } as const;

/** 卡片背面的几行和底下一行合计（11 月 25 日：点卡片翻到背面看明细） */
function backOf(item: DeckItem, card: Card | undefined) {
  if (card?.entry_type === 'meal') {
    const totals = calcMealTotals(card.items);
    return {
      rows: card.items.map((i) => ({ name: [i.food_name, i.portion_text].filter(Boolean).join(' '), value: i.kcal === null ? '—' : `≈${fmt(i.kcal)}` })),
      more: '样', stack: false, max: BACK_ROWS.meal,
      foot: [totals.kcal !== null ? `≈${fmt(totals.kcal)} kcal` : null, totals.protein_g !== null ? `蛋白 ${fmt(totals.protein_g)} g` : null].filter(Boolean).join(' · '),
    };
  }
  if (card?.entry_type === 'workout') {
    const sets = card.exercises.flatMap((m) => m.sets);
    const volume = sets.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
    return {
      rows: card.exercises.map((m) => ({ name: m.exercise_name, value: m.sets.length ? formatWorkoutSummary(m.sets) : '组数待补' })),
      more: '个动作', stack: true, max: BACK_ROWS.workout,
      foot: [sets.length ? `${sets.length} 组` : null, volume ? `${fmt(volume)} kg` : null].filter(Boolean).join(' · '),
    };
  }
  return { rows: [{ name: item.title, value: '' }], more: '', stack: false, max: 1, foot: item.sub };
}

/**
 * 记录页的一天（手账数据）：卡片按时间往下排成两列，和回顾的小块同尺寸、同圆角。
 * 点一张卡它就翻到背面，列出吃了什么 / 练了什么和合计；再点一下翻回来（11 月 25 日用户要求，不再横向滑动、不常驻明细）。
 * 背面的「编辑」打开回顾那种毛玻璃抽屉（GlassSheet），里面是 main 原有的卡片编辑（快选、备注、份量重算、移除）。
 * 从别处带 ?card= 进来时直接翻开那张卡。
 */
export default function LedgerDeck({ items, cards, picks, past = false, selectedCard }: {
  /** 回看过去某天：空状态不提示录入 */
  past?: boolean;
  items: DeckItem[];
  cards: Card[];
  picks: Record<number, CardPick | null>;
  selectedCard?: number;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState<string | null>(() => items.find((item) => selectedCard !== undefined && item.cardId === selectedCard)?.key ?? null);
  const [editing, setEditing] = useState<string | null>(null);
  const origin = useRef<SheetOrigin | null>(null);
  const pick = editing ? items.find((item) => item.key === editing) : undefined;
  const card = pick?.cardId !== undefined ? cards.find((c) => c.id === pick.cardId) : undefined;

  // 带 ?card= 进来（回顾里点某一餐）：把那张卡滚到眼前，已经是翻开的
  useEffect(() => {
    if (!flipped) return;
    grid.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(flipped)}"]`)?.scrollIntoView({ block: 'center' });
    // 只在进页面时对一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 编辑抽屉开着时那张卡被移除了（例如在抽屉里删掉）：直接收起
  useEffect(() => {
    if (!editing || pick) return;
    if (history.state?.recordSheet !== undefined) history.replaceState(null, '');
    setEditing(null);
  }, [editing, pick]);

  function flip(key: string) {
    haptic(6);
    setFlipped((cur) => (cur === key ? null : key));
  }

  function edit(item: DeckItem, el: HTMLElement | null, keyboard: boolean) {
    if (!el || editing) return;
    haptic(8);
    origin.current = { el, rect: el.getBoundingClientRect(), keyboard };
    history.pushState({ recordSheet: item.key }, '');
    setEditing(item.key);
  }

  return <section className="day-deck ledger-deck" aria-label={past ? '这天的记录' : '今天的记录'}>
    <div className="deck deck-grid" ref={grid}>
      {items.length === 0 && <div className="deck-card empty">
        <span className="deck-kind"><Icon name="note" size={17} />这一天</span>
        <strong>这天没有记录</strong>
        <small>点左上角「月历」可查看其他日期。</small>
      </div>}
      {items.map((item) => {
        const c = item.cardId !== undefined ? cards.find((x) => x.id === item.cardId) : undefined;
        const back = backOf(item, c);
        const isFlipped = flipped === item.key;
        return <article key={item.key} data-key={item.key} className={`deck-card ${KIND_CLASS[item.kind]}`}
          data-flipped={isFlipped || undefined} data-lifted={editing === item.key || undefined}>
          {/* 正面：类别、标题、时间 */}
          <button type="button" className="deck-card-body deck-face" aria-expanded={isFlipped} aria-hidden={isFlipped || undefined}
            tabIndex={isFlipped ? -1 : 0} onClick={() => flip(item.key)}>
            <span className="deck-kind"><Icon name={KIND[item.kind].icon} size={17} />{KIND[item.kind].label}
              {item.pending && <em className="deck-pending">{item.kind === 'meal' ? '可校正' : '待补'}</em>}</span>
            <strong>{item.title}</strong>
            <b className="big-num">{item.time}</b>
            {item.sub && <small>{item.sub}</small>}
          </button>
          {/* 背面：明细几行 + 合计；点空白处翻回去，「编辑」打开抽屉 */}
          <div className="deck-face deck-back" aria-hidden={!isFlipped || undefined} onClick={() => flip(item.key)}>
            <div className="deck-back-head">
              <span className="deck-back-kind">{KIND[item.kind].label}</span>
              {c && <button type="button" className="deck-back-edit" tabIndex={isFlipped ? 0 : -1}
                onClick={(e) => { e.stopPropagation(); edit(item, e.currentTarget.closest<HTMLElement>('.deck-card'), e.detail === 0); }}>编辑</button>}
            </div>
            {item.kind === 'body_metrics'
              ? <b className="deck-back-big">{item.title.replace(/ kg$/, '')}<small>kg</small></b>
              : <ul className={`deck-back-rows${back.stack ? ' stack' : ''}`}>
                {back.rows.slice(0, back.max).map((row, i) => <li key={i}><span>{row.name}</span>{row.value && <b>{row.value}</b>}</li>)}
                {back.rows.length > back.max && <li className="more"><span>还有 {back.rows.length - back.max} {back.more}</span></li>}
              </ul>}
            {back.foot && <p className="deck-back-foot">{back.foot}</p>}
          </div>
        </article>;
      })}
    </div>

    {pick && <GlassSheet key={pick.key} origin={origin} historyKey="recordSheet"
      title={pick.title} kicker={`${KIND[pick.kind].label} · ${pick.time}`}
      parts=".journal-shell > .journal-head, .journal-shell > .journal-content > :not(.ledger-dock-scope)"
      onClosed={() => setEditing(null)}>
      <div className="fc ledger-detail rw-rise" style={{ '--i': 1 } as React.CSSProperties}>
        {card?.entry_type === 'workout' && card.exercises.length > 0 && <ol className="ledger-moves">
          {card.exercises.map((m, i) => {
            const volume = m.sets.reduce((sum, set) => sum + (set.weight_kg ?? 0) * (set.reps ?? 0), 0);
            return <li key={i}>
              <b>{m.exercise_name}</b>
              <span>{m.sets.length ? formatWorkoutSummary(m.sets) : '组数待补'}</span>
              {volume > 0 && <small>{fmt(volume)}<i>kg</i></small>}
            </li>;
          })}
        </ol>}
        {card && <LedgerCards cards={[card]} picks={{ [card.id]: picks[card.id] ?? null }} />}
      </div>
    </GlassSheet>}
  </section>;
}
