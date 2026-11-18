'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { MuscleId } from '@/lib/muscles';

// The atlas PNGs encode muscle ID in red and the model's shading in green.
const muscleIds = [
  'chest_upper', 'chest_mid', 'chest_lower', 'serratus',
  'delt_front', 'delt_side', 'delt_rear', 'traps', 'lats', 'upperback', 'lowerback',
  'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'glutes', 'quads', 'hamstrings',
  'calves', 'adductors', 'neck',
] as const satisfies readonly MuscleId[];

const width = 420;
const fullHeight = 960;
const torsoHeight = 535;

export default function ReviewAnatomy({ side, fullBody, highlighted, selectable, onInspect }: {
  side: 'front' | 'back';
  fullBody: boolean;
  highlighted: MuscleId[];
  selectable: MuscleId[];
  onInspect: (muscle: MuscleId) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [atlas, setAtlas] = useState<{ side: typeof side; pixels: ImageData }>();
  const [failed, setFailed] = useState<typeof side>();
  const height = fullBody ? fullHeight : torsoHeight;
  const ready = atlas?.side === side;

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const source = document.createElement('canvas');
      source.width = width;
      source.height = fullHeight;
      const context = source.getContext('2d');
      if (!context) {
        setFailed(side);
        return;
      }
      context.drawImage(image, 0, 0);
      setAtlas({ side, pixels: context.getImageData(0, 0, width, fullHeight) });
    };
    image.onerror = () => { if (!cancelled) setFailed(side); };
    image.src = `/models/review-${side}.png`;
    return () => { cancelled = true; };
  }, [side]);

  const selectedIds = highlighted.map((muscle) => muscleIds.indexOf(muscle) + 1);
  const selectedKey = selectedIds.join(',');
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || atlas?.side !== side) return;
    const active = new Set(selectedKey.split(',').filter(Boolean).map(Number));
    const output = context.createImageData(width, height);
    const source = atlas.pixels.data;
    for (let index = 0; index < output.data.length; index += 4) {
      if (source[index + 3] === 0) continue;
      const shade = source[index + 1];
      if (active.has(source[index])) {
        output.data[index] = shade * 0.56 - 26;
        output.data[index + 1] = shade * 0.70 - 22;
        output.data[index + 2] = shade * 0.57 - 18;
      } else {
        output.data[index] = shade * 0.81 + 42;
        output.data[index + 1] = shade * 0.81 + 39;
        output.data[index + 2] = shade * 0.81 + 35;
      }
      const fade = !fullBody ? Math.min(1, (height - Math.floor(index / 4 / width)) / 33) : 1;
      output.data[index + 3] = 255 * fade;
    }
    context.putImageData(output, 0, 0);
  }, [atlas, side, height, fullBody, selectedKey]);

  function pick(event: PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * width / rect.width);
    const y = Math.floor((event.clientY - rect.top) * height / rect.height);
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const points = atlas.pixels.data;
    const offset = (y * width + x) * 4;
    const muscle = points[offset + 3] ? muscleIds[points[offset] - 1] : undefined;
    if (muscle && selectable.includes(muscle)) {
      onInspect(muscle);
    }
  }

  return <div className={`review-anatomy ${fullBody ? 'full' : ''}`}>
    <canvas ref={canvas} width={width} height={height} data-ready={ready}
      role="img" aria-label={side === 'back' ? '背面训练部位人体图' : '正面训练部位人体图'}
      onPointerUp={pick} />
    {!ready && <span className="review-anatomy-loading" role="status">{failed === side ? '人体图暂时无法载入' : '正在加载人体图…'}</span>}
  </div>;
}
