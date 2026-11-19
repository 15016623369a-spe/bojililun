'use client';

import { useMemo, useState } from 'react';
import map from '@/lib/body-map.json';
import { muscleById, type MuscleId } from '@/lib/muscles';
import ExerciseSheet from './ExerciseSheet';

export interface HeatItem {
  id: string;
  level: number;
}

const COLD: [number, number, number] = [207, 220, 201];
const HOT: [number, number, number] = [47, 107, 71];

function blend(level: number): string {
  const t = Math.max(0, Math.min(1, level));
  const c = COLD.map((v, i) => Math.round(v + (HOT[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

type Side = 'front' | 'back';

// 图集里同一张图会叠一点点另一面的肌肉（胸缝、腋下），只保留这一面真正该点的
const ALLOWED: Record<Side, string[]> = {
  front: [
    'chest_upper', 'chest_mid', 'chest_lower', 'serratus', 'delt_front', 'delt_side',
    'biceps', 'forearms', 'abs', 'obliques', 'quads', 'adductors', 'calves', 'neck',
  ],
  back: [
    'traps', 'upperback', 'lowerback', 'lats', 'delt_rear', 'delt_side',
    'triceps', 'forearms', 'glutes', 'hamstrings', 'calves', 'adductors', 'neck',
  ],
};

export default function BodyMap({ heat }: { heat: HeatItem[] }) {
  const [side, setSide] = useState<Side>('back');
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [hovered, setHovered] = useState<MuscleId | null>(null);

  const heatMap = useMemo(() => new Map(heat.map((h) => [h.id, h.level])), [heat]);
  const view = map[side];
  // 大块肌肉压在上面，细碎切片（<250px）直接丢掉，免得抢走点击/悬停
  const muscles = useMemo(
    () =>
      view.muscles
        .filter((m) => ALLOWED[side].includes(m.id) && m.px > 250)
        .sort((a, b) => a.px - b.px),
    [view, side],
  );
  const hoveredDef = hovered ? muscleById(hovered) : null;
  const lit = heat.length;

  const fillOf = (id: string) => {
    if (selected === id) return '#115133';
    if (hovered === id) return '#b7cbb2';
    const level = heatMap.get(id) ?? 0;
    return level > 0 ? blend(level) : '#EAE6DD';
  };

  return (
    <>
      <div className="fc-map">
        <div className="fc-map-tabs">
          <button type="button" className={side === 'front' ? 'on' : ''} onClick={() => setSide('front')}>
            正面
          </button>
          <button type="button" className={side === 'back' ? 'on' : ''} onClick={() => setSide('back')}>
            背面
          </button>
        </div>

        <svg
          className="fc-map-svg"
          viewBox={`0 0 ${map.width} ${map.height}`}
          role="img"
          aria-label={side === 'front' ? '正面肌肉图' : '背面肌肉图'}
        >
          <path d={view.outline} fill="#EFE9E0" stroke="#CFCBC2" strokeWidth={0.8} fillRule="evenodd" />
          {muscles.map((m) => (
            <path
              key={m.id}
              d={m.d}
              fill={fillOf(m.id)}
              stroke="#CFCBC2"
              strokeWidth={0.45}
              fillRule="evenodd"
              data-muscle={m.id}
              className="fc-map-muscle"
              onPointerEnter={() => setHovered(m.id as MuscleId)}
              onPointerLeave={() => setHovered((cur) => (cur === m.id ? null : cur))}
              onClick={() => setSelected(m.id as MuscleId)}
            />
          ))}
        </svg>

        <p className="fc-map-hint">
          {hoveredDef
            ? `${hoveredDef.region}·${hoveredDef.label}`
            : selected
              ? '点浮层里的动作，记入今天或加入计划'
              : !lit
                ? '点一块肌肉，看它的标准动作'
                : `今天点亮了 ${lit} 块肌肉 · 点一下看动作`}
        </p>
      </div>

      <ExerciseSheet muscle={selected} onClose={() => setSelected(null)} />
    </>
  );
}
