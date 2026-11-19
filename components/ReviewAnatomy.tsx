'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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

// 1 倍 = 原来的半身取景；继续捏小能退到整身（含脚），最多放大 4 倍。
const MAX_SCALE = 4;
const MIN_MARGIN = 16;
const TAP_SLOP = 8;
const EPSILON = 0.001;

type Box = { width: number; height: number };
type View = { scale: number; x: number; y: number };
const RESET: View = { scale: 1, x: 0, y: 0 };

const isOff = (scale: number) => Math.abs(scale - 1) > EPSILON;

// 最小倍数 = 让整身刚好装进取景框（上下各留一点边），所以捏到头一定看得到脚。
function scaleRange(box: Box, content: Box) {
  const fit = Math.min(1, (box.height - MIN_MARGIN) / content.height);
  return { min: Math.max(0.2, fit), max: MAX_SCALE };
}

// 比取景框大就只能在图内平移，比取景框小就居中，身体不会被拖出画面。
function clampView({ scale, x, y }: View, box: Box, content: Box): View {
  const { min, max } = scaleRange(box, content);
  const next = Math.min(max, Math.max(min, scale));
  const roomX = box.width - content.width * next;
  const roomY = box.height - content.height * next;
  return {
    scale: next,
    x: roomX >= 0 ? roomX / 2 : Math.min(0, Math.max(roomX, x)),
    y: roomY >= 0 ? roomY / 2 : Math.min(0, Math.max(roomY, y)),
  };
}

