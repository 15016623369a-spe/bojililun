'use client';

import { useEffect, useRef, useState } from 'react';
import JournalIcon from '@/components/JournalIcon';

const KF_POS = ['0% 0%', '100% 0%', '0% 100%', '100% 100%'] as const;

export interface ExerciseStageProps {
  id: string;
  name: string;
  image?: string;
  hasAnimation?: boolean;
  hasSculpture?: boolean;
  mp4Url?: string;
  kfSheetUrl?: string;
  kfLabels?: [string, string, string, string];
  compact?: boolean;
}

export default function ExerciseStage(props: ExerciseStageProps) {
  return <ExerciseStageInner key={props.id} {...props} />;
}

function ExerciseStageInner({
  id,
  name,
  image,
  hasAnimation = true,
  hasSculpture = false,
  mp4Url,
  kfSheetUrl,
  kfLabels = ['准备', '启动', '推进', '顶峰'],
  compact = false,
}: ExerciseStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [speed, setSpeed] = useState<1 | 0.5>(1);
  const [paused, setPaused] = useState(false);
  const [lockedKf, setLockedKf] = useState<number | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [gifState, setGifState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [posterFailed, setPosterFailed] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const useSculptureStage = Boolean(hasSculpture && mp4Url && kfSheetUrl && !videoFailed);
  const isPausedOrLocked = paused || lockedKf !== null || reducedMotion;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !useSculptureStage) return;
    el.playbackRate = speed;
    if (isPausedOrLocked) {
      el.pause();
    } else {
      el.play().catch(() => {});
    }
  }, [useSculptureStage, speed, isPausedOrLocked]);

  if (useSculptureStage && kfSheetUrl) {
    return (
      <div className={`ex-stage-card${compact ? ' is-compact' : ''}`}>
        <div className="ex-stage-top">
          <div className="ex-stage-controls">
            <button
              type="button"
              className={`ex-ctrl-chip ghost${speed === 0.5 ? ' active' : ''}`}
              aria-pressed={speed === 0.5}
              onClick={() => setSpeed((s) => (s === 1 ? 0.5 : 1))}
            >
              {speed === 0.5 ? '0.5×' : '1×'}
            </button>
            <button
              type="button"
              className="ex-ctrl-chip"
              aria-label={isPausedOrLocked ? '播放动作演示' : '暂停动作演示'}
              onClick={() => {
                if (lockedKf !== null) {
                  setLockedKf(null);
                  setPaused(false);
                  return;
                }
                setPaused((p) => !p);
              }}
            >
              <JournalIcon name={isPausedOrLocked ? 'play' : 'pause'} />
              <span>{isPausedOrLocked ? '播放' : '暂停'}</span>
            </button>
          </div>

          {lockedKf !== null ? (
            <div
              className="ex-stage-freeze"
              role="img"
              aria-label={`${name} · ${kfLabels[lockedKf]}`}
              style={{
                backgroundImage: `url("${kfSheetUrl}")`,
                backgroundPosition: KF_POS[lockedKf],
              }}
            />
          ) : (
            <video
              ref={videoRef}
              className="ex-stage-video"
              src={mp4Url}
              poster={image}
              autoPlay={!reducedMotion}
              loop
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={() => {
                if (videoRef.current) videoRef.current.playbackRate = speed;
              }}
              onError={() => setVideoFailed(true)}
            />
          )}
        </div>

        <div className="ex-kf-strip" role="group" aria-label="关键帧拆解">
          {[0, 1, 2, 3].map((idx) => {
            const active = lockedKf === idx;
            return (
              <button
                key={idx}
                type="button"
                className={`ex-kf-item${active ? ' on' : ''}`}
                aria-pressed={active}
                onClick={() => {
                  if (active) {
                    setLockedKf(null);
                    setPaused(false);
                  } else {
                    setLockedKf(idx);
                    setPaused(true);
                  }
                }}
              >
                <span
                  className="ex-kf-thumb"
                  aria-hidden="true"
                  style={{
                    backgroundImage: `url("${kfSheetUrl}")`,
                    backgroundPosition: KF_POS[idx],
                  }}
                />
                <span className="ex-kf-label">
                  <b>0{idx + 1}</b>
                  {kfLabels[idx]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const canPlayLegacy = hasAnimation && gifState !== 'unavailable';
  const playingLegacy = canPlayLegacy && !paused && !reducedMotion;
  const showLegacyGif = playingLegacy && gifState === 'ready';
  const showPoster = Boolean(image && !posterFailed);

  return (
    <div className={`ex-stage-card is-legacy${compact ? ' is-compact' : ''}`}>
      <div className="ex-stage-top is-legacy-bg">
        {canPlayLegacy ? (
          <div className="ex-stage-controls">
            <button
              type="button"
              className="ex-ctrl-chip"
              aria-label={playingLegacy ? '暂停动作演示' : '播放动作演示'}
              onClick={() => {
                if (!playingLegacy) setGifState('loading');
                setPaused(playingLegacy);
              }}
            >
              <JournalIcon name={playingLegacy ? 'pause' : 'play'} />
              <span>{playingLegacy ? '暂停' : '播放'}</span>
            </button>
          </div>
        ) : (
          showPoster && <span className="ex-stage-badge">静态示意</span>
        )}

        <div className="ex-legacy-frame">
          {showPoster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={name}
              aria-hidden={showLegacyGif}
              onError={() => setPosterFailed(true)}
            />
          )}
          {playingLegacy && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={`ex-legacy-anim${showLegacyGif ? ' visible' : ''}`}
              src={`/api/gif/${id}`}
              alt={`${name}动作演示`}
              aria-hidden={!showLegacyGif}
              onLoad={() => setGifState('ready')}
              onError={() => setGifState('unavailable')}
            />
          )}
          {!showPoster && !showLegacyGif && (
            <p className="ex-stage-empty">{playingLegacy ? '正在加载演示…' : '暂无动作演示'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
