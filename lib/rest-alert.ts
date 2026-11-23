'use client';

import { useEffect } from 'react';

/**
 * 组间休息结束的提醒。iPhone 网页没有振动，锁屏后计时也看不到，所以：
 * - 训练中申请屏幕常亮（Screen Wake Lock，iOS 16.4+ / Chrome 支持）；
 * - 休息结束响两声短促的提示音。iOS 只允许在点击里启用声音，点「完成第 N 组」时顺手解锁。
 * 浏览器不支持时静默跳过，振动照旧。
 */

type AudioCtor = typeof AudioContext;
let context: AudioContext | null = null;

export function unlockChime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return;
    context ??= new Ctor();
    if (context.state === 'suspended') void context.resume();
  } catch { /* 没有声音接口时只振动 */ }
}

export function playChime() {
  const ctx = context;
  if (!ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime;
  for (const [offset, frequency] of [[0, 880], [0.24, 1175]]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.3, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + offset);
    osc.stop(start + offset + 0.22);
  }
}

/** 训练进行中保持屏幕常亮；切到后台会被系统释放，回到前台时重新申请 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const request = async () => {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (stopped) void next.release();
        else lock = next;
      } catch { /* 省电模式等情况下申请会失败，不影响训练 */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible' && !stopped) void request(); };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
