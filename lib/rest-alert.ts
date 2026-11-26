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

/** 勾选完成一组时的清脆机械咔哒音（破纪录时附带上升和弦） */
export function playCheckClick(isPr = false) {
  unlockChime();
  const ctx = context;
  if (!ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime;

  // 1. 短促清脆的机械落点（tock）
  const thud = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thud.type = 'triangle';
  thud.frequency.setValueAtTime(340, start);
  thud.frequency.exponentialRampToValueAtTime(140, start + 0.028);
  thudGain.gain.setValueAtTime(0.22, start);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.032);
  thud.connect(thudGain).connect(ctx.destination);
  thud.start(start);
  thud.stop(start + 0.035);

  // 2. 清亮确认泛音（类似手表圆环合拢 / 提醒事项划掉）
  const notes = isPr
    ? [[0.015, 1046.5, 0.16], [0.085, 1318.5, 0.16], [0.16, 1568, 0.22]]
    : [[0.012, 1174.66, 0.14]];
  for (const [offset, freq, dur] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.16, start + offset + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + offset);
    osc.stop(start + offset + dur + 0.01);
  }
}

/** 微调重量/次数时的极轻棘轮滴答声 */
export function playStepTick() {
  unlockChime();
  const ctx = context;
  if (!ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(760, start);
  osc.frequency.exponentialRampToValueAtTime(420, start + 0.012);
  gain.gain.setValueAtTime(0.06, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.015);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.018);
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
