'use client';

import { useEffect, useRef } from 'react';
import { MicIcon } from './icons';

export type VoicePhase = 'recording' | 'canceling' | 'submitting';

const BAR_COUNT = 27;

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 全屏录音遮罩：只负责画，不碰麦克风。
 * 声波条由父组件传进来的 AnalyserNode 驱动，逐帧直接改 DOM，避免 30fps 的 React 重渲染。
 */
export default function VoiceOverlay({
  phase,
  analyser,
  ms,
  cancelRef,
}: {
  phase: VoicePhase;
  analyser: AnalyserNode | null;
  ms: number;
  cancelRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const barsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = barsRef.current;
    if (!host) return;
    const bars = Array.from(host.children) as HTMLElement[];
    const data = analyser ? new Uint8Array(analyser.fftSize) : null;
    let raf = 0;
    let last = 0;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 32) return;
      last = t;

      let level = 0;
      if (analyser && data) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        level = Math.min(1, Math.sqrt(sum / data.length) * 3.6);
      }

      const mid = (bars.length - 1) / 2;
      bars.forEach((bar, i) => {
        const env = 1 - Math.abs(i - mid) / (mid + 1);
        const wobble = 0.62 + 0.38 * Math.sin(t / 150 + i * 0.85);
        const height = 6 + (12 + 40 * level) * (0.35 + 0.65 * env) * wobble;
        bar.style.height = `${height.toFixed(1)}px`;
      });
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  const canceling = phase === 'canceling';

  return (
    <div className="fc-rec" role="dialog" aria-modal="true" aria-label="语音记录">
      <div className="fc-rec-mask" />

      <div className={`fc-rec-card${canceling ? ' warn' : ''}`}>
        <div className="fc-rec-bars" ref={barsRef} aria-hidden>
          {Array.from({ length: BAR_COUNT }, (_, i) => (
            <i key={i} />
          ))}
        </div>
        <div className="fc-rec-time">
          <span className={`fc-rec-dot${canceling ? ' off' : ''}`} aria-hidden />
          {clock(ms)}
        </div>
      </div>

      <div className={`fc-rec-cancel${canceling ? ' on' : ''}`} ref={cancelRef}>
        <div className="fc-rec-x" aria-hidden>
          ×
        </div>
        <p aria-live="assertive">{canceling ? '松手即可取消' : '松手记下，上滑取消'}</p>
      </div>

      <div className="fc-rec-press" aria-hidden>
        <MicIcon />
      </div>
    </div>
  );
}
