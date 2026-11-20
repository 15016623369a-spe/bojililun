'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MEAL_LABEL, type MealType } from '@/lib/date';
import { detectIntent } from '@/lib/intent';
import type { FoodItem, TimelineEntry } from '@/lib/types';
import AskSheet from './AskSheet';
import { MicIcon } from './icons';
import TabBar from './TabBar';
import Timeline from './Timeline';

/* ------------------------------ 语音识别（Web Speech API） ------------------------------ */

interface SpeechAlt {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlt;
}
interface SpeechEvent {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechResult };
}
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognizerCtor = new () => Recognizer;

function getRecognizerCtor(): RecognizerCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognizerCtor;
    webkitSpeechRecognition?: RecognizerCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const EXAMPLES = ['高位下拉 4 组 12 次 60 公斤，划船 4 组 12 次 50 公斤', '午饭吃了牛肉面和卤蛋', '晚上练了肩，推举和侧平举'];

/** 这句话更像训练还是饮食（决定照片走哪条链路） */
function looksTraining(text: string): boolean {
  return /(练|训练|组|次|kg|公斤|深蹲|卧推|下拉|划船|推举|硬拉|腿举|引体|跑了|骑了|游了)/i.test(text);
}

/** 压缩后再上传，别把 4MB 的原图塞进请求体 */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读不了这张图'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

interface FoodDraft {
  draftId: string;
  mealType: MealType;
  items: FoodItem[];
  note?: string;
}

