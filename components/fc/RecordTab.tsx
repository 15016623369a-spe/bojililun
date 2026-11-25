'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { getRecognizerCtor, type Recognizer } from '@/lib/browser-recognition';
import AskSheet from './AskSheet';
import { createRecordDraft, sendRecordDraft } from '@/lib/record-drafts';
import { MicFillIcon } from './icons';
import VoiceOverlay, { type VoicePhase } from './VoiceOverlay';

/** 长按判定：短于这个时间算「点一下，去记录页」 */
const LONG_PRESS_MS = 250;
/** 上滑超过这个距离，进入取消态 */
const CANCEL_DISTANCE = 80;
/** 不到 1 秒的录音直接丢掉 */
const MIN_MS = 1000;
const TOAST_MS = 2400;

type Phase = 'idle' | VoicePhase;

type VibratingNavigator = Navigator & { vibrate?: (pattern: number | number[]) => boolean };

/**
 * 底部导航中间的「记录」，样子就是一颗话筒（11 月 25 日用户要求：不再另放录音键、不写「记录」两个字）。
 * 按住就地录音、松手记下、上滑取消，在哪个页面都行；在别的页面轻点去记录页；
 * 已经在记录页时轻点直接进语音输入（点「完成」记下、「取消」放弃），不再打开「记一条」面板。
 * 手势、麦克风、遮罩都在这里；页面不用关心。
 */
