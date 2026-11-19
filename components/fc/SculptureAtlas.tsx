'use client';

import { useState } from 'react';
import type { MuscleId } from '@/lib/muscles';
import ExerciseSheet from '@/components/fc/ExerciseSheet';
import SculptureBody from './SculptureBody';
import type { HeatItem } from './MuscleDict';

export default function SculptureAtlas({
  heat,
  back: backProp,
  hideTabs = false,
}: {
  heat: HeatItem[];
  back?: boolean;
  hideTabs?: boolean;
}) {
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [backState, setBack] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const back = backProp ?? backState;
  const recorded = heat.map((h) => h.id as MuscleId);

  return <>
    <div className="fc-dict-body">
      <SculptureBody
        recorded={recorded}
        selected={selected}
        side={back ? 'back' : 'front'}
        spin={spinning}
        onPick={(id) => setSelected((cur) => (cur === id ? null : id))}
      />
      {!hideTabs && (
        <div className="fc-dict-tabs">
          <button type="button" className={!back ? 'on' : ''} onClick={() => { setBack(false); }}>正面</button>
          <button type="button" className={back ? 'on' : ''} onClick={() => { setBack(true); }}>背面</button>
          <button type="button" className={spinning ? 'on' : ''} onClick={() => setSpinning((v) => !v)}>自转</button>
        </div>
      )}
    </div>
    <p className="fc-dict-hintline">拖动旋转 · 点击肌肉查看对应训练动作</p>
    <ExerciseSheet muscle={selected} onClose={() => setSelected(null)} />
  </>;
}
