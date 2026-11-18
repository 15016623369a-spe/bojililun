'use client';

import { useMemo, useState } from 'react';
import type { FoodItem } from '@/lib/types';
import { macrosFor } from '@/lib/nutrition';
import { MEAL_LABEL, type MealType } from '@/lib/date';

export default function FoodCard({
  mealType,
  items: initial,
  note,
  status,
  onConfirm,
}: {
  mealType: MealType;
  items: FoodItem[];
  note?: string;
  status: 'open' | 'confirmed';
  onConfirm: (items: FoodItem[]) => Promise<void>;
}) {
  const [items, setItems] = useState<FoodItem[]>(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const total = useMemo(() => {
    return items.reduce(
      (acc, it) => {
        const m = macrosFor(it.grams, {
          kcal: it.kcal_100g,
          protein: it.protein_100g,
          carb: it.carb_100g,
          fat: it.fat_100g,
        });
        return {
          kcal: acc.kcal + m.kcal,
          protein: Math.round((acc.protein + m.protein) * 10) / 10,
        };
      },
      { kcal: 0, protein: 0 },
    );
  }, [items]);

  function setGrams(index: number, grams: number) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, grams } : it)));
  }

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(items);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <b>{MEAL_LABEL[mealType]} · 识别结果</b>
        <span>{status === 'confirmed' ? '已记录' : `${items.length} 项`}</span>
      </div>

      {items.map((it, i) => {
        const m = macrosFor(it.grams, {
          kcal: it.kcal_100g,
          protein: it.protein_100g,
          carb: it.carb_100g,
          fat: it.fat_100g,
        });
        return (
          <div className="frow" key={`${it.name}-${i}`}>
            <div className="fname">
              {it.name}
              {!it.matched && <span className="tag">模型估算</span>}
            </div>
            {editing ? (
              <div className="fgrams">
                <input
                  type="number"
                  inputMode="decimal"
                  value={it.grams}
                  onChange={(e) => setGrams(i, Number(e.target.value))}
                />
              </div>
            ) : (
              <div className="fgrams">
                <span>{it.grams}g</span>
              </div>
            )}
            <div className="fkcal">{m.kcal} kcal</div>
          </div>
        );
      })}

      <div className="ftotal">
        <span>合计 · 蛋白质 {total.protein}g</span>
        <b>{total.kcal} kcal</b>
      </div>

      {status === 'open' ? (
        <div className="factions">
          <button className="btn primary" disabled={busy} onClick={confirm}>
            {busy ? '记录中…' : '✓ 都对，记下来'}
          </button>
          <button className="btn" onClick={() => setEditing((v) => !v)}>
            {editing ? '改完了' : '✎ 改份量'}
          </button>
        </div>
      ) : (
        <p className="note" style={{ borderColor: 'var(--line)', background: 'var(--sage)', color: 'var(--accent)' }}>
          ✓ 已记入今日
        </p>
      )}

      {note && status === 'open' && <p className="note">{note}</p>}
    </div>
  );
}
