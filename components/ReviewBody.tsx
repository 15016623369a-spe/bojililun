'use client';

import SculptureBody from '@/components/fc/SculptureBody';
import type { MuscleId } from '@/lib/muscles';

/** 回顾页的 3D 人体：拖动旋转、双指缩放，记录过的部位染绿，点一下筛选时间线 */
export default function ReviewBody({ recorded, selected, initialSide, onInspect }: {
  recorded: MuscleId[];
  selected: MuscleId | null;
  initialSide: 'front' | 'back';
  onInspect: (muscle: MuscleId) => void;
}) {
  return (
    <div className="review-body">
      <SculptureBody
        recorded={recorded}
        selected={selected}
        side={initialSide}
        onPick={onInspect}
      />
    </div>
  );
}
