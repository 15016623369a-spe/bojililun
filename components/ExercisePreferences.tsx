'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from 'react';
import type { ExercisePreference } from '@/lib/core/exercise-preferences';
import { BODY_LABEL, EQUIPMENT_LABEL, imageUrl } from '@/lib/exercise-label';
import Icon from './ui/Icon';
import styles from './ExercisePreferences.module.css';

type View = ExercisePreference | 'all';
type Pref = ExercisePreference | null;
type Exercise = {
  id: string;
  name: string;
  zh_name: string;
  image: string;
  equipment: string;
  body_part: string;
  preference: Pref;
};
type Result = { items: Exercise[]; total: number; nextOffset: number | null };
type Toast = { id: number; text: string; undo?: () => void };

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
/** 滑动超过这个距离松手即生效 */
const SWIPE = 76;

const haptic = (pattern: number | number[]) => { try { navigator.vibrate?.(pattern); } catch { /* iOS 网页无振动 */ } };

async function fetchCatalog(url: string, signal: AbortSignal): Promise<Result> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('动作库加载失败，请重试');
  return response.json();
}

function toastText(before: Pref, after: Pref) {
  if (after === 'liked') return '已加入我的动作库';
  if (after === 'disliked') return '已标为不喜欢，排计划时会靠后';
  return before === 'liked' ? '已移出我的动作库' : '已取消不喜欢';
}

/**
 * 一行动作：右侧是两格图标开关（常练 / 不喜欢），墨黑滑块在两格之间弹动；
 * 也可以整行向右滑加入常练、向左滑标为不喜欢，过阈值时轻震一下。
 */
function PreferenceRow({ exercise, busy, saving, leaving, failed, onSet }: {
  exercise: Exercise;
  busy: boolean;
  saving: boolean;
  leaving: boolean;
  failed: boolean;
  onSet: (preference: Pref) => void;
}) {
  const name = exercise.zh_name || exercise.name;
  const pref = exercise.preference;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; id: number; axis: 'x' | 'y' | null } | null>(null);
  const armed = useRef<'left' | 'right' | null>(null);
  const suppressClick = useRef(false);

  function onDown(event: PointerEvent<HTMLDivElement>) {
    if (busy || (event.target as HTMLElement).closest('[data-switch]')) return;
    drag.current = { x: event.clientX, y: event.clientY, id: event.pointerId, axis: null };
    armed.current = null;
    suppressClick.current = false;
  }
  function onMove(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const mx = event.clientX - d.x, my = event.clientY - d.y;
    if (!d.axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      d.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (d.axis === 'x') { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); suppressClick.current = true; }
    }
    if (d.axis !== 'x') return;
    // 超过阈值后加阻尼，手感像拉橡皮筋
    const limit = 120;
    const eased = Math.abs(mx) <= limit ? mx : Math.sign(mx) * (limit + (Math.abs(mx) - limit) * .25);
    setDx(eased);
    const next = eased > SWIPE ? 'right' : eased < -SWIPE ? 'left' : null;
    if (next !== armed.current) { if (next) haptic(8); armed.current = next; }
  }
  function onUp(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (d.axis === 'x') {
      if (armed.current === 'right') onSet(pref === 'liked' ? null : 'liked');
      if (armed.current === 'left') onSet(pref === 'disliked' ? null : 'disliked');
    }
    armed.current = null;
    setDragging(false);
    setDx(0);
  }

  const progress = Math.min(1, Math.abs(dx) / SWIPE);
  return <li className={styles.row} data-pref={pref ?? undefined} data-leaving={leaving || undefined} data-failed={failed || undefined}>
    <div className={styles.rowClip}>
      <div className={styles.revealLike} data-armed={dx > SWIPE || undefined} style={{ opacity: dx > 0 ? 1 : 0 } as CSSProperties} aria-hidden="true">
        <span style={{ transform: `scale(${.6 + progress * .4})` }}><Icon name={pref === 'liked' ? 'bookmark' : 'bookmark-fill'} size={20} />{pref === 'liked' ? '移出' : '常练'}</span>
      </div>
      <div className={styles.revealDislike} data-armed={dx < -SWIPE || undefined} style={{ opacity: dx < 0 ? 1 : 0 } as CSSProperties} aria-hidden="true">
        <span style={{ transform: `scale(${.6 + progress * .4})` }}>{pref === 'disliked' ? '恢复' : '不喜欢'}<Icon name="ban" size={20} /></span>
      </div>
      <div className={styles.rowInner} data-dragging={dragging || undefined} style={{ transform: `translate3d(${dx}px, 0, 0)` }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
        <Link href={`/exercises/${exercise.id}`} className={styles.detail} draggable={false}>
          <span className={styles.thumb}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {exercise.image && <img src={imageUrl(exercise.image)} alt="" loading="lazy" draggable={false} />}
            <i className={styles.badge} aria-hidden="true"><Icon name="bookmark-fill" size={10} /></i>
          </span>
          <span className={styles.text}>
            <strong>{name}</strong>
            <small>{BODY_LABEL[exercise.body_part] ?? exercise.body_part} · {EQUIPMENT_LABEL[exercise.equipment] ?? exercise.equipment}</small>
          </span>
        </Link>
        <div className={styles.switch} data-switch data-value={pref ?? 'none'} data-busy={saving || undefined} role="group" aria-label={`偏好：${name}`}>
          <span className={styles.knob} aria-hidden="true" />
          <button type="button" aria-pressed={pref === 'liked'} disabled={busy}
            aria-label={pref === 'liked' ? `移出我的动作库：${name}` : `加入我的动作库：${name}`}
            title={pref === 'liked' ? '移出我的动作库' : '加入我的动作库'}
            onClick={() => onSet(pref === 'liked' ? null : 'liked')}>
            <Icon name={pref === 'liked' ? 'bookmark-fill' : 'bookmark'} size={16} stroke={1.9} />
          </button>
          <button type="button" aria-pressed={pref === 'disliked'} disabled={busy}
            aria-label={pref === 'disliked' ? `取消不喜欢：${name}` : `标为不喜欢：${name}`}
            title={pref === 'disliked' ? '取消不喜欢' : '不喜欢'}
            onClick={() => onSet(pref === 'disliked' ? null : 'disliked')}>
            <Icon name="ban" size={16} stroke={1.9} />
          </button>
        </div>
      </div>
    </div>
  </li>;
}

