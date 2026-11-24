'use client';

import { useEffect, useState } from 'react';
import JournalIcon from './JournalIcon';

type MediaProps = {
  id: string;
  image?: string;
  name: string;
  hasAnimation?: boolean;
  variant?: 'detail' | 'runner';
};

export default function ExerciseMedia(props: MediaProps) {
  return <ExerciseMediaPlayer key={props.id} {...props} />;
}

function ExerciseMediaPlayer({ id, image, name, hasAnimation = true, variant = 'detail' }: MediaProps) {
  const [autoPlay, setAutoPlay] = useState(false);
  const [play, setPlay] = useState<boolean>();
  const [animation, setAnimation] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [posterFailed, setPosterFailed] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAutoPlay(!motion.matches);
    update();
    motion.addEventListener('change', update);
    return () => motion.removeEventListener('change', update);
  }, []);

  const canPlay = hasAnimation && animation !== 'unavailable';
  const playing = canPlay && (play ?? autoPlay);
  const showAnimation = playing && animation === 'ready';
  const showPoster = Boolean(image && !posterFailed);

  return (
    <div className={`detail-media ${variant === 'runner' ? 'run-media' : ''}`}>
      <div className="exercise-media-frame">
        {showPoster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={name} aria-hidden={showAnimation} onError={() => setPosterFailed(true)} />
        )}
        {playing && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={`exercise-animation${showAnimation ? ' visible' : ''}`} src={`/api/gif/${id}`}
            alt={`${name}动作演示`} aria-hidden={!showAnimation}
            onLoad={() => setAnimation('ready')} onError={() => setAnimation('unavailable')} />
        )}
        {!showPoster && !showAnimation && <p className="exercise-media-empty">{playing ? '正在加载演示…' : '暂无动作演示'}</p>}
      </div>
      {canPlay ? (
        <button className="exercise-media-toggle" type="button"
          aria-label={playing ? '停止动作演示' : '播放动作演示'}
          onClick={() => {
            if (!playing) setAnimation('loading');
            setPlay(!playing);
          }}>
          <JournalIcon name={playing ? 'pause' : 'play'} />
          {playing ? '暂停' : '播放'}
        </button>
      ) : showPoster && <span className="media-tag">静态示意</span>}
    </div>
  );
}
