'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { offerRecordUndo } from '../RecordUndoNotice';
import type { CardPick } from '@/lib/ledger';
import type { Card } from '@/lib/export';
import { calcMealTotals, formatDisplayKcal, formatWorkoutSummary } from '@/lib/calculations';
import { DumbbellIcon, MealIcon, PencilIcon } from './icons';

const cardKinds = {
  meal: { label: '饮食', Icon: MealIcon },
  workout: { label: '训练', Icon: DumbbellIcon },
  plan_draft: { label: '轻计划', Icon: PencilIcon },
  body_metrics: { label: '体重', Icon: PencilIcon },
};

function RecordStamp({ kind, loggedAt }: { kind: Card['entry_type']; loggedAt: string }) {
  const { label, Icon } = cardKinds[kind];
  return (
    <small className="fc-ledger-stamp">
      <span className="fc-ledger-kind" role="img" aria-label={label} title={label}>
        <Icon />
      </span>
      <time dateTime={loggedAt}>
        {new Date(loggedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </time>
    </small>
  );
}

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
  const [hideKcal, setHideKcal] = useState(true);
  useEffect(() => setHideKcal(localStorage.getItem('ledger.hideKcal') !== '0'), []);
  async function patch(payload: object, removedId?: number) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/ledger', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw Error((await res.json()).error);
      if (removedId) offerRecordUndo({ cardId: removedId, label: '记录已移除' });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="fc-ledger-list" aria-label="今天的记录">
      {cards.map((c) => (
        <article className="fc-card fc-ledger-card" data-kind={c.entry_type} key={c.id}>
          <RecordStamp kind={c.entry_type} loggedAt={c.logged_at} />
          <h3>{c.summary_title}</h3>
          {c.has_photo && <img className="record-card-photo" src={`/api/ledger/photo/${c.id}`} alt="记录原图" loading="lazy" />}
          {c.entry_type === 'meal' && c.confidence === 'estimated' && <small className="record-estimated">估算</small>}
          {c.entry_type === 'meal' && (
            <button
              type="button"
              className="record-nutrition-toggle"
              aria-label={hideKcal ? '显示热量' : '隐藏热量'}
              onClick={() => {
                setHideKcal(!hideKcal);
                localStorage.setItem('ledger.hideKcal', hideKcal ? '0' : '1');
              }}
            >
              <small>{hideKcal ? '显示热量估算' : formatDisplayKcal(calcMealTotals(c.items).kcal)}</small>
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
          {c.note && <p className="fc-ledger-note">{c.note}</p>}
          {picks[c.id] && (
            <fieldset className="fc-quick-pick">
              <legend>{picks[c.id]?.question}</legend>
              {c.entry_type === 'meal' && <small>已按估算记下，可在这里修正。</small>}
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
          <details className="fc-ledger-edit">
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
            <button onClick={() => void patch({ id: c.id, deleted: true }, c.id)}>移除记录</button>
          </details>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
