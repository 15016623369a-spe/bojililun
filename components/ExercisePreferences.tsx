'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ExercisePreference } from '@/lib/core/exercise-preferences';
import { BODY_LABEL, EQUIPMENT_LABEL, imageUrl } from '@/lib/exercise-label';
import styles from './ExercisePreferences.module.css';

type View = ExercisePreference | 'all';
type Exercise = {
  id: string;
  name: string;
  zh_name: string;
  image: string;
  equipment: string;
  body_part: string;
  preference: ExercisePreference | null;
};
type Result = { items: Exercise[]; total: number; nextOffset: number | null };

const views: { key: View; label: string }[] = [
  { key: 'liked', label: '我的动作库' },
  { key: 'all', label: '系统动作库' },
  { key: 'disliked', label: '不喜欢' },
];
const parts = [
  { key: 'all', label: '全部', values: [] },
  { key: 'chest', label: '胸', values: ['chest'] },
  { key: 'back', label: '背', values: ['back'] },
  { key: 'shoulders', label: '肩', values: ['shoulders'] },
  { key: 'waist', label: '腹', values: ['waist'] },
  { key: 'legs', label: '腿', values: ['upper legs', 'lower legs'] },
];
const actions: { key: ExercisePreference; label: string }[] = [
  { key: 'liked', label: '喜欢' },
  { key: 'disliked', label: '不喜欢' },
];

async function fetchCatalog(url: string, signal: AbortSignal): Promise<Result> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('动作库加载失败，请重试');
  return response.json();
}

export default function ExercisePreferences() {
  const [view, setView] = useState<View>('liked');
  const [part, setPart] = useState('all');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<Result>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const request = useRef<AbortController | null>(null);
  const actionInFlight = useRef(false);
  const query = new URLSearchParams({ preference: view, q: search, limit: '24' });
  for (const bodyPart of parts.find(({ key }) => key === part)?.values ?? []) query.append('part', bodyPart);
  const url = `/api/exercises?${query}`;

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setResult(undefined);
    setLoading(true);
    setError('');
    fetchCatalog(url, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError('动作库加载失败，请重试');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [url, reload]);

  function searchCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('q') ?? '').trim();
    if (value === search) setReload((current) => current + 1);
    else setSearch(value);
  }

  async function loadMore() {
    const controller = request.current;
    if (!controller || controller.signal.aborted || actionInFlight.current || result?.nextOffset == null) return;
    actionInFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const more = await fetchCatalog(`${url}&offset=${result.nextOffset}`, controller.signal);
      if (!controller.signal.aborted) setResult({ ...more, items: [...result.items, ...more.items] });
    } catch {
      if (!controller.signal.aborted) setError('加载更多动作失败，请重试');
    } finally {
      actionInFlight.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function choose(exercise: Exercise, next: ExercisePreference) {
    if (actionInFlight.current) return;
    const controller = request.current;
    actionInFlight.current = true;
    setPending(exercise.id);
    setError('');
    const preference = next === exercise.preference ? null : next;
    try {
      const response = await fetch('/api/exercise-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseId: exercise.id, preference }),
      });
      if (!response.ok) throw new Error('偏好保存失败');
      if (controller !== request.current) {
        setReload((value) => value + 1);
      } else {
        setResult((current) => {
          if (!current) return current;
          if (view !== 'all' && preference !== view) return {
            items: current.items.filter(({ id }) => id !== exercise.id),
            total: current.total - 1,
            nextOffset: current.nextOffset === null ? null : current.nextOffset - 1,
          };
          return {
            ...current,
            items: current.items.map((item) => item.id === exercise.id ? { ...item, preference } : item),
          };
        });
      }
    } catch {
      setError('偏好保存失败，请重试');
    } finally {
      actionInFlight.current = false;
      setPending(undefined);
    }
  }

  return <div className={styles.panel}>
    <p className={styles.hint}>制定计划时，喜欢的动作会排在前面，不喜欢的动作会排在后面。</p>
    <div className={styles.tabs} role="group" aria-label="动作库范围">
      {views.map(({ key, label }) => (
        <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>
      ))}
    </div>
    <form className={styles.search} onSubmit={searchCatalog}>
      <input type="search" name="q" aria-label="搜索动作" placeholder="搜索动作名称" />
      <button type="submit">搜索</button>
    </form>
    <div className={styles.parts} role="group" aria-label="按部位筛选">
      {parts.map(({ key, label }) => (
        <button type="button" key={key} aria-pressed={part === key} onClick={() => setPart(key)}>{label}</button>
      ))}
    </div>
    {error && <p className={styles.error} role="alert">{error}
      {!result && <button type="button" onClick={() => setReload((value) => value + 1)}>重试</button>}
    </p>}
    {result && !result.items.length && <div className={styles.empty}>
      <p>{search || part !== 'all' || view === 'all' ? '没有匹配的动作。' : view === 'liked' ? '还没有喜欢的动作。' : '还没有标记不喜欢的动作。'}</p>
      {view !== 'all' && <button type="button" onClick={() => setView('all')}>去系统动作库选择</button>}
    </div>}
    {result && result.items.length > 0 && <>
      <p className={styles.count}>{result.total} 个动作</p>
      <ul className={styles.list}>
        {result.items.map((exercise) => {
          const name = exercise.zh_name || exercise.name;
          return <li key={exercise.id} className={styles.row}>
            <Link href={`/exercises/${exercise.id}`} className={styles.detail}>
              <span className={styles.thumb}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {exercise.image && <img src={imageUrl(exercise.image)} alt="" loading="lazy" />}
              </span>
              <span>
                <strong>{name}</strong>
                <small>{BODY_LABEL[exercise.body_part] ?? exercise.body_part} · {EQUIPMENT_LABEL[exercise.equipment] ?? exercise.equipment}</small>
              </span>
            </Link>
            <div className={styles.actions}>
              {actions.map(({ key, label }) => <button type="button" key={key} aria-pressed={exercise.preference === key}
                aria-label={`${label}：${name}`} disabled={Boolean(pending) || loading}
                onClick={() => void choose(exercise, key)}>{label}</button>)}
            </div>
          </li>;
        })}
      </ul>
    </>}
    {loading && <p className={styles.hint} role="status">正在加载动作…</p>}
    {result?.nextOffset != null && <button className={styles.more} type="button" disabled={loading || Boolean(pending)} onClick={() => void loadMore()}>
      加载更多
    </button>}
  </div>;
}
