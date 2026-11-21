'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EQUIPMENT_LABEL, TARGET_LABEL, imageUrl } from '@/lib/exercise-label';
import { muscleById, type MuscleId } from '@/lib/muscles';
import { sculptureGroup } from '@/lib/sculpture-groups';
import JournalIcon from '@/components/JournalIcon';
import type { ExercisePreference } from '@/lib/core/exercise-preferences';

interface DictItem {
  id: string;
  name: string;
  zh_name: string;
  equipment: string;
  target: string;
  image: string;
  steps: string[];
  desc: string;
  preference: ExercisePreference | null;
}

interface DictResult {
  label: string | null;
  total: number;
  items: DictItem[];
  nextOffset: number | null;
}

export type ExerciseChoice = { id: string; name: string };
export type ExerciseSelection = {
  planned: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  toggle: (exerciseId: string) => void;
  saving: boolean;
  error: string;
  complete: () => Promise<boolean>;
};

const FILTERS: { key: string; label: string; equip: string[] }[] = [
  { key: 'all', label: '全部', equip: [] },
  { key: 'machine', label: '固定器械', equip: ['leverage machine', 'smith machine', 'sled machine'] },
  { key: 'dumbbell', label: '哑铃', equip: ['dumbbell'] },
  { key: 'barbell', label: '杠铃', equip: ['barbell', 'olympic barbell', 'ez barbell'] },
  { key: 'body', label: '自重', equip: ['body weight'] },
];

async function fetchExercises(url: string, signal: AbortSignal): Promise<DictResult> {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error('动作列表加载失败，请重试');
  return res.json();
}

