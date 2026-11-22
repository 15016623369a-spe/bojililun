'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { SessionDetail } from '@/lib/core/workout';
import type { TrainingMutationPreview } from '@/lib/core/journal';
import { mealNutrition, trainingSummary, type JournalEntry } from '@/lib/journal';
import EntryTable from './EntryTable';
import ExerciseRecord from './ExerciseRecord';
import QuickMealDetails from './QuickMealDetails';

function CardBody({ entry }: { entry: JournalEntry }) {
  const payload = entry.payload;
  const mealItems = payload?.items ?? [];
  const exercises = payload?.exercises ?? [];
  const nutrition = entry.kind === 'meal' && payload ? mealNutrition([{ ...payload, planned: false }]) : undefined;
  const manualOnly = mealItems.length > 0 && mealItems.every((item) => item.manualKcal !== undefined);
  const trainingData = exercises.map((item) => [
    item.weight, item.sets === undefined ? '' : `${item.sets}组`, item.reps ? `${item.reps}次` : '', item.duration,
  ].filter(Boolean).join(' × ')).filter(Boolean);
  const title = entry.kind === 'training' && entry.title === '训练' && payload?.regions?.length === 1
    ? `${payload.regions[0]}训练` : entry.title;

  return <>
    <span className="record-card-head">
      <span>{entry.time && `${entry.time} · `}{title}{payload?.planned && <small className="entry-tag">计划</small>}</span>
      {nutrition && (nutrition.counted > 0
        ? <span className="record-card-kcal">{nutrition.pending > 0 ? '已知 ' : ''}{manualOnly ? '' : '≈ '}{nutrition.totals.kcal} 千卡</span>
        : nutrition.pending > 0 && <span className="record-card-sub">热量待补</span>)}
    </span>
    {entry.kind === 'meal' && mealItems.length > 0 ? <>
      <span className="record-card-main">{mealItems.slice(0, 2).map((item) => item.name).join(' + ')}</span>
      {mealItems.length === 1 && !/^(未填写|适量)$/.test(mealItems[0].amount) &&
        <span className="record-card-sub">{mealItems[0].amount}</span>}
      {mealItems.length > 2 && <span className="record-card-sub">
        {mealItems.slice(2).map((item) => `${item.name}${item.amount !== '未填写' ? ` ${item.amount}` : ''}`).join('、')}
      </span>}
      {mealItems.some((item) => item.photoUrl) && <span className="record-card-sub">有照片</span>}
    </> : entry.kind === 'training' ? <>
      <span className="record-card-main">{exercises.map((item) => item.name).join('、') || (payload && trainingSummary(payload)) || entry.detail}</span>
      {(trainingData.length > 0 || entry.note) && <span className="record-card-sub">{[trainingData.join(' · '), entry.note].filter(Boolean).join(' · ')}</span>}
    </> : <span className="record-card-main">{entry.detail}</span>}
  </>;
}

