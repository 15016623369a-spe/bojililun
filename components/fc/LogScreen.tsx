'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AskSheet from './AskSheet';
import { CameraIcon, KeyboardIcon, MicIcon } from './icons';
import TabBar from './TabBar';
import Timeline from './Timeline';

/* ------------------------------ 语音识别（Web Speech API） ------------------------------ */

import { getRecognizerCtor, type Recognizer } from '@/lib/browser-recognition';

const EXAMPLES = [
  '高位下拉 4 组 12 次 60 公斤，划船 4 组 12 次 50 公斤',
  '午饭吃了牛肉面和卤蛋',
  '晚上练了肩，推举和侧平举',
];

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

export default function LogScreen({ ledgerHasRecords }: { ledgerHasRecords: boolean }) {
  const router = useRouter();

  const [phase, setPhase] = useState<'idle' | 'listening' | 'busy' | 'done'>('idle');
  const [heard, setHeard] = useState('');
  const [toast, setToast] = useState('');
  const [ask, setAsk] = useState<string | null>(null);

  const [sheet, setSheet] = useState<'compose' | 'edit' | null>(null);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const working = phase === 'busy';
  const composeSource = useRef<'manual' | 'voice'>('manual');
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
    async (value: string, photoDataUrl?: string, source: 'manual' | 'voice' | 'photo' = 'manual') => {
      if (busyRef.current) return;
      busyRef.current = true;
      setPhase('busy');
      try {
        const res = await fetch('/api/ledger', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request_id: crypto.randomUUID(), source, text: value, photo: photoDataUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw Error(data.error);
        if (data.route === 'qa') setAsk(data.question);
        else {
          router.refresh();
          setToast('已记入手账');
        }
        setSheet(null);
        setPhase('idle');
      } catch (e) {
        setToast((e as Error).message);
        setPhase('idle');
      } finally {
        busyRef.current = false;
      }
    },
    [router],
  );
  const handleInput = useCallback((value: string) => void submit(value, undefined, 'voice'), [submit]);

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

  const photoInput = useRef<HTMLInputElement>(null);

  const openComposer = useCallback(() => {
    setText('');
    setPhoto(null);
    composeSource.current = 'manual';
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

        setPhase('listening');
      } else {
        setListening(true);
      }

      try {
        const rec = new Ctor();
        rec.lang = 'zh-CN';
        rec.continuous = true;
        rec.interimResults = true;

        rec.onresult = (ev) => {
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
          else {
            composeSource.current = 'voice';
            setText(value);
          }
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
    [handleInput, openComposer],
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
    await submit(value, photo ?? undefined, photo ? 'photo' : composeSource.current);
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

      {!ledgerHasRecords && <Timeline entries={[]} />}

      <div className="fc-dock">
        <div className="fc-dock-inner">
          <div className="fc-record-controls">
            <button
              type="button"
              className="fc-record-icon"
              aria-label="打字"
              title="打字"
              onClick={openComposer}
            >
              <KeyboardIcon />
            </button>
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
            <button
              type="button"
              className="fc-record-icon"
              aria-label="拍照或选照片"
              title="拍照或选照片"
              disabled={working}
              onClick={() => photoInput.current?.click()}
            >
              <CameraIcon />
            </button>
          </div>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (!file) return;
              if (sheet !== 'compose') openComposer();
              void onFile(file);
            }}
            hidden
          />
          <TabBar active="log" />
        </div>
      </div>

      {/* 记录面板：文字 / 照片 / 语音 都能来 */}
      {sheet === 'compose' && (
        <div className="fc-mask" onClick={() => !working && setSheet(null)}>
          <div className="fc-sheet" onClick={(e) => e.stopPropagation()}>
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
              onChange={(e) => {
                composeSource.current = 'manual';
                setText(e.target.value);
              }}
              autoFocus
            />

            {photo && (
              <div className="fc-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt="待记录的图" />
                <button
                  type="button"
                  className="fc-photo-x"
                  onClick={() => setPhoto(null)}
                  aria-label="去掉照片"
                >
                  ×
                </button>
              </div>
            )}

            <div className="fc-compose-bar">
              <button
                type="button"
                className="fc-attach"
                disabled={working}
                onClick={() => photoInput.current?.click()}
              >
                <CameraIcon /> 照片
              </button>
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
              <button
                type="button"
                className="fc-btn primary"
                onClick={() => void submitComposer()}
                disabled={working || listening}
              >
                {working ? '处理中…' : '记下来'}
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
