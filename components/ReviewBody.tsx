'use client';

import SculptureBody from '@/components/fc/SculptureBody';
import type { MuscleId } from '@/lib/muscles';
import type { SculptureVariant } from '@/lib/sculpture-groups';

/** 回顾页的 3D 人体：拖动旋转、双指缩放；热图按频次（雾蓝）或容量（珊瑚）着色，点一下选中肌群 */
export default function ReviewBody({ recorded, selected, initialSide, onInspect, variant = 'male', heatLevels, heatTint }: {
  recorded: MuscleId[];
  selected: MuscleId | null;
  initialSide: 'front' | 'back';
  onInspect: (muscle: MuscleId) => void;
  variant?: SculptureVariant;
  heatLevels?: ReadonlyMap<MuscleId, number>;
  heatTint?: string;
}) {
  return (
    <div className="review-body">
      <SculptureBody
        recorded={recorded}
        heatLevels={heatLevels}
        heatTint={heatTint}
        selected={selected}
        side={initialSide}
        variant={variant}
        onPick={onInspect}
      />
    </div>
  );
}
