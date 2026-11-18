'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PlanItem } from '@/lib/types';

const REST_CHOICES = [60, 90, 120, 180];

export default function TodayPlan({
  initialItems,
  activeSession,
}: {
  initialItems: PlanItem[];
  activeSession: number | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<PlanItem[]>(initialItems);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function patch(id: number, body: Record<string, number>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...mapPatch(body) } : it)));
    try {
      const res = await fetch('/api/plan', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      const data = (await res.json()) as { items?: PlanItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '保存失败');
      if (data.items) setItems(data.items);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove(id: number) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    await fetch(`/api/plan?id=${id}`, { method: 'DELETE' });
  }

  async function start() {
    if (busy) return;
    if (activeSession) {
      router.push(`/train/${activeSession}`);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { session?: { id: number }; error?: string };
      if (!res.ok || !data.session) throw new Error(data.error ?? '开始训练失败');
      router.push(`/train/${data.session.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const totalSets = items.reduce((a, x) => a + x.sets, 0);

  return (
    <section className="block">
      <h2 className="block-title">
        今日训练清单
        <span>
          {items.length} 个动作 · {totalSets} 组
        </span>
      </h2>

      {items.length === 0 ? (
        <div className="empty-card">
          <p>还没有安排动作。</p>
          <p className="sub">去动作库挑几个，或者直接对着教练说「今天练胸，给我排四个动作」。</p>
          <div className="row-btns">
            <Link className="btn primary" href="/exercises">
              去动作库挑选
            </Link>
            <Link className="btn" href="/chat">
              跟教练说
            </Link>
          </div>
        </div>
      ) : (
        <div className="plan-list">
          {items.map((it, i) => (
            <div className="plan-row" key={it.id}>
              <div className="plan-order">{i + 1}</div>
              <div className="plan-main">
                <div className="plan-name">
                  {it.name}
                  {it.done === 1 && <span className="done-tag">已练</span>}
                </div>
                <div className="plan-meta">
                  <span>{it.target || it.body_part}</span>
                  <span>{it.equipment}</span>
                </div>
                <div className="plan-fields">
                  <label>
                    <input
                      type="number"
                      value={it.sets}
                      onChange={(e) => patch(it.id, { sets: Number(e.target.value) })}
                    />
                    <em>组</em>
                  </label>
                  <span className="times">×</span>
                  <label>
                    <input
                      type="number"
                      value={it.reps}
                      onChange={(e) => patch(it.id, { reps: Number(e.target.value) })}
                    />
                    <em>次</em>
                  </label>
                  <label>
                    <input
                      type="number"
                      value={it.weight}
                      onChange={(e) => patch(it.id, { weight: Number(e.target.value) })}
                    />
                    <em>kg</em>
                  </label>
                </div>
                <div className="rest-row">
                  <span>组间休息</span>
                  {REST_CHOICES.map((r) => (
                    <button
                      key={r}
                      className={`rest-chip ${it.rest_sec === r ? 'on' : ''}`}
                      onClick={() => patch(it.id, { restSec: r })}
                    >
                      {r}s
                    </button>
                  ))}
                </div>
              </div>
              <button className="row-del" onClick={() => remove(it.id)} aria-label="移除">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {err && <p className="form-err">{err}</p>}

      {items.length > 0 && (
        <button className="btn primary big" onClick={start} disabled={busy}>
          {busy ? '开始中…' : activeSession ? '继续训练' : `开始训练（${totalSets} 组）`}
        </button>
      )}
    </section>
  );
}

function mapPatch(body: Record<string, number>): Partial<PlanItem> {
  const out: Record<string, number> = {};
  if (body.sets !== undefined) out.sets = body.sets;
  if (body.reps !== undefined) out.reps = body.reps;
  if (body.weight !== undefined) out.weight = body.weight;
  if (body.restSec !== undefined) out.rest_sec = body.restSec;
  return out as Partial<PlanItem>;
}