export default function ReviewAnatomy({ side, fullBody, highlighted, selectable, onInspect }: {
  side: 'front' | 'back';
  fullBody: boolean;
  highlighted: MuscleId[];
  selectable: MuscleId[];
  onInspect: (muscle: MuscleId) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef<View>(RESET);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; midX: number; midY: number } | null>(null);
  const drag = useRef<{ x: number; y: number; from: View } | null>(null);
  const tap = useRef<{ x: number; y: number; at: number } | null>(null);
  const moved = useRef(false);
  const [atlas, setAtlas] = useState<{ side: typeof side; pixels: ImageData }>();
  const [failed, setFailed] = useState<typeof side>();
  const [zoomed, setZoomed] = useState(false);
  const [pannable, setPannable] = useState(false);
  const ready = atlas?.side === side;

  // 缩放只改 canvas 的 transform，位图不用重绘，点击坐标靠 rect 反算依然准确。
  const paint = useCallback((next: View) => {
    const node = canvas.current;
    const box = stage.current;
    if (!node || !box) return;
    const sized = clampView(
      next,
      { width: box.clientWidth, height: box.clientHeight },
      { width: node.offsetWidth, height: node.offsetHeight },
    );
    const shown = isOff(sized.scale) ? sized : RESET;
    view.current = shown;
    node.style.transform = isOff(shown.scale)
      ? `translate3d(${shown.x}px, ${shown.y}px, 0) scale(${shown.scale})`
      : '';
    setZoomed(isOff(shown.scale));
    // 缩小到整身时图比取景框还小，就不用抢手势，页面照常滚动。
    setPannable(
      isOff(shown.scale)
      && (node.offsetWidth * shown.scale > box.clientWidth + 1 || node.offsetHeight * shown.scale > box.clientHeight + 1),
    );
  }, []);

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
    const output = context.createImageData(width, fullHeight);
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
      output.data[index + 3] = 255;
    }
    context.putImageData(output, 0, 0);
  }, [atlas, side, selectedKey]);

  // 正背面切换、整身/半身切换后，旧的缩放偏移可能越界，重新夹一下。
  useEffect(() => {
    paint(view.current);
  }, [paint, fullBody]);

  // 双指按下时阻止页面滚动；单指仍然按 pan-y 正常滚页面。
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const stop = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    node.addEventListener('touchstart', stop, { passive: false });
    node.addEventListener('touchmove', stop, { passive: false });
    return () => {
      node.removeEventListener('touchstart', stop);
      node.removeEventListener('touchmove', stop);
    };
  }, []);

  // 触控板双指捏合（ctrl + wheel）直接缩放；已经放大时滚轮也用来缩放。
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      const current = view.current;
      if (!event.ctrlKey && current.scale === 1) return;
      event.preventDefault();
      const box = stage.current?.getBoundingClientRect();
      if (!box) return;
      const { min, max } = limits();
      const scale = Math.min(max, Math.max(min, current.scale * Math.exp(-event.deltaY * 0.0025)));
      if (scale === current.scale) return;
      const anchorX = (event.clientX - box.left - current.x) / current.scale;
      const anchorY = (event.clientY - box.top - current.y) / current.scale;
      paint({
        scale,
        x: event.clientX - box.left - anchorX * scale,
        y: event.clientY - box.top - anchorY * scale,
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [paint]);

  function limits() {
    const node = canvas.current;
    const box = stage.current;
    if (!node || !box) return { min: 1, max: MAX_SCALE };
    return scaleRange(
      { width: box.clientWidth, height: box.clientHeight },
      { width: node.offsetWidth, height: node.offsetHeight },
    );
  }

  // 图比取景框大才有得平移；缩到整身时让页面自己滚。
  function canPan(scale: number) {
    const node = canvas.current;
    const box = stage.current;
    if (!node || !box || !isOff(scale)) return false;
    return node.offsetWidth * scale > box.clientWidth + 1 || node.offsetHeight * scale > box.clientHeight + 1;
  }

  // 手势挂在外层整行上：模型只有 254px 宽，两根手指不一定都落在 canvas 上。
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const node = event.currentTarget;
    if (canvas.current) canvas.current.style.transition = '';
    node.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      moved.current = false;
      tap.current = { x: event.clientX, y: event.clientY, at: performance.now() };
      drag.current = canPan(view.current.scale) ? { x: event.clientX, y: event.clientY, from: view.current } : null;
      return;
    }
    moved.current = true;
    drag.current = null;
    const [a, b] = [...pointers.current.values()];
    pinch.current = {
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // 位移基准是未缩放的模型框，后面所有换算都以它为准。
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const current = view.current;
      const { min, max } = limits();
      const scale = Math.min(max, Math.max(min, current.scale * distance / pinch.current.distance));
      // 捏合中心下的那一点保持不动，缩放才跟手。
      const anchorX = (pinch.current.midX - box.left - current.x) / current.scale;
      const anchorY = (pinch.current.midY - box.top - current.y) / current.scale;
      paint({ scale, x: midX - box.left - anchorX * scale, y: midY - box.top - anchorY * scale });
      pinch.current = { distance, midX, midY };
      return;
    }

    if (pointers.current.size === 1 && drag.current) {
      const dx = event.clientX - drag.current.x;
      const dy = event.clientY - drag.current.y;
      if (Math.hypot(dx, dy) > TAP_SLOP) moved.current = true;
      paint({ ...drag.current.from, x: drag.current.from.x + dx, y: drag.current.from.y + dy });
    }
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const released = tap.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      // 捏合后留下一根手指，接着滑就是平移，不要跳一下。
      const [only] = [...pointers.current.values()];
      drag.current = canPan(view.current.scale) ? { x: only.x, y: only.y, from: view.current } : null;
      return;
    }
    drag.current = null;
    tap.current = null;
    if (released && !moved.current && performance.now() - released.at < 800) pick(event);
  }

  function cancel(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      drag.current = null;
      tap.current = null;
    }
  }

  function reset() {
    const node = canvas.current;
    if (!node) return;
    node.style.transition = 'transform 180ms ease-out';
    paint(RESET);
    window.setTimeout(() => { node.style.transition = ''; }, 200);
  }

  function pick(event: ReactPointerEvent<HTMLDivElement>) {
    const node = canvas.current;
    if (!ready || !node) return;
    const rect = node.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * width / rect.width);
    const y = Math.floor((event.clientY - rect.top) * fullHeight / rect.height);
    if (x < 0 || x >= width || y < 0 || y >= fullHeight) return;
    const points = atlas.pixels.data;
    const offset = (y * width + x) * 4;
    const muscle = points[offset + 3] ? muscleIds[points[offset] - 1] : undefined;
    if (muscle && selectable.includes(muscle)) {
      onInspect(muscle);
    }
  }

  return <div className={`review-anatomy${fullBody ? ' full' : ''}${zoomed ? ' zoomed' : ''}`} ref={frame}
    style={{ touchAction: pannable ? 'none' : undefined }}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
    <div className="review-anatomy-stage" ref={stage}>
      <canvas ref={canvas} width={width} height={fullHeight} data-ready={ready}
        role="img"
        aria-label={`${side === 'back' ? '背面' : '正面'}训练部位人体图，可双指缩放查看`} />
      {zoomed && <button type="button" className="review-zoom-reset" onClick={reset}>复位</button>}
      {!ready && <span className="review-anatomy-loading" role="status">{failed === side ? '人体图暂时无法载入' : '正在加载人体图…'}</span>}
    </div>
  </div>;
}