export default function ExercisePreferences() {
  const [view, setView] = useState<View>('liked');
  const [part, setPart] = useState('all');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<Result>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string>();
  const [leaving, setLeaving] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const [toast, setToast] = useState<Toast>();
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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

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

  function patchItem(id: string, preference: Pref) {
    setResult((current) => current && { ...current, items: current.items.map((item) => item.id === id ? { ...item, preference } : item) });
  }

  /** 先在界面上变过去，保存失败再弹回并抖一下 */
  async function setPreference(exercise: Exercise, preference: Pref, fromUndo = false) {
    if (actionInFlight.current) return;
    const controller = request.current;
    const before = exercise.preference;
    actionInFlight.current = true;
    setPending(exercise.id);
    setError('');
    patchItem(exercise.id, preference);
    haptic(preference === 'liked' ? 12 : preference === 'disliked' ? [6, 40, 6] : 5);
    try {
      const response = await fetch('/api/exercise-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseId: exercise.id, preference }),
      });
      if (!response.ok) throw new Error('偏好保存失败');
      if (fromUndo || controller !== request.current) {
        setReload((value) => value + 1);
      } else if (view !== 'all' && preference !== view) {
        // 不再属于当前列表：先收起这一行，再从列表里拿掉
        setLeaving(exercise.id);
        window.setTimeout(() => {
          setLeaving(undefined);
          setResult((current) => current && {
            items: current.items.filter(({ id }) => id !== exercise.id),
            total: current.total - 1,
            nextOffset: current.nextOffset === null ? null : current.nextOffset - 1,
          });
        }, 380);
      }
      if (!fromUndo) {
        setToast({ id: Date.now(), text: toastText(before, preference),
          undo: () => { setToast(undefined); void setPreference({ ...exercise, preference }, before, true); } });
      } else {
        setToast({ id: Date.now(), text: '已撤销' });
      }
    } catch {
      patchItem(exercise.id, before);
      setFailed(exercise.id);
      window.setTimeout(() => setFailed(undefined), 520);
      haptic([30, 50, 30]);
      setError('偏好保存失败，请重试');
    } finally {
      actionInFlight.current = false;
      setPending(undefined);
    }
  }

  return <div className={styles.panel}>
    <p className={styles.hint}>常练的动作排计划时排在前面，不喜欢的靠后。右侧开关或左右滑动一行都可以标记。</p>
    <div className={styles.tabs} role="group" aria-label="动作库范围" data-view={view}>
      <span className={styles.tabKnob} aria-hidden="true" />
      {views.map(({ key, label }) => (
        <button key={key} type="button" aria-pressed={view === key} onClick={() => { haptic(4); setView(key); }}>{label}</button>
      ))}
    </div>
    <form className={styles.search} onSubmit={searchCatalog}>
      <Icon name="search" size={16} className={styles.searchIcon} />
      <input type="search" name="q" aria-label="搜索动作" placeholder="搜索动作名称" />
      <button type="submit">搜索</button>
    </form>
    <div className={styles.parts} role="group" aria-label="按部位筛选">
      {parts.map(({ key, label }) => (
        <button type="button" key={key} aria-pressed={part === key} onClick={() => { haptic(4); setPart(key); }}>{label}</button>
      ))}
    </div>
    {error && <p className={styles.error} role="alert">{error}
      {!result && <button type="button" onClick={() => setReload((value) => value + 1)}>重试</button>}
    </p>}
    {result && !result.items.length && <div className={styles.empty}>
      <p>{search || part !== 'all' || view === 'all' ? '没有匹配的动作。' : view === 'liked' ? '还没有常练的动作。' : '还没有标记不喜欢的动作。'}</p>
      {view !== 'all' && <button type="button" onClick={() => setView('all')}>去系统动作库选择</button>}
    </div>}
    {result && result.items.length > 0 && <>
      <p className={styles.count}><b>{result.total}</b> 个动作</p>
      <ul className={styles.list}>
        {result.items.map((exercise) => <PreferenceRow key={exercise.id} exercise={exercise}
          busy={Boolean(pending) || loading} saving={pending === exercise.id}
          leaving={leaving === exercise.id} failed={failed === exercise.id}
          onSet={(preference) => void setPreference(exercise, preference)} />)}
      </ul>
    </>}
    {loading && <p className={styles.hint} role="status">正在加载动作…</p>}
    {result?.nextOffset != null && <button className={styles.more} type="button" disabled={loading || Boolean(pending)} onClick={() => void loadMore()}>
      加载更多
    </button>}
    {toast && <div key={toast.id} className={styles.toast} role="status">
      <Icon name={toast.text.startsWith('已加入') ? 'bookmark-fill' : 'check'} size={15} stroke={2.2} />
      <span>{toast.text}</span>
      {toast.undo && <button type="button" onClick={toast.undo}>撤销</button>}
    </div>}
  </div>;
}