export default function LogScreen({ entries }: { entries: TimelineEntry[] }) {
  const router = useRouter();

  const [phase, setPhase] = useState<'idle' | 'listening' | 'busy' | 'done'>('idle');
  const [heard, setHeard] = useState('');
  const [sent, setSent] = useState('');
  const [entry, setEntry] = useState<TimelineEntry | null>(null);
  const [toast, setToast] = useState('');
  const [ask, setAsk] = useState<string | null>(null);

  const [sheet, setSheet] = useState<'compose' | 'edit' | null>(null);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [draft, setDraft] = useState<FoodDraft | null>(null);
  const [working, setWorking] = useState(false);

  const [editMinutes, setEditMinutes] = useState('20');
  const [editText, setEditText] = useState('');

  const recRef = useRef<Recognizer | null>(null);
  const downAt = useRef(0);
  const abortRef = useRef(false);
  const finalRef = useRef('');
  const heardRef = useRef('');
  const busyRef = useRef(false);
  const modeRef = useRef<'record' | 'compose'>('record');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const submit = useCallback(
    async (value: string, photoDataUrl?: string) => {
      const clean = value.trim();
      if (!clean || busyRef.current) return;
      busyRef.current = true;
      setSent(clean);
      setHeard(clean);
      setPhase('busy');
      try {
        const res = await fetch('/api/log', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: clean, photo: photoDataUrl }),
        });
        const data = (await res.json()) as { entry?: TimelineEntry; error?: string };
        if (!res.ok || !data.entry) throw new Error(data.error || '没记上，再说一次');
        setEntry(data.entry);
        setPhase('done');
      } catch (e) {
        setPhase('idle');
        setSent('');
        setHeard('');
        setToast((e as Error).message);
      } finally {
        busyRef.current = false;
      }
    },
    [],
  );

  const handleInput = useCallback(
    (value: string) => {
      const text = value.trim();
      if (!text) return;
      if (detectIntent(text).kind === 'question') {
        setAsk(text);
        setPhase('idle');
        setHeard('');
        setSent('');
        return;
      }
      void submit(text);
    },
    [submit],
  );

  const stopRec = useCallback(() => {
    abortRef.current = false;
    const rec = recRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* 已经停了 */
      }
    }
  }, []);

  const abortRec = useCallback(() => {
    abortRef.current = true;
    const rec = recRef.current;
    if (rec) {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
    recRef.current = null;
    setPhase('idle');
    setListening(false);
    setHeard('');
  }, []);

  const openComposer = useCallback(() => {
    setText('');
    setPhoto(null);
    setDraft(null);
    setSheet('compose');
  }, []);

  const startRec = useCallback(
    (mode: 'record' | 'compose') => {
      const Ctor = getRecognizerCtor();
      if (!Ctor) {
        if (mode === 'record') openComposer();
        else setToast('这个浏览器不支持语音，先打字吧');
        return;
      }
      modeRef.current = mode;
      finalRef.current = '';
      heardRef.current = '';

      if (mode === 'record') {
        setHeard('');
        setSent('');
        if (entry) {
          setEntry(null);
          router.refresh();
        }
        setPhase('listening');
      } else {
        setListening(true);
      }

      try {
        const rec = new Ctor();
        rec.lang = 'zh-CN';
        rec.continuous = true;
        rec.interimResults = true;

        rec.onresult = (ev: SpeechEvent) => {
          let interim = '';
          for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
            const r = ev.results[i];
            const t = r[0]?.transcript ?? '';
            if (r.isFinal) finalRef.current += t;
            else interim += t;
          }
          const value = `${finalRef.current}${interim}`;
          heardRef.current = value;
          if (modeRef.current === 'record') setHeard(value);
          else setText(value);
        };

        rec.onerror = (ev: { error?: string }) => {
          abortRef.current = true;
          if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
            setToast('没有麦克风权限，先打字记一条');
            if (modeRef.current === 'record') openComposer();
          } else if (ev.error === 'no-speech') {
            setToast('没听到声音，再说一次');
          }
          setPhase('idle');
          setListening(false);
        };

        rec.onend = () => {
          recRef.current = null;
          setListening(false);
          if (abortRef.current) return;
          const value = (finalRef.current || heardRef.current).trim();
          if (modeRef.current === 'record') {
            if (value) handleInput(value);
            else setPhase('idle');
          }
        };

        recRef.current = rec;
        rec.start();
      } catch {
        setPhase('idle');
        setListening(false);
        setToast('语音识别没启动成功，先打字记一条');
        if (mode === 'record') openComposer();
      }
    },
    [entry, handleInput, openComposer, router],
  );

  useEffect(() => {
    const onUp = () => {
      if (!recRef.current) return;
      const held = Date.now() - downAt.current;
      const mode = modeRef.current;
      if (held < 300) {
        abortRec();
        if (mode === 'record') openComposer();
        return;
      }
      stopRec();
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [abortRec, openComposer, stopRec]);

  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (phase === 'busy') return;
    downAt.current = Date.now();
    startRec('record');
  };

  const onComposeDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    downAt.current = Date.now();
    startRec('compose');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  /** 面板里的「记下来」：有照片时，训练挂图、饮食走拍照识别 */
  const submitComposer = async () => {
    const value = text.trim();
    if (working) return;
    if (!value && !photo) {
      setToast('说点什么，或者加张照片');
      return;
    }
    if (!photo) {
      setSheet(null);
      handleInput(value);
      return;
    }

    if (value && looksTraining(value)) {
      setSheet(null);
      void submit(value, photo);
      return;
    }

    // 饮食 / 没文字：交给认识图片的那条链路，先出草稿
    setWorking(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: photo, text: value || undefined }),
      });
      const data = (await res.json()) as { replies?: Array<Record<string, unknown>>; error?: string };
      if (!res.ok) throw new Error(data.error || '识别失败');
      const card = (data.replies ?? []).find((r) => r.kind === 'food_card') as
        | { draftId: string; mealType: MealType; items: FoodItem[]; note?: string }
        | undefined;
      if (!card) throw new Error('没认出这张照片里的食物，换个说法或直接打字');
      setDraft({ draftId: card.draftId, mealType: card.mealType, items: card.items, note: card.note });
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const confirmDraft = async () => {
    if (!draft || working) return;
    setWorking(true);
    try {
      const res = await fetch('/api/meals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftId: draft.draftId, items: draft.items }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || '保存失败');
      setSheet(null);
      setDraft(null);
      setText('');
      setPhoto(null);
      setToast('已记入今天的饮食');
      router.refresh();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const undo = async () => {
    if (!entry) return;
    const res = await fetch(`/api/log?kind=${entry.kind}&id=${entry.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setToast('撤销失败，再试一次');
      return;
    }
    setEntry(null);
    setSent('');
    setHeard('');
    setPhase('idle');
    setToast('已撤销');
    router.refresh();
  };

  const openEdit = () => {
    if (!entry) return;
    if (entry.kind === 'training') {
      setEditMinutes(String(entry.minutes || 20));
      setEditText(entry.exercises.join('、'));
    } else {
      setEditMinutes('');
      setEditText(entry.items.join('、'));
    }
    setSheet('edit');
  };

  const saveEdit = async () => {
    if (!entry) return;
    const isTraining = entry.kind === 'training';
    const parts = editText.split(/[、,，\s]+/).filter(Boolean);
    if (parts.length === 0) {
      setToast(isTraining ? '至少留一个动作' : '至少留一样吃的');
      return;
    }
    const res = await fetch('/api/log', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        isTraining
          ? { kind: 'training', id: entry.id, minutes: Number(editMinutes) || 1, exercises: parts }
          : { kind: 'meal', id: entry.id, names: parts },
      ),
    });
    const data = (await res.json()) as { entry?: TimelineEntry; error?: string };
    if (!res.ok || !data.entry) {
      setToast(data.error || '保存失败');
      return;
    }
    setEntry(data.entry);
    setSheet(null);
    setToast('已更新');
  };

  const recording = phase === 'listening';

  return (
    <>
      {recording && (
        <div className="fc-pill">
          <div className="fc-pill-hd">
            <span>在听…</span>
            <span className="fc-wave" aria-hidden>
              <i /> <i /> <i /> <i /> <i /> <i /> <i /> <i /> <i />
            </span>
          </div>
          <div className="fc-quote">{heard || '说一句话'}</div>
        </div>
      )}

      <Timeline entries={entries} pending={entry} onEdit={openEdit} onUndo={() => void undo()} />

      <div className="fc-dock">
        <div className="fc-dock-inner">
          <button
            type="button"
            className={`fc-speak${recording ? ' rec' : ''}`}
            onPointerDown={onDown}
            onContextMenu={(e) => e.preventDefault()}
            aria-label="按住说话记录"
          >
            <MicIcon />
            {recording ? '松开结束' : phase === 'busy' ? '正在记…' : '按住说话'}
          </button>
          <TabBar active="log" />
        </div>
      </div>

      {/* 记录面板：文字 / 照片 / 语音 都能来 */}
      {sheet === 'compose' && (
        <div className="fc-mask" onClick={() => !working && setSheet(null)}>
          <div className="fc-sheet" onClick={(e) => e.stopPropagation()}>
            {draft ? (
              <>
                <h3>认出这些，确认一下</h3>
                <p className="hint">
                  {MEAL_LABEL[draft.mealType]} · {draft.note ?? '拍照识别'} — 不对就改一下再确认。
                </p>
                <div className="fc-draft-list">
                  {draft.items.map((it, i) => (
                    <div className="fc-draft-row" key={`${it.name}-${i}`}>
                      <span>{it.name}</span>
                      <span className="fc-draft-grams">{Math.round(it.grams)}g</span>
                    </div>
                  ))}
                </div>
                <div className="fc-sheet-actions">
                  <button type="button" className="fc-btn ghost" onClick={() => setDraft(null)}>
                    重来
                  </button>
                  <button type="button" className="fc-btn primary" onClick={() => void confirmDraft()} disabled={working}>
                    {working ? '保存中…' : '确认记入'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>记一条</h3>
                <p className="hint">说话、打字、拍照都行。带上组数重量，热量和热区才准。</p>

                <div className="fc-examples">
                  {EXAMPLES.map((x) => (
                    <button key={x} type="button" onClick={() => setText(x)}>
                      {x}
                    </button>
                  ))}
                </div>

                <textarea
                  className="fc-input"
                  placeholder="例如：高位下拉 4 组 12 次 60 公斤"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                />

                {photo && (
                  <div className="fc-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo} alt="待记录的图" />
                    <button type="button" className="fc-photo-x" onClick={() => setPhoto(null)} aria-label="去掉照片">
                      ×
                    </button>
                  </div>
                )}

                <div className="fc-compose-bar">
                  <label className={`fc-attach${working ? ' disabled' : ''}`}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        void onFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                      hidden
                    />
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="18" height="14" rx="3" />
                      <circle cx="9" cy="10" r="1.6" />
                      <path d="M4 17l4.5-4.5 3 3 3-2.5L20 17" />
                    </svg>
                    照片
                  </label>
                  <button
                    type="button"
                    className={`fc-hold${listening ? ' on' : ''}`}
                    onPointerDown={onComposeDown}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <MicIcon />
                    {listening ? '在听…' : '按住说话'}
                  </button>
                </div>

                <div className="fc-sheet-actions">
                  <button type="button" className="fc-btn ghost" onClick={() => setSheet(null)}>
                    取消
                  </button>
                  <button type="button" className="fc-btn primary" onClick={() => void submitComposer()} disabled={working || listening}>
                    {working ? '处理中…' : '记下来'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {sheet === 'edit' && entry && (
        <div className="fc-mask" onClick={() => setSheet(null)}>
          <div className="fc-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>编辑这条记录</h3>
            <p className="hint">{entry.kind === 'training' ? '改时长或动作，用顿号分隔。' : '改吃了什么，用顿号分隔。'}</p>
            {entry.kind === 'training' && (
              <label className="fc-field">
                <span>时长（分钟）</span>
                <input
                  className="fc-input"
                  inputMode="numeric"
                  value={editMinutes}
                  onChange={(e) => setEditMinutes(e.target.value.replace(/[^\d]/g, ''))}
                />
              </label>
            )}
            <label className="fc-field">
              <span>{entry.kind === 'training' ? '动作' : '吃了什么'}</span>
              <textarea className="fc-input" value={editText} onChange={(e) => setEditText(e.target.value)} />
            </label>
            <div className="fc-sheet-actions">
              <button type="button" className="fc-btn ghost" onClick={() => setSheet(null)}>
                取消
              </button>
              <button type="button" className="fc-btn primary" onClick={() => void saveEdit()}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {ask && <AskSheet question={ask} onClose={() => setAsk(null)} />}

      {toast && <div className="fc-toast">{toast}</div>}
    </>
  );
}