export default function ExerciseSheet({ muscle, onClose, grouped = false, onChooseExercise, selection, preference }: {
  muscle: MuscleId | null;
  onClose: () => void;
  grouped?: boolean;
  selection?: ExerciseSelection;
  onChooseExercise?: (exercise: ExerciseChoice) => void;
  /** liked：只看「我的动作库」（在「我的 · 动作偏好」里标为常练的动作） */
  preference?: 'liked';
}) {
  const router = useRouter();
  const [data, setData] = useState<DictResult | null>(null);
  const [busyList, setBusyList] = useState(false);
  const [busyMore, setBusyMore] = useState(false);
  const [listError, setListError] = useState('');
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<string>('all');
  const [active, setActive] = useState<DictItem | null>(null);
  const [state, setState] = useState<Record<string, 'busy' | 'done' | 'err'>>({});
  const [toast, setToast] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const listRequest = useRef<AbortController | null>(null);
  const moreRequest = useRef<AbortController | null>(null);
  const query = new URLSearchParams({
    [grouped ? 'group' : 'muscle']: muscle ?? '',
    limit: '100', steps: '1', order: 'plan',
  });
  if (preference) query.set('preference', preference);
  for (const equipment of FILTERS.find((item) => item.key === filter)?.equip ?? []) {
    query.append('equipment', equipment);
  }
  const listUrl = `/api/exercises?${query}`;

  function showDetails(item: DictItem) {
    listScroll.current = list.current?.scrollTop ?? 0;
    setActive(item);
  }

  useEffect(() => {
    if (!active && list.current) list.current.scrollTop = listScroll.current;
  }, [active]);

  useEffect(() => {
    listScroll.current = 0;
    setFilter('all');
    setActive(null);
  }, [muscle, grouped]);

  useEffect(() => {
    if (!muscle) return;
    const request = new AbortController();
    listRequest.current = request;
    setBusyList(true);
    setBusyMore(false);
    setListError('');
    setData(null);
    fetchExercises(listUrl, request.signal)
      .then((json) => {
        if (!request.signal.aborted) setData(json);
      })
      .catch(() => {
        if (!request.signal.aborted) setListError('动作列表加载失败，请重试');
      })
      .finally(() => {
        if (!request.signal.aborted) setBusyList(false);
      });
    return () => {
      request.abort();
    };
  }, [muscle, listUrl, reload]);

  async function loadMore() {
    const request = listRequest.current;
    if (!request || request.signal.aborted || moreRequest.current === request || data?.nextOffset == null) return;
    moreRequest.current = request;
    setBusyMore(true);
    setListError('');
    try {
      const page = await fetchExercises(`${listUrl}&offset=${data.nextOffset}`, request.signal);
      if (!request.signal.aborted) setData({ ...page, items: [...data.items, ...page.items] });
    } catch {
      if (!request.signal.aborted) setListError('加载更多动作失败，请重试');
    } finally {
      if (moreRequest.current === request) moreRequest.current = null;
      if (!request.signal.aborted) setBusyMore(false);
    }
  }

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

  const items = data?.items ?? [];

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
        setToast('已记入今天的训练记录');
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
  const base = grouped ? sculptureGroup(muscle)?.label : def ? `${def.region}·${def.label}` : undefined;
  const title = preference && base ? `${base} · 我的动作库` : base;

  return (
    <>
      <div className="fc-mask dict" onClick={onClose}>
        <div className={`fc-sheet fc-dict-sheet${active ? ' fc-dict-detail' : ''}`} role="dialog" aria-modal="true" aria-label={`${title ?? '肌群'}动作列表`} onClick={(e) => e.stopPropagation()}>
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

              <div className="fc-dict-detail-body">
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
              </div>

              {selection ? null : onChooseExercise ? <div className="fc-dict-actions">
                <button type="button" className="fc-btn primary" onClick={() => {
                  onChooseExercise({ id: active.id, name: active.zh_name || active.name });
                  setActive(null);
                  onClose();
                }}>选择此动作</button>
              </div> : <>
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
              </>}
            </>
          ) : (
            <>
              <div className="fc-dict-head">
                <div>
                  <div className="fc-dict-title">
                    {title ?? '这块肌肉'}
                    <span className="fc-dict-count">{busyList ? '…' : `${data?.total ?? 0} 个动作`}</span>
                  </div>
                  <div className="fc-dict-note">{selection ? '点动作加入或取消选择' : '点动作看动图与要点'}</div>
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
                    onClick={() => {
                      listScroll.current = 0;
                      if (list.current) list.current.scrollTop = 0;
                      setFilter(f.key);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="fc-dict-list" ref={list}>
                {busyList && <p className="fc-note">正在取这一块的动作…</p>}
                {!busyList &&
                  items.map((it) => {
                    const name = it.zh_name || it.name;
                    const planned = selection?.planned.has(it.id);
                    const selected = planned || selection?.selected.has(it.id);
                    const preview = <>
                      <span className="fc-dict-gif">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imageUrl(it.image)} alt="" loading="lazy" />
                      </span>
                      <span className="fc-dict-item-body">
                        <b>{name}</b>
                        <em>{EQUIPMENT_LABEL[it.equipment] ?? it.equipment} · {TARGET_LABEL[it.target] ?? it.target}
                          {it.preference === 'liked' ? ' · 常练' : it.preference === 'disliked' ? ' · 不喜欢' : ''}
                        </em>
                      </span>
                    </>;

                    if (!selection) return <button type="button" key={it.id} className="fc-dict-item" onClick={() => showDetails(it)}>
                      {preview}<span className="fc-dict-arrow" aria-hidden="true">›</span>
                    </button>;

                    return <div className="fc-dict-select-row" data-selected={selected} key={it.id}>
                      <button type="button" className="fc-dict-item" aria-pressed={selected}
                        disabled={selection.saving || planned} onClick={() => selection.toggle(it.id)}>
                        {preview}
                        {planned && <span className="fc-dict-planned">已在计划</span>}
                      </button>
                      <button type="button" className="fc-dict-explain" aria-label={`讲解：${name}`} title="动作讲解" onClick={() => showDetails(it)}>
                        <JournalIcon name="book" />
                      </button>
                    </div>;
                  })}
                {!busyList && !listError && items.length === 0 && <p className="fc-note">{preference
                  ? <>这一块还没有常练动作。可以在<a href="/me/exercises">「我的 · 动作偏好」</a>里标记。</>
                  : '这个筛选下没有动作，换个器械试试。'}</p>}
                {listError && <p className="fc-note" role="alert">{listError}</p>}
                {listError && !data && <button type="button" className="fc-btn ghost" onClick={() => setReload((value) => value + 1)}>重新加载</button>}
                {data?.nextOffset != null && <button type="button" className="fc-btn ghost" disabled={busyMore} onClick={() => void loadMore()}>
                  {busyMore ? '正在加载…' : '加载更多动作'}
                </button>}
              </div>
              {selection && <div className="fc-dict-actions">
                {selection.error && <p className="fc-note" role="alert">{selection.error}</p>}
                <button type="button" className="fc-btn primary" disabled={selection.saving || selection.selected.size === 0}
                  onClick={async () => { if (await selection.complete()) onClose(); }}>
                  {selection.saving ? '保存中…' : selection.selected.size ? `完成（${selection.selected.size}）` : '完成'}
                </button>
              </div>}
              <p className="fc-dict-src">动作数据：hasaneyldrm/exercises-dataset（MIT）· 动图版权 Gym visual</p>
            </>
          )}
        </div>
      </div>

      {toast && <div className="fc-toast">{toast}</div>}
    </>
  );
}
