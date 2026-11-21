import type { CSSProperties } from 'react';
import { muscleById, type MuscleId } from '@/lib/muscles';
import type { SculptureVariant } from '@/lib/sculpture-groups';

export type Marker = [id: MuscleId, edge: 'left' | 'right', labelY: number, x: number, y: number];

export const VIEWS: { side: 'front' | 'back'; label: string; markers: Marker[] }[] = [
  { side: 'front', label: '正面', markers: [
    ['neck', 'left', 8, 47, 15],
    ['chest_upper', 'left', 21, 43, 21],
    ['chest_mid', 'left', 34, 43, 24],
    ['chest_lower', 'left', 47, 44, 28],
    ['serratus', 'left', 60, 40, 32],
    ['obliques', 'left', 73, 42, 39],
    ['quads', 'left', 86, 42, 61],
    ['delt_front', 'right', 12, 64, 20],
    ['delt_side', 'right', 25, 67, 22],
    ['biceps', 'right', 39, 64, 31],
    ['forearms', 'right', 53, 68, 43],
    ['abs', 'right', 67, 51, 38],
    ['adductors', 'right', 81, 54, 61],
  ] },
  { side: 'back', label: '背面', markers: [
    ['traps', 'left', 12, 46, 19],
    ['upperback', 'left', 28, 46, 27],
    ['lats', 'left', 44, 42, 33],
    ['lowerback', 'left', 60, 48, 43],
    ['delt_rear', 'right', 17, 65, 22],
    ['triceps', 'right', 34, 65, 32],
    ['glutes', 'right', 51, 58, 51],
    ['hamstrings', 'right', 68, 58, 65],
    ['calves', 'right', 85, 56, 80],
  ] },
];

export const LABELS: Partial<Record<MuscleId, string>> = {
  delt_front: '肩前束',
  delt_side: '肩中束',
  delt_rear: '肩后束',
  abs: '腹直肌',
  glutes: '臀部',
};

export default function StatsBodyMap({ stats, variant }: {
  stats: ReadonlyMap<MuscleId, number>;
  variant: SculptureVariant;
}) {
  const assetFolder = variant === 'female' ? '/models/sculpture/female' : '/models/sculpture';
  return <div className="stats-body-views">
    {VIEWS.map(({ side, label, markers }) => (
      <figure className="stats-body-view" key={side}>
        <figcaption>{label}</figcaption>
        <div className="stats-body-diagram">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${assetFolder}/stats-${side}.png`} alt="" />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {markers.map(([id, edge, labelY, x, y]) => {
              const left = edge === 'left';
              return <g key={id} className={stats.has(id) ? 'has-sets' : undefined}>
                <path d={`M${left ? 26 : 74} ${labelY} H${left ? 30 : 70} L${x} ${y}`} />
                <ellipse cx={x} cy={y} rx="1" ry=".75" />
              </g>;
            })}
          </svg>
          <ul>
            {markers.map(([id, edge, labelY]) => {
              return <li key={id} data-edge={edge} data-trained={stats.has(id)}
                style={{ '--marker-y': `${labelY}%` } as CSSProperties}>
                <span>{LABELS[id] ?? muscleById(id)?.label}</span>
                <strong>{(stats.get(id) ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} <small>kg</small></strong>
              </li>;
            })}
          </ul>
        </div>
      </figure>
    ))}
  </div>;
}