export default function RecordTab({
  active,
  onAudioRecorded,
  onTapStart,
}: {
  active?: boolean;
  /** 录完之后拿到音频；没接转写接口时先落成一句提示 */
  onAudioRecorded?: (blob: Blob, ms: number) => void;
  onTapStart?: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    router.prefetch('/log');
  }, [router]);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [ms, setMs] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [toast, setToast] = useState('');

  const recognition = useRef<Recognizer | null>(null);
  const transcript = useRef('');
  const [question, setQuestion] = useState<string | null>(null);
  const sendVoice = async (text: string) => {
    if (!text) {
      showToast('没听清，再说一次，或者在记录页右上角打字');
      return;
    }
    try {
      const result = await sendRecordDraft(createRecordDraft('voice', text));
      if (result.route === 'qa' && result.question) setQuestion(result.question);
      else if (result.route === 'plan') {
        router.push('/train');
        router.refresh();
        showToast(result.message || '已加入今日计划');
      } else {
        router.push('/log');
        router.refresh();
        showToast('已记下');
      }
    } catch (e) {
      router.push('/log');
      showToast('刚才网络断了一下，你说的话已经先存下来了，等网好了点重试就行');
    }
  };
  const phaseRef = useRef<Phase>('idle');
  const pressTimer = useRef(0);
  const msTimer = useRef(0);
  const toastTimer = useRef(0);
  const longPress = useRef(false);
  /** 轻点开始的语音输入：不靠松手结束，靠遮罩上的「完成 / 取消」 */
  const [tapping, setTapping] = useState(false);
  const released = useRef(false);
  const startY = useRef(0);
  const startedAt = useRef(0);
  const discard = useRef(false);
  const failed = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const cancelRef = useRef<HTMLDivElement | null>(null);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), TOAST_MS);
  }, []);

  /** 停掉麦克风、音频上下文和计时器；重复调用安全 */
  const cleanup = useCallback(() => {
    window.clearInterval(msTimer.current);
    setAnalyser(null);
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* 已经停了 */
      }
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const ctx = audioCtx.current;
    audioCtx.current = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
  }, []);

  const finalize = useCallback(() => {
    const duration = startedAt.current ? performance.now() - startedAt.current : 0;
    const mime = recorderRef.current?.mimeType || 'audio/webm';
    const blob = new Blob(chunks.current, { type: mime });
    chunks.current = [];
    const cancelled = discard.current;
    discard.current = false;
    startedAt.current = 0;
    cleanup();
    setPhase('idle');

    const speech = recognition.current;
    if (speech && !cancelled && duration >= MIN_MS && !onAudioRecorded) {
      const previous = speech.onend;
      speech.onend = () => {
        previous?.();
        void sendVoice(transcript.current.trim());
      };
      try {
        speech.stop();
      } catch {
        speech.onend();
      }
      return;
    }
    speech?.abort();
    if (cancelled) return;
    if (duration < MIN_MS) {
      showToast('说话时间太短');
      return;
    }
    if (onAudioRecorded) onAudioRecorded(blob, duration);
    else void sendVoice(transcript.current.trim());
  }, [cleanup, onAudioRecorded, setPhase, showToast]);

  const start = useCallback(async () => {
    setPhase('recording');
    setMs(0);
    discard.current = false;
    failed.current = false;
    (navigator as VibratingNavigator).vibrate?.(20);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setPhase('idle');
      showToast('这个浏览器不支持录音');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 等权限弹窗的时候手指已经松开了：干净收尾，别把遮罩挂在屏幕上
      if (released.current || phaseRef.current === 'idle') {
        stream.getTracks().forEach((track) => track.stop());
        setPhase('idle');
        return;
      }

      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createAnalyser();
      node.fftSize = 64;
      node.smoothingTimeConstant = 0.72;
      source.connect(node);
      setAnalyser(node);

      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
        MediaRecorder.isTypeSupported?.(type),
      );
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      recorder.onstop = () => finalize();
      transcript.current = '';
      const Ctor = getRecognizerCtor();
      if (Ctor && !onAudioRecorded) {
        const speech = new Ctor();
        speech.lang = 'zh-CN';
        speech.continuous = true;
        speech.interimResults = true;
        speech.onresult = (e) => {
          transcript.current = Array.from(
            { length: e.results.length },
            (_, i) => e.results[i][0]?.transcript ?? '',
          ).join('');
        };
        speech.onend = () => {
          recognition.current = null;
        };
        try {
          speech.start();
          recognition.current = speech;
        } catch {
          recognition.current = null;
        }
      }
      recorder.start(150);
      recorderRef.current = recorder;
      startedAt.current = performance.now();
      msTimer.current = window.setInterval(() => setMs(performance.now() - startedAt.current), 200);
    } catch {
      failed.current = true;
      cleanup();
      setPhase('idle');
      showToast('没有麦克风权限，可以在记录页右上角打字');
      router.push('/log');
    }
  }, [cleanup, finalize, router, setPhase, showToast]);

  const finish = useCallback(
    (cancel: boolean) => {
      released.current = true;
      window.clearInterval(msTimer.current);
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        cleanup();
        setPhase('idle');
        // 权限弹窗或启动还没完成就松手：除非是取消 / 已经报过错，否则按「太短」处理
        if (!cancel && !failed.current) showToast('说话时间太短');
        return;
      }
      discard.current = cancel;
      setPhase(cancel ? 'idle' : 'submitting');
      // 立刻掐掉麦克风，波形不要继续跳
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const ctx = audioCtx.current;
      audioCtx.current = null;
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
      try {
        recorder.stop();
      } catch {
        finalize();
      }
    },
    [cleanup, finalize, setPhase, showToast],
  );

  /** 手指现在是不是在取消按钮上 */
  const inCancelZone = (x: number, y: number) => {
    const rect = cancelRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const pad = 12;
    return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (phaseRef.current !== 'idle') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startY.current = event.clientY;
    longPress.current = false;
    released.current = false;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      longPress.current = true;
      void start();
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!longPress.current) return;
    if (phaseRef.current !== 'recording' && phaseRef.current !== 'canceling') return;
    const pulledUp = startY.current - event.clientY > CANCEL_DISTANCE;
    setPhase(pulledUp || inCancelZone(event.clientX, event.clientY) ? 'canceling' : 'recording');
  };

  /** 记录页上轻点：直接开始录音，遮罩上点「完成」记下、点「取消」放弃 */
  const startTap = () => {
    longPress.current = true;
    released.current = false;
    setTapping(true);
    void start();
  };

  /** 结束轻点开始的那次录音 */
  const endTap = (cancel: boolean) => {
    setTapping(false);
    finish(cancel);
  };

  const onPointerUp = () => {
    window.clearTimeout(pressTimer.current);
    if (tapping) return;
    if (!longPress.current) {
      // 短按：已在记录页就直接进语音输入，否则去记录页
      if (active) { startTap(); return; }
      onTapStart?.();
      router.push('/log');
      return;
    }
    if (phaseRef.current === 'canceling') {
      finish(true);
      return;
    }
    finish(false);
  };

  const onPointerCancel = () => {
    window.clearTimeout(pressTimer.current);
    if (tapping) return;
    if (longPress.current) finish(true);
    else setPhase('idle');
  };

  useEffect(() => {
    if (phase === 'idle') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [phase]);

  useEffect(
    () => () => {
      window.clearTimeout(pressTimer.current);
      window.clearTimeout(toastTimer.current);
      recognition.current?.abort();
      cleanup();
    },
    [cleanup],
  );

  // 录音结束（记下、取消、没拿到麦克风）后退出轻点模式
  useEffect(() => { if (phase === 'idle') setTapping(false); }, [phase]);

  const recording = phase !== 'idle';

  return (
    <>
      <a
        href="/log"
        className={`fc-tab fc-rec-tab${active ? ' on' : ''}`}
        aria-current={active ? 'page' : undefined}
        aria-label={active ? '记录：轻点开始说话，按住说话、松手记下' : '记录：轻点进入记录页，按住说话'}
        data-live={recording || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          // 短按已经手动 push 过；这里拦掉 <a> 的默认跳转，避免重复导航。
          // 键盘 Enter / Space 的 click 没有指针事件，detail 是 0，补一次。
          event.preventDefault();
          if (event.detail === 0) {
            if (active) { startTap(); return; }
            onTapStart?.();
            router.push('/log');
          }
        }}
      >
        <MicFillIcon className="fc-rec-glyph" />
        <span className="sr-only">记录</span>
        <i className="u" />
      </a>

      {question && <AskSheet question={question} onClose={() => setQuestion(null)} />}
      {toast && (
        <div className="fc-rec-toast" role="status">
          {toast}
        </div>
      )}

      {recording &&
        typeof document !== 'undefined' &&
        createPortal(
          <VoiceOverlay phase={phase as VoicePhase} analyser={analyser} ms={ms} cancelRef={cancelRef}
            tap={tapping} onDone={() => endTap(false)} onCancel={() => endTap(true)} />,
          document.body,
        )}
    </>
  );
}
