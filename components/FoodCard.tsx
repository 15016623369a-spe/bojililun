'use client';

import { useMemo, useState } from 'react';
import type { FoodItem } from '@/lib/types';
import { macrosFor } from '@/lib/nutrition';
import { MEAL_LABEL, type MealType } from '@/lib/date';
import Icon from './ui/Icon';
import SplitNumber from './ui/SplitNumber';

const PORTIONS = [
  { scale: .5, label: '半份' },
  { scale: 1, label: '1 份' },
  { scale: 1.5, label: '1.5 份' },
  { scale: 2, label: '2 份' },
];
const haptic = (ms: number | number[] = 5) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };

const per100 = (it: FoodItem) => ({ kcal: it.kcal_100g, protein: it.protein_100g, carb: it.carb_100g, fat: it.fat_100g });

/**
 * 拍照识别结果：上面是半调处理的照片，下面是珊瑚色结果面板。
 * 份量可整体切换（半份 / 1 / 1.5 / 2 份），也可逐项 ±10 g；确认后写入这一餐。
 */
export default function FoodCard({
  mealType,
  items: initial,
  note,
  status,
  photoUrl,
  targets,
  onConfirm,
}: {
  mealType: MealType;
  items: FoodItem[];
  note?: string;
  status: 'open' | 'confirmed';
  photoUrl?: string;
  /** 每日营养参考，用来画宏量刻度条 */
  targets?: { protein: number; carb: number; fat: number };
  onConfirm: (items: FoodItem[]) => Promise<void>;
}) {
  const [base, setBase] = useState<FoodItem[]>(initial);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const open = status === 'open';
  const items = useMemo(() => base.map((it) => ({ ...it, grams: Math.max(0, Math.round(it.grams * scale)) })), [base, scale]);

  const total = useMemo(() => items.reduce((acc, it) => {
    const m = macrosFor(it.grams, per100(it));
    return { kcal: acc.kcal + m.kcal, protein: acc.protein + m.protein, carb: acc.carb + m.carb, fat: acc.fat + m.fat };
  }, { kcal: 0, protein: 0, carb: 0, fat: 0 }), [items]);
  const ref = targets ?? { protein: 120, carb: 280, fat: 70 };
  const confidence = Math.round(Math.max(...initial.map((it) => it.confidence ?? 0)) * 100);

  function nudge(index: number, delta: number) {
    haptic(4);
    setBase((prev) => prev.map((it, i) => (i === index ? { ...it, grams: Math.max(0, it.grams + delta / scale) } : it)));
  }

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(items);
      haptic([14, 50, 14]);
    } finally {
      setBusy(false);
    }
  }

  const macros = [
    { key: 'protein', label: '蛋白质', value: total.protein, target: ref.protein },
    { key: 'carb', label: '碳水', value: total.carb, target: ref.carb },
    { key: 'fat', label: '脂肪', value: total.fat, target: ref.fat },
  ];

  return (
    <div className="meal-card" data-status={status}>
      {photoUrl && <div className="meal-photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt="这一餐的照片" />
        <span className="meal-photo-dots" aria-hidden="true" />
        {confidence > 0 && <span className="meal-photo-tag">识别 · {initial[0]?.name} {confidence}%</span>}
      </div>}
      <section className="meal-sheet">
        <span className="meal-grab" aria-hidden="true" />
        <div className="meal-sheet-head">
          <span>{MEAL_LABEL[mealType]} · 识别结果</span>
          <span className="chip">{open ? '可修改' : '已记录'}</span>
        </div>
        <h3 className="meal-name">{initial[0]?.name ?? '这一餐'}{initial.length > 1 && <small> 等 {initial.length} 样</small>}</h3>
        <div className="meal-kcal" key={total.kcal}><SplitNumber value={total.kcal} /><em>kcal</em></div>

        {open && <div className="meal-portion" role="radiogroup" aria-label="整体份量">
          {PORTIONS.map((p) => <button key={p.scale} type="button" role="radio" aria-checked={scale === p.scale} className={scale === p.scale ? 'on' : ''}
            onClick={() => { haptic(6); setScale(p.scale); }}>{p.label}</button>)}
        </div>}

        <ul className="meal-items">
          {items.map((it, i) => <li key={`${it.name}-${i}`}>
            <span className="meal-item-name">{it.name}{!it.matched && <em>估算</em>}</span>
            {open ? <span className="meal-grams">
              <button type="button" aria-label={`${it.name}减少 10 克`} onClick={() => nudge(i, -10)} disabled={it.grams <= 0}><Icon name="minus" size={13} stroke={2.4} /></button>
              <b>{it.grams}<small>g</small></b>
              <button type="button" aria-label={`${it.name}增加 10 克`} onClick={() => nudge(i, 10)}><Icon name="plus" size={13} stroke={2.4} /></button>
            </span> : <span className="meal-grams static"><b>{it.grams}<small>g</small></b></span>}
            <span className="meal-item-kcal">{macrosFor(it.grams, per100(it)).kcal}<small> kcal</small></span>
          </li>)}
        </ul>

        <div className="meal-macros">
          {macros.map((m) => <div key={m.key} className="meal-macro">
            <span>{m.label}</span>
            <span className="meter-ticks" aria-hidden="true">{Array.from({ length: 40 }, (_, i) => <i key={i} data-on={i < Math.round(Math.min(1, m.value / Math.max(1, m.target)) * 40) || undefined} />)}</span>
            <b>{Math.round(m.value)} g</b>
          </div>)}
        </div>

        {note && open && <p className="meal-note">{note}</p>}

        {open ? <button type="button" className="ink-btn meal-confirm" disabled={busy} onClick={() => void confirm()}>
          <span>{busy ? '正在记录…' : `记入${MEAL_LABEL[mealType]}`}</span>
          <span className="ink-btn-meta"><Icon name="check" size={20} stroke={2.2} /></span>
        </button> : <p className="meal-done"><Icon name="check" size={16} stroke={2.4} />已记入今天的{MEAL_LABEL[mealType]}</p>}
      </section>
    </div>
  );
}
