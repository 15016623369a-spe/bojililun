'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { JournalEntry } from '@/lib/journal';
import JournalIcon from './JournalIcon';
import JournalTimeline from './JournalTimeline';

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export default function RecordToday({ date, entries, workoutSaved }: { date: string; entries: JournalEntry[]; workoutSaved: boolean }) {
  const router = useRouter();
  const rec = useRef<Recognition | null>(null);
  const lock = useRef(false);
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<number>();
  const [text, setText] = useState('');
  const [status, setStatus] = useState(workoutSaved ? '训练已自动归档' : '');
  const [freshId, setFreshId] = useState<string>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pastEntry, setPastEntry] = useState<JournalEntry>();
  const request = useRef<{ text: string; id: string } | null>(null);

  useEffect(() => () => {
    if (rec.current) {
      rec.current.onend = null;
      rec.current.abort();
    }
  }, []);

  async function save(value: string, id?: number) {
    if (lock.current || !value.trim()) return;
    lock.current = true;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      if (request.current?.text !== value) {
        request.current = { text: value, id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      }
      const response = await fetch('/api/journal', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: value, id, requestId: request.current.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '记录失败，请重试');
      const entry: JournalEntry = result.entry;
      setStatus(id ? '记录已更新' : '已记录');
      setFreshId(entry.id);
      setPastEntry(entry.date !== date ? entry : undefined);
      setText('');
      setEditing(false);
      setEditingId(undefined);
      request.current = null;
      router.refresh();
    } catch (err) {
      setText(value);
      setEditing(true);
      setError((err as Error).message);
    } finally {
      setSaving(false);
      lock.current = false;
    }
  }

  function startVoice() {
    if (rec.current || lock.current) return;
    const host = window as Window & {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Speech = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    setError('');
    if (!Speech) {
      setEditing(true);
      setEditingId(undefined);
      setError('此浏览器暂不支持语音输入，可以直接打字。');
      return;
    }
    const capture = new Speech();
    rec.current = capture;
    capture.lang = 'zh-CN';
    capture.continuous = true;
    capture.interimResults = true;
    let finalText = '';
    let partialText = '';
    let failed = false;
    capture.onresult = (event) => {
      finalText = '';
      partialText = '';
      for (const result of Array.from(event.results)) {
        if (result.isFinal) finalText += result[0].transcript;
        else partialText += result[0].transcript;
      }
    };
    capture.onerror = ({ error: reason }) => {
      failed = true;
      if (reason !== 'aborted') {
        setEditing(true);
        setEditingId(undefined);
        setError(reason === 'not-allowed' ? '麦克风未授权，可以先打字记录。' : '这次语音没有识别成功，可以重试或打字。');
      }
    };
    capture.onend = () => {
      rec.current = null;
      setRecording(false);
      const spoken = (finalText + partialText).trim();
      if (spoken && !failed) void save(spoken);
      else if (!failed) setError('没有听到内容，再按住试一次。');
    };
    try {
      capture.start();
      setRecording(true);
    } catch {
      rec.current = null;
      setEditing(true);
      setEditingId(undefined);
      setError('语音暂时无法启动，可以先打字记录。');
    }
  }

  async function undo(entry: JournalEntry) {
    try {
      const response = await fetch(`/api/journal?id=${entry.quickId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error();
      setFreshId(undefined);
      setPastEntry(undefined);
      setStatus('已撤销');
      router.refresh();
    } catch {
      setError('撤销失败，请重试。');
    }
  }

  function edit(entry: JournalEntry) {
    setEditingId(entry.quickId);
    setText(entry.source ?? entry.detail);
    setEditing(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(text, editingId);
  }

  return <>
    {status && <p className="journal-status" role="status"><JournalIcon name="check" />{status}
      {pastEntry && <Link href={`/history?period=day&date=${pastEntry.date}`}>查看 {pastEntry.date}</Link>}
    </p>}
    {pastEntry && <JournalTimeline entries={[pastEntry]} freshId={freshId} onEdit={edit} onUndo={undo} />}
    {entries.length ? <JournalTimeline entries={entries} freshId={freshId} onEdit={edit} onUndo={undo} />
      : <div className="journal-empty"><JournalIcon name="record" /><p>今天还没有记录</p><span>说说吃了什么，或刚做完什么训练。</span></div>}
    <div className="journal-input-dock">
      {error && <p className="journal-error" role="alert">{error}</p>}
      {editing && <form className="journal-entry-form" onSubmit={submit}>
        <label htmlFor="journal-text">{editingId ? '编辑记录' : '写一条记录'}</label>
        <textarea id="journal-text" autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder="午饭牛肉面加一个卤蛋" maxLength={1000} />
        <div><button type="button" className="journal-quiet" onClick={() => { setEditing(false); setEditingId(undefined); setText(''); setError(''); }}>关闭</button>
          <button className="journal-primary" disabled={saving || !text.trim()}>保存</button></div>
      </form>}
      <div className="journal-composer">
        <button className="journal-icon-button" aria-label="键盘输入" onClick={() => { setEditing(true); setEditingId(undefined); setError(''); }}><JournalIcon name="keyboard" /></button>
        <button className={`journal-primary voice-action ${recording ? 'recording' : ''}`} disabled={saving}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            startVoice();
          }}
          onPointerUp={() => rec.current?.stop()}
          onPointerCancel={() => rec.current?.abort()}
          onClick={(event) => {
            if (event.detail === 0) {
              if (rec.current) rec.current.stop();
              else startVoice();
            }
          }}
          onContextMenu={(event) => event.preventDefault()}>
          <JournalIcon name="record" />{saving ? '正在记录…' : recording ? '正在听，松手记录' : '按住说话'}
        </button>
        <Link className="journal-icon-button" href="/chat" aria-label="拍照记录"><JournalIcon name="photo" /></Link>
      </div>
    </div>
  </>;
}
