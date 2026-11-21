'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Card } from '@/lib/export';
import { calcMealTotals, formatDisplayKcal, formatWorkoutSummary } from '@/lib/calculations';
export default function LedgerCards({ cards, history }: { cards: Card[]; history: Record<string, string> }) {
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
            <div key={index}>
              {formatWorkoutSummary(m.sets, m.exercise_name)}
              {c.entry_type === 'workout' && !m.sets.length && !m.skipped && (
                <div className="fc-examples" aria-label={m.exercise_name + '组数'}>
                  {[...(history[c.id + ':' + index] ? ['last'] : []), 3, 4, 5, 'skip'].map((choice) => (
                    <button
                      type="button"
                      disabled={busy}
                      key={choice}
                      onClick={() => void patch({ id: c.id, index, choice })}
                    >
                      {choice === 'last'
                        ? '同上次：' + history[c.id + ':' + index]
                        : choice === 'skip'
                          ? '跳过'
                          : choice + '组'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {c.note && <p>{c.note}</p>}
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
                <form
                  key={index}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget),
                      items = c.items.map((i, n) =>
                        n === index
                          ? {
                              ...i,
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
              ))}
            <button onClick={() => void patch({ id: c.id, deleted: true })}>撤销记录</button>
          </details>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