export function RecordEditor({ entry, onClose, onSaved, onDelete }: {
  entry: JournalEntry;
  onClose: () => void;
  onSaved?: (entry: JournalEntry) => void;
  onDelete: () => Promise<void>;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const sessionId = entry.id.startsWith('session-') ? Number(entry.id.slice(8)) : undefined;
  const [session, setSession] = useState<SessionDetail>();
  const [value, setValue] = useState(sessionId ? entry.note ?? '' : entry.source ?? entry.detail);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mutation, setMutation] = useState<TrainingMutationPreview>();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const items = entry.payload?.items ?? [];
  const single = items.length === 1 && items[0].src?.kind === 'quick' ? items[0] : undefined;
  const close = () => {
    dialog.current?.close();
    onClose();
  };

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/session?id=${sessionId}`, { signal: controller.signal, cache: 'no-store' });
        const data = await res.json() as { detail?: SessionDetail; error?: string };
        if (!res.ok || !data.detail) throw new Error(data.error || '训练明细暂时无法加载');
        setSession(data.detail);
      } catch (cause) {
        if (!controller.signal.aborted) setError((cause as Error).message);
      }
    })();
    return () => controller.abort();
  }, [sessionId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(sessionId ? '/api/session' : '/api/journal', {
        method: sessionId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sessionId ? { id: sessionId, note: value } : { id: entry.quickId, text: value }),
      });
      const data = await res.json() as { entry?: JournalEntry; error?: string };
      if (!res.ok) throw new Error(data.error || '保存失败，请重试');
      if (data.entry) onSaved?.(data.entry);
      close();
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function dictateToThisCard() {
    const host = window as Window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const Speech = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Speech) { setError('此浏览器暂不支持语音识别'); return; }
    const capture = new Speech();
    capture.lang = 'zh-CN';
    capture.continuous = false;
    capture.interimResults = false;
    capture.onresult = (event: any) => {
      const spoken = Array.from(event.results as ArrayLike<any>).map((result: any) => result[0].transcript).join('').trim();
      if (!spoken) return;
      setBusy(true);
      setError('');
      void fetch('/api/journal', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: spoken, targetCardId: entry.id }) })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok || !data.preview) throw new Error(data.error || '无法预览这次修改');
          setMutation(data.preview as TrainingMutationPreview);
        })
        .catch((cause: Error) => setError(cause.message))
        .finally(() => setBusy(false));
    };
    capture.onerror = () => { setError('语音识别失败，请重试'); setListening(false); };
    capture.onend = () => setListening(false);
    try { capture.start(); setListening(true); } catch { setError('语音暂时无法启动'); }
  }

  async function confirmCardMutation() {
    if (!mutation || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/journal', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmMutation: mutation }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败');
      setMutation(undefined);
      onSaved?.(data.entry);
      close();
      router.refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onDelete();
      close();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className="journal-dialog record-editor" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}>
    <div className="dialog-head">
      <h2 id={titleId}>{single ? single.name : entry.title}</h2>
      <button className="ask-close" type="button" aria-label="关闭详情" disabled={busy} onClick={close}>×</button>
    </div>
    {sessionId && (session
      ? session.groups.map((group) => <ExerciseRecord key={group.exercise_id} group={group} initiallyExpanded />)
      : !error && <p className="hint">正在加载训练明细…</p>)}
    {sessionId && <button className="journal-quiet" type="button" disabled={busy} onClick={dictateToThisCard}>
      {listening ? '正在听…' : '对这条训练说修改'}
    </button>}
    {mutation && <div className="training-conflict" role="alertdialog" aria-modal="false">
      <b>确认修改这条训练</b>
      <p>{mutation.exerciseName}：{mutation.beforeSets} 组 → {mutation.afterSets} 组</p>
      <div><button className="journal-quiet" type="button" disabled={busy} onClick={() => setMutation(undefined)}>取消</button>
        <button className="journal-primary" type="button" disabled={busy} onClick={() => void confirmCardMutation()}>{busy ? '保存中…' : '确认修改'}</button></div>
    </div>}
    {single ? <QuickMealDetails item={single} mealType={entry.payload?.mealType} onSave={onSaved} onClose={close} />
      : entry.kind === 'meal' && entry.payload ? <EntryTable payload={entry.payload} onQuickSave={onSaved} />
      : (entry.quickId || sessionId) && <form className="record-edit-text" onSubmit={(event) => void save(event)}>
        <label>{sessionId ? '训练备注' : '记录内容'}
          <textarea value={value} maxLength={1000} onChange={(event) => setValue(event.target.value)} />
        </label>
        <button className="journal-primary" disabled={busy || (!sessionId && !value.trim())}>保存</button>
      </form>}
    {(entry.quickId || sessionId || entry.id.startsWith('meal-')) && <div className="record-delete">
      {confirmDelete && <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>取消</button>}
      <button type="button" onClick={() => void remove()} disabled={busy}>{confirmDelete ? '确认删除' : '删除记录'}</button>
    </div>}
    {error && <p className="journal-error" role="alert">{error}</p>}
  </dialog>;
}

/** 按记录来源删除：语音记录、训练、饮食各走自己的接口。 */
export async function deleteEntry(entry: JournalEntry) {
  const endpoint = entry.quickId ? `/api/journal?id=${entry.quickId}`
    : entry.id.startsWith('session-') ? `/api/session?id=${entry.id.slice(8)}`
      : `/api/meals?id=${entry.id.slice(5)}`;
  const response = await fetch(endpoint, { method: 'DELETE' });
  if (!response.ok) {
    const data = await response.json() as { error?: string };
    throw new Error(data.error || '删除失败，请重试');
  }
}

export default function RecordCards({ entries, freshId, onSaved, onDeleted }: {
  entries: JournalEntry[];
  freshId?: string;
  onSaved?: (entry: JournalEntry) => void;
  onDeleted?: (entry: JournalEntry) => void;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string>();
  const [error, setError] = useState('');
  const open = entries.find((entry) => entry.id === openId);

  async function remove(entry: JournalEntry) {
    await deleteEntry(entry);
    onDeleted?.(entry);
    router.refresh();
  }

  return <>
    {error && <p className="journal-error" role="alert">{error}</p>}
    <ul className="record-cards">
      {entries.map((entry) => <li className={`record-card-row ${entry.kind}`} key={entry.id}>
        <button className="record-card" type="button" aria-haspopup="dialog"
          onClick={() => { setError(''); setOpenId(entry.id); }}><CardBody entry={entry} /></button>
        {entry.id === freshId && <div className="record-fresh-actions">
          <button type="button" onClick={() => setOpenId(entry.id)}>编辑</button>
          <button type="button" onClick={() => void remove(entry).catch((cause: Error) => setError(cause.message))}>撤销</button>
        </div>}
      </li>)}
    </ul>
    {open && <RecordEditor key={open.id} entry={open} onClose={() => setOpenId(undefined)} onSaved={onSaved}
      onDelete={() => remove(open)} />}
  </>;
}
