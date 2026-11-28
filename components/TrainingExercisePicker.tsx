'use client';

import { useEffect, useState } from 'react';
import { BODY_LABEL, BODY_ORDER, TARGET_LABEL } from '@/lib/exercise-label';
import { offlineFetch } from '@/lib/offline-api';

type Exercise = { id: string; zh_name: string; name: string; body_part: string; target: string };
type Page = { items: Exercise[]; nextOffset: number | null };

export default function TrainingExercisePicker({ busyId, actionLabel, onChoose, onClose, error }: {
  busyId: string | null;
  actionLabel: (id: string) => string;
  onChoose: (id: string) => void;
  onClose: () => void;
  error: string;
}) {
  const [mine, setMine] = useState(true);
  const [part, setPart] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setFailed(false);
    if (!offset) setPage(null);
    const params = new URLSearchParams({ order: 'plan', limit: '32', offset: String(offset), q: query.trim() });
    if (mine) params.set('preference', 'liked');
    if (part) params.set('part', part);
    const timer = window.setTimeout(async () => {
      try {
        const res = await offlineFetch('/api/exercises?' + params, { signal: ctrl.signal });
        if (!res.ok) throw new Error();
        const data: Page = await res.json();
        if (!ctrl.signal.aborted) setPage(prev => ({
          items: offset && prev ? [...prev.items, ...data.items] : data.items,
          nextOffset: data.nextOffset,
        }));
      } catch {
        if (!ctrl.signal.aborted) setFailed(true);
      }
    }, query && !offset ? 120 : 0);
    return () => { ctrl.abort(); window.clearTimeout(timer); };
  }, [mine, part, query, offset, attempt]);

  return <div className="demo-sheet" role="dialog" aria-modal="true" aria-label="从动作库选动作"
    onKeyDown={e => { if (e.key === 'Escape') onClose(); }} onClick={onClose}>
    <div className="demo-card rn-add-sheet" onClick={e => e.stopPropagation()}>
      <div className="demo-card-head"><b>从动作库选动作</b>
        <button type="button" className="chip" autoFocus onClick={onClose}>关闭</button>
      </div>
      <div className="rn-library-controls">
        {[true, false].map(personal => <button key={String(personal)} type="button" className="chip"
          aria-pressed={mine === personal} onClick={() => { setMine(personal); setOffset(0); }}>
          {personal ? '我的动作库' : '全部动作'}
        </button>)}
        <select aria-label="训练部位" value={part} onChange={e => { setPart(e.target.value); setOffset(0); }}>
          <option value="">全部部位</option>
          {BODY_ORDER.map(key => <option key={key} value={key}>{BODY_LABEL[key]}</option>)}
        </select>
      </div>
      <input type="search" className="rn-add-search" aria-label="搜索动作" placeholder="搜索动作" value={query}
        onChange={e => { setQuery(e.target.value); setOffset(0); }} />
      {error && <p role="alert" className="form-err">{error}</p>}
      <ul className="rn-add-list">
        {page?.items.map(ex => <li key={ex.id}>
          <button type="button" disabled={busyId !== null} onClick={() => onChoose(ex.id)}>
            <span className="rn-library-name">{ex.zh_name || ex.name}
              <small>{[BODY_LABEL[ex.body_part] ?? ex.body_part, TARGET_LABEL[ex.target] ?? ex.target].filter(Boolean).join(' · ')}</small>
            </span>
            <small>{busyId === ex.id ? '加入中…' : actionLabel(ex.id)}</small>
          </button>
        </li>)}
        {failed ? <li><button type="button" onClick={() => setAttempt(n => n + 1)}>加载失败，点此重试</button></li>
          : !page ? <li className="rn-add-empty">加载中…</li>
          : !page.items.length ? <li className="rn-add-empty">{mine && !query && !part ? '还没有常练动作' : '没有找到对应动作'}</li>
          : page.nextOffset !== null && <li><button type="button" disabled={page.nextOffset === offset}
            onClick={() => setOffset(page.nextOffset!)}>更多动作</button></li>}
      </ul>
    </div>
  </div>;
}
