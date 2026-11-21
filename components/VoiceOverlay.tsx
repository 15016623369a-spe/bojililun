'use client';

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import DotDigits from './ui/DotDigits';
import Icon from './ui/Icon';
import JournalIcon from './JournalIcon';

const COLS = 30;
const ROWS = 13;

/**
 * 按住说话时的全屏状态：点阵计时、点阵波形和珊瑚色实时转写。
 * level 由麦克风音量驱动（桌面浏览器）；拿不到音量时按转写的变化模拟起伏。
 */
export default function VoiceOverlay({ heard, startedAt, level, armed, onRelease }: {
  heard: string;
  startedAt: number;
  level: MutableRefObject<number | null>;
  armed: boolean;
  onRelease: () => void;
}) {
  const [now, setNow] = useState(startedAt);
  const [bars, setBars] = useState<number[]>(() => Array(COLS).fill(0));
  const lastHeard = useRef({ text: '', at: 0 });

  useEffect(() => {
    if (heard !== lastHeard.current.text) lastHeard.current = { text: heard, at: performance.now() };
  }, [heard]);

  useEffect(() => {
    let raf = 0, last = 0, phase = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 70) return;
      last = t;
      phase += 1;
      setNow(Date.now());
      const real = level.current;
      let value: number;
      if (real !== null) value = Math.min(1, real * 2.6);
      else {
        // 没有音量数据：刚出新字时起伏大，停顿时只留轻微的呼吸
        const since = t - lastHeard.current.at;
        const talk = Math.max(0, 1 - since / 900);
        value = .08 + .05 * Math.sin(phase * .5) + talk * (.35 + Math.random() * .55);
      }
      setBars((prev) => [...prev.slice(1), Math.max(0, Math.min(1, value))]);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [level]);

  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const cell = 10;

  return <div className="voice-overlay" data-armed={armed || undefined} role="dialog" aria-modal="true" aria-label="语音记录">
    <header className="voice-head">
      <div className="journal-brand"><JournalIcon name="brand" />FitCheck</div>
      <span className="journal-head-label">{armed ? '松开取消' : '语音记录'}</span>
    </header>

    <section className="voice-stage" aria-hidden="true">
      <p className="voice-live-tag"><i />{armed ? '松开即取消' : '正在听'}</p>
      <div className="voice-clock"><DotDigits text={clock} cell={11} label={`已录 ${clock}`} /></div>
      <svg className="voice-wave" viewBox={`0 0 ${COLS * cell} ${ROWS * cell}`} preserveAspectRatio="xMidYMax meet">
        {bars.map((value, col) => {
          const lit = Math.max(1, Math.round(value * ROWS));
          return Array.from({ length: ROWS }, (_, row) => {
            const on = ROWS - row <= lit;
            return <circle key={`${col}-${row}`} cx={col * cell + cell / 2} cy={row * cell + cell / 2} r={on ? cell * .36 : cell * .12} className={on ? 'on' : undefined} />;
          });
        })}
      </svg>
    </section>

    <section className="voice-sheet" aria-live="polite">
      <span className="voice-grab" aria-hidden="true" />
      <p className="voice-sheet-label">实时转写</p>
      <p className="voice-transcript">{heard || <span className="placeholder">直接说，比如「杠铃卧推六十公斤，三组，每组十次」</span>}<i className="caret" aria-hidden="true" /></p>
      <button type="button" className="ink-btn voice-release" onClick={onRelease}>
        <span className="voice-release-label"><Icon name="mic" size={20} />{armed ? '松开取消' : '松手发送'}</span>
      </button>
      <p className="voice-hint"><Icon name="arrow-up" size={13} stroke={2} />上滑取消</p>
    </section>
  </div>;
}
