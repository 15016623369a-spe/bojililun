'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CardPick } from '@/lib/ledger';
import type { Card } from '@/lib/export';
import { calcMealTotals, formatDisplayKcal, formatWorkoutSummary } from '@/lib/calculations';
export default function LedgerCards({
  cards,
  picks,
}: {
  cards: Card[];
  picks: Record<number, CardPick | null>;
}) {
  const router = useRouter(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [hideKcal, setHideKcal] = useState(false);
  useEffect(() => setHideKcal(localStorage.getItem('ledger.hideKcal') === '1'), []);
  async function patch(payload: object) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/ledger', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw Error((await res.json()).error);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="今天的记录">
      {cards.map((c) => (
        <article className="fc-card" style={{ marginBlock: 12, paddingBottom: 12 }} key={c.id}>
          <small>
            {new Date(c.logged_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} ·{' '}
            {c.entry_type === 'meal' ? '饮食' : c.entry_type === 'workout' ? '训练' : '轻计划'}
          </small>
          <h3>{c.summary_title}</h3>
          {c.entry_type === 'meal' && (
            <button
              type="button"
              aria-label={hideKcal ? '显示热量' : '隐藏热量'}
              onClick={() => {
                setHideKcal(!hideKcal);
                localStorage.setItem('ledger.hideKcal', hideKcal ? '0' : '1');
              }}
            >
              <small>{hideKcal ? '显示估算' : formatDisplayKcal(calcMealTotals(c.items).kcal)}</small>
            </button>
          )}
          {c.exercises.map((m, index) => (
            <div key={index}>{formatWorkoutSummary(m.sets, m.exercise_name)}</div>
          ))}
          {c.items
            .filter((i) => i.nutrition_basis)
            .map((i) => {
              const basis = i.nutrition_basis!;
              const label = { tfda: '台湾食药署', usda: 'USDA', ai: 'AI' }[basis.source];
              return (
                <small key={i.id} style={{ display: 'block' }}>
                  {i.food_name} · {label}估算 · {basis.assumption ?? i.portion_text ?? '份量未注明'}
                </small>
              );
            })}
          {c.note && <p>{c.note}</p>}
          {picks[c.id] && (
            <fieldset className="fc-quick-pick">
              <legend>{picks[c.id]?.question}</legend>
              <div className="fc-examples">
                {[...(picks[c.id]?.options ?? []), { id: 'skip', label: '跳过' }].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void patch({ id: c.id, quick_choice: option.id })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <details>
            <summary>编辑</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void patch({ id: c.id, note: new FormData(e.currentTarget).get('note') });
              }}
            >
              <input aria-label="备注" name="note" defaultValue={c.note ?? ''} />
              <button>保存备注</button>
            </form>
            {c.entry_type === 'meal' &&
              c.items.map((item, index) => (
                <div key={item.id} className="fc-meal-item-edit">
                  <h4>{item.food_name}</h4>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void patch({
                        id: c.id,
                        nutrition_edit: {
                          item_id: item.id,
                          measured_grams: f.get('grams') === '' ? null : Number(f.get('grams')),
                          food_state: f.get('state'),
                          weight_basis: f.get('basis'),
                        },
                      });
                    }}
                  >
                    <label>
                      {item.food_name} · 称量重量（克）
                      <input
                        name="grams"
                        type="number"
                        min="0.001"
                        step="any"
                        defaultValue={item.nutrition_basis?.measured_grams ?? item.estimated_grams ?? ''}
                      />
                    </label>
                    <label>
                      称量状态{' '}
                      <select name="state" defaultValue={item.nutrition_basis?.food_state ?? 'unknown'}>
                        <option value="unknown">未注明</option>
                        <option value="raw">生重</option>
                        <option value="cooked">熟重</option>
                      </select>
                    </label>
                    <label>
                      重量口径{' '}
                      <select name="basis" defaultValue={item.nutrition_basis?.weight_basis ?? 'unknown'}>
                        <option value="unknown">未注明</option>
                        <option value="edible">可食净重</option>
                        <option value="bone_in">带骨</option>
                      </select>
                    </label>
                    <button disabled={busy}>更新份量并重算</button>
                  </form>
                  <form
                    key={JSON.stringify(item)}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget),
                        items = c.items.map((i, n) =>
                          n === index
                            ? {
                                ...i,
                                nutrition_basis: undefined,
                                confidence: 'exact',
                                food_name: String(f.get('name')),
                                ...Object.fromEntries(
                                  ['kcal', 'protein_g', 'carbs_g', 'fat_g'].map((k) => [
                                    k,
                                    f.get(k) === '' ? null : Number(f.get(k)),
                                  ]),
                                ),
                              }
                            : i,
                        );
                      void patch({ id: c.id, items });
                    }}
                  >
                    <input name="name" aria-label="食物名" required defaultValue={item.food_name} />
                    {(['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const).map((k, i) => (
                      <label key={k}>
                        {['千卡', '蛋白质 g', '碳水 g', '脂肪 g'][i]}
                        <input
                          name={k}
                          type="number"
                          step={i ? '0.001' : '1'}
                          min="0"
                          defaultValue={item[k] ?? ''}
                        />
                      </label>
                    ))}
                    <button>保存明细</button>
                    {c.items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => void patch({ id: c.id, items: c.items.filter((_, n) => n !== index) })}
                      >
                        移除食物
                      </button>
                    )}
                  </form>
                </div>
              ))}
            <button onClick={() => void patch({ id: c.id, deleted: true })}>撤销记录</button>
          </details>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
