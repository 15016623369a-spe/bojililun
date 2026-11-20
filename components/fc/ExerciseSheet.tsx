'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EQUIPMENT_LABEL, TARGET_LABEL, imageUrl } from '@/lib/exercise-label';
import { muscleById, type MuscleId } from '@/lib/muscles';
import { sculptureGroup } from '@/lib/sculpture-groups';

interface DictItem {
  id: string;
  name: string;
  zh_name: string;
  equipment: string;
  target: string;
  image: string;
  steps: string[];
  desc: string;
}

interface DictResult {
  label: string | null;
  total: number;
  items: DictItem[];
}

const FILTERS: { key: string; label: string; equip: string[] }[] = [
  { key: 'all', label: '全部', equip: [] },
  { key: 'machine', label: '固定器械', equip: ['leverage machine', 'smith machine', 'sled machine'] },
  { key: 'dumbbell', label: '哑铃', equip: ['dumbbell'] },
  { key: 'barbell', label: '杠铃', equip: ['barbell', 'olympic barbell', 'ez barbell'] },
  { key: 'body', label: '自重', equip: ['body weight'] },
];

export default function ExerciseSheet({ muscle, onClose, grouped = false }: { muscle: MuscleId | null; onClose: () => void; grouped?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<DictResult | null>(null);
  const [busyList, setBusyList] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [active, setActive] = useState<DictItem | null>(null);
  const [state, setState] = useState<Record<string, 'busy' | 'done' | 'err'>>({});
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!muscle) return;
    let cancelled = false;
    setBusyList(true);
    setFilter('all');
    setActive(null);
    setData(null);
    fetch(`/api/exercises?${grouped ? 'group' : 'muscle'}=${muscle}&limit=100&steps=1`)
      .then((r) => r.json())
      .then((json: DictResult) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData({ label: null, total: 0, items: [] });
      })
      .finally(() => {
        if (!cancelled) setBusyList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [muscle, grouped]);

  useEffect(() => {
    if (!muscle) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [muscle, onClose]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const items = useMemo(() => {
    const rank: Record<string, number> = {
      barbell: 0,
      'olympic barbell': 0,
      'ez barbell': 1,
      dumbbell: 2,
      kettlebell: 3,
      cable: 4,
      'smith machine': 5,
      'leverage machine': 6,
      'sled machine': 6,
      'body weight': 7,
      band: 8,
    };
    const CLASSIC = ['高位下拉', '引体', '划船', '硬拉', '深蹲', '卧推', '推举', '飞鸟', '侧平举', '弯举', '腿举', '下拉'];
    const classicScore = (name: string) => {
      const i = CLASSIC.findIndex((k) => name.includes(k));
      return i === -1 ? 99 : i;
    };
    const eq = FILTERS.find((f) => f.key === filter)?.equip ?? [];

    return (data?.items ?? [])
      .filter((it) => !/stretch|mobility|yoga|foam roll/i.test(it.name))
      .filter((it) => (eq.length ? eq.includes(it.equipment) : true))
      .sort((a, b) => {
        const ca = classicScore(a.zh_name);
        const cb = classicScore(b.zh_name);
        if (ca !== cb) return ca - cb;
        const ra = rank[a.equipment] ?? 9;
        const rb = rank[b.equipment] ?? 9;
        if (ra !== rb) return ra - rb;
        return (a.zh_name || a.name).localeCompare(b.zh_name || b.name, 'zh-CN');
      });
  }, [data, filter]);

  const markDone = useCallback(
    async (it: DictItem) => {
      setState((prev) => ({ ...prev, [it.id]: 'busy' }));
      try {
        const res = await fetch('/api/log', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `练了${it.zh_name || it.name}` }),
        });
        if (!res.ok) throw new Error('记录失败');
        setState((prev) => ({ ...prev, [it.id]: 'done' }));
        setToast('已记入今天，肌肉点亮了');
        router.refresh();
      } catch {
        setState((prev) => ({ ...prev, [it.id]: 'err' }));
        setToast('没记上，再试一次');
      }
    },
    [router],
  );

  const addToPlan = useCallback(
    async (it: DictItem) => {
      setState((prev) => ({ ...prev, [`plan-${it.id}`]: 'busy' }));
      try {
        const res = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ exerciseId: it.id }),
        });
        if (!res.ok) throw new Error('加入失败');
        setState((prev) => ({ ...prev, [`plan-${it.id}`]: 'done' }));
        setToast('已加入今日训练清单');
        router.refresh();
      } catch {
        setState((prev) => ({ ...prev, [`plan-${it.id}`]: 'err' }));
        setToast('加入失败');
      }
    },
    [router],
  );

  if (!muscle) return null;
  const def = muscleById(muscle);
  const title = grouped ? sculptureGroup(muscle)?.label : def ? `${def.region}·${def.label}` : undefined;

  return (
    <>
      <div className="fc-mask dict" onClick={onClose}>
        <div className="fc-sheet fc-dict-sheet" role="dialog" aria-modal="true" aria-label={`${title ?? '肌群'}动作列表`} onClick={(e) => e.stopPropagation()}>
          {active ? (
            <>
              <div className="fc-dict-detail-top">
                <button type="button" className="fc-dict-back" onClick={() => setActive(null)}>
                  ‹ 动作列表
                </button>
                <button type="button" className="fc-dict-close" onClick={onClose}>
                  关闭
                </button>
              </div>

              <div className="fc-dict-hero">
                <span className="fc-dict-gif big">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(active.image)} alt={active.zh_name || active.name} />
                </span>
                <div>
                  <div className="fc-dict-name">{active.zh_name || active.name}</div>
                  <div className="fc-dict-en">{active.name}</div>
                  <div className="fc-dict-chips">
                    <span>{EQUIPMENT_LABEL[active.equipment] ?? active.equipment}</span>
                    <span>{TARGET_LABEL[active.target] ?? active.target}</span>
                  </div>
                </div>
              </div>

              <h4 className="fc-dict-sub">要点</h4>
              {active.steps.length > 0 ? (
                <ol className="fc-dict-steps">
                  {active.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              ) : (
                <p className="fc-note">这个动作暂时没有分步说明。</p>
              )}

              <div className="fc-dict-actions">
                <button
                  type="button"
                  className="fc-btn primary"
                  onClick={() => void markDone(active)}
                  disabled={state[active.id] === 'busy'}
                >
                  {state[active.id] === 'done' ? '✓ 已记入今天' : state[active.id] === 'busy' ? '记录中…' : '✓ 记入今天'}
                </button>
                <button
                  type="button"
                  className="fc-btn ghost"
                  onClick={() => void addToPlan(active)}
                  disabled={state[`plan-${active.id}`] === 'busy'}
                >
                  {state[`plan-${active.id}`] === 'done' ? '✓ 已在清单' : '+ 加入训练'}
                </button>
              </div>
              <p className="fc-dict-src">
                <a href={`/exercises/${active.id}`}>看完整详情与步骤 →</a>
              </p>
            </>
          ) : (
            <>
              <div className="fc-dict-head">
                <div>
                  <div className="fc-dict-title">
                    {title ?? '这块肌肉'}
                    <span className="fc-dict-count">{busyList ? '…' : `${data?.total ?? 0} 个动作`}</span>
                  </div>
                  <div className="fc-dict-note">点动作看动图与要点</div>
                </div>
                <button type="button" className="fc-dict-close" onClick={onClose}>
                  关闭
                </button>
              </div>

              <div className="fc-dict-filters">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={filter === f.key ? 'on' : ''}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="fc-dict-list">
                {busyList && <p className="fc-note">正在取这一块的动作…</p>}
                {!busyList &&
                  items.map((it) => (
                    <button type="button" key={it.id} className="fc-dict-item" onClick={() => setActive(it)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <span className="fc-dict-gif">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imageUrl(it.image)} alt={it.zh_name || it.name} />
                      </span>
                      <span className="fc-dict-item-body">
                        <b>{it.zh_name || it.name}</b>
                        <em>
                          {EQUIPMENT_LABEL[it.equipment] ?? it.equipment} · {TARGET_LABEL[it.target] ?? it.target}
                        </em>
                      </span>
                      <span className="fc-dict-arrow">›</span>
                    </button>
                  ))}
                {!busyList && items.length === 0 && <p className="fc-note">这个筛选下没有动作，换个器械试试。</p>}
              </div>
              <p className="fc-dict-src">动作数据：hasaneyldrm/exercises-dataset（MIT）· 动图版权 Gym visual</p>
            </>
          )}
        </div>
      </div>

      {toast && <div className="fc-toast">{toast}</div>}
    </>
  );
}
