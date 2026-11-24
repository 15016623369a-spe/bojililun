'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { getRecognizerCtor, type Recognizer } from '@/lib/browser-recognition';

/**
 * 按住说话：按下开始听，松手把识别出的文字交给 onText，上滑取消。
 * 和「记录」页的按住说话同一套浏览器语音识别（lib/browser-recognition.ts、zh-CN、边说边出字）。
 * 「教练」输入框在用；「记录」页的实现还在 LogScreen 里，之后可以换成这个。
 */

export type HoldPhase = 'idle' | 'listening' | 'canceling' | 'finishing';

/** 按住不到这么久算轻点：不发送，只提示要按住 */
const TAP_MS = 300;
/** 手指上滑超过这么多像素就进入「松开取消」 */
const CANCEL_DISTANCE = 64;
/** 松手后最多等识别收尾这么久，拿不到结束事件就用已经听到的文字 */
const FINISH_TIMEOUT_MS = 2500;

export function useHoldToSpeak({ onText, onNotice }: {
  /** 识别出的完整文字，已去掉首尾空白，不会是空串 */
  onText: (text: string) => void;
  /** 需要告诉用户的情况：轻点、没听清、没权限、浏览器不支持 */
  onNotice: (text: string) => void;
}) {
  const [phase, setPhaseState] = useState<HoldPhase>('idle');
  const [heard, setHeard] = useState('');
  const phaseRef = useRef<HoldPhase>('idle');
  const rec = useRef<Recognizer | null>(null);
  const finalText = useRef('');
  const heardRef = useRef('');
  const aborted = useRef(false);
  const delivered = useRef(false);
  const failure = useRef('');
  const downAt = useRef(0);
  const startY = useRef(0);
  const finishTimer = useRef(0);
  const handlers = useRef({ onText, onNotice });
  handlers.current = { onText, onNotice };

  const setPhase = useCallback((next: HoldPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const reset = useCallback(() => {
    window.clearTimeout(finishTimer.current);
    rec.current = null;
    setPhase('idle');
    setHeard('');
  }, [setPhase]);

  /** 交出文字，只交一次 */
  const deliver = useCallback(() => {
    if (delivered.current || aborted.current) return;
    delivered.current = true;
    const text = (finalText.current || heardRef.current).trim();
    reset();
    if (text) handlers.current.onText(text);
    else if (failure.current) handlers.current.onNotice(`语音识别出错，请重试（${failure.current}）`);
    else handlers.current.onNotice('没听清，再说一次，或者直接打字');
  }, [reset]);

  const abort = useCallback(() => {
    aborted.current = true;
    const current = rec.current;
    if (current) {
      try {
        current.abort();
      } catch {
        /* 已经停了 */
      }
    }
    reset();
  }, [reset]);

  const start = useCallback(() => {
    if (!window.isSecureContext) {
      handlers.current.onNotice('当前不是加密连接（HTTP），浏览器不允许打开麦克风。请改用 https:// 地址访问，或者直接打字。');
      return false;
    }
    const Ctor = getRecognizerCtor();
    if (!Ctor) {
      handlers.current.onNotice('当前浏览器不支持语音输入，试试 Safari 或 Chrome，或者直接打字。');
      return false;
    }
    finalText.current = '';
    heardRef.current = '';
    aborted.current = false;
    delivered.current = false;
    failure.current = '';
    setHeard('');
    try {
      const speech = new Ctor();
      speech.lang = 'zh-CN';
      speech.continuous = true;
      speech.interimResults = true;
      speech.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) finalText.current += text;
          else interim += text;
        }
        heardRef.current = `${finalText.current}${interim}`;
        setHeard(heardRef.current);
      };
      speech.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          aborted.current = true;
          handlers.current.onNotice('未开启麦克风权限，请在浏览器地址栏或系统设置里允许访问麦克风，或者直接打字。');
          reset();
        } else if (event.error === 'no-speech') {
          aborted.current = true;
          handlers.current.onNotice('没听到声音，再说一次');
          reset();
        } else if (event.error && event.error !== 'aborted') {
          failure.current = event.error;
        }
      };
      speech.onend = () => {
        // 还按着时识别自己停了（例如长时间没出声）：等松手再交
        if (phaseRef.current === 'listening' || phaseRef.current === 'canceling') {
          rec.current = null;
          return;
        }
        deliver();
      };
      rec.current = speech;
      speech.start();
      // 和回顾的 haptic 一样：页面还没被真正点过时不振动，免得浏览器报错
      const nav = navigator as Navigator & { vibrate?: (ms: number) => boolean; userActivation?: { hasBeenActive: boolean } };
      if (!nav.userActivation || nav.userActivation.hasBeenActive) nav.vibrate?.(12);
      setPhase('listening');
      return true;
    } catch {
      reset();
      handlers.current.onNotice('语音识别没启动成功，先打字吧');
      return false;
    }
  }, [deliver, reset, setPhase]);

  const finish = useCallback(() => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'finishing') return;
    if (phaseRef.current === 'canceling') {
      abort();
      return;
    }
    if (Date.now() - downAt.current < TAP_MS) {
      abort();
      handlers.current.onNotice('按住说话，松开发送');
      return;
    }
    setPhase('finishing');
    const current = rec.current;
    if (!current) {
      deliver();
      return;
    }
    finishTimer.current = window.setTimeout(deliver, FINISH_TIMEOUT_MS);
    try {
      current.stop();
    } catch {
      deliver();
    }
  }, [abort, deliver, setPhase]);

  useEffect(() => () => {
    window.clearTimeout(finishTimer.current);
    aborted.current = true;
    rec.current?.abort();
  }, []);

  const bind = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (phaseRef.current !== 'idle') return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* 合成事件或指针已经离开：不捕获也能在按钮上收到松手 */
      }
      downAt.current = Date.now();
      startY.current = event.clientY;
      start();
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (phaseRef.current !== 'listening' && phaseRef.current !== 'canceling') return;
      setPhase(startY.current - event.clientY > CANCEL_DISTANCE ? 'canceling' : 'listening');
    },
    onPointerUp: () => finish(),
    onPointerCancel: () => {
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'finishing') abort();
    },
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
  };

  return { phase, heard, bind };
}
