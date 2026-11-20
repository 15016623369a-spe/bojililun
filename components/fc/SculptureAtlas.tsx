'use client';

import { useEffect, useState } from 'react';
import type { MuscleId } from '@/lib/muscles';
import ExerciseSheet, { type ExerciseChoice } from '@/components/fc/ExerciseSheet';
import SculptureBody from './SculptureBody';
import type { HeatItem } from './MuscleDict';
import { canonicalMuscle, SCULPTURE_GROUPS, sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';

export default function SculptureAtlas({
  heat,
  back: backProp,
  hideTabs = false,
  variant = 'male',
  onChooseExercise,
}: {
  heat: HeatItem[];
  back?: boolean;
  hideTabs?: boolean;
  variant?: SculptureVariant;
  onChooseExercise?: (exercise: ExerciseChoice) => void;
}) {
  const [selected, setSelected] = useState<MuscleId | null>(null);
  const [backState, setBack] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [body, setBody] = useState<SculptureVariant>(variant);
  useEffect(() => { setBody(variant); }, [variant]);
  const back = backProp ?? backState;
  const recorded = heat.map((h) => h.id as MuscleId);

  useEffect(() => {
    if (hideTabs) return;
    const group = sculptureGroup(new URLSearchParams(window.location.search).get('muscle'));
    if (group) { setSelected(group.id); setBack(group.side === 'back'); }
  }, [hideTabs]);

  return <>
    <div className="fc-dict-body">
      <SculptureBody
        key={body}
        variant={body}
        recorded={recorded}
        selected={selected}
        side={back ? 'back' : 'front'}
        spin={spinning}
        onPick={(id) => { setSpinning(false); setSelected((cur) => (cur === id ? null : canonicalMuscle(id))); }}
      />
      {!hideTabs && (
        <div className="fc-dict-tabs">
          <button type="button" className={!back ? 'on' : ''} onClick={() => { setBack(false); }}>正面</button>
          <button type="button" className={back ? 'on' : ''} onClick={() => { setBack(true); }}>背面</button>
          <button type="button" className={spinning ? 'on' : ''} onClick={() => setSpinning((v) => !v)}>自转</button>
          <span className="fc-dict-sep" aria-hidden>·</span>
          <button type="button" className={body === 'male' ? 'on' : ''} onClick={() => { setBody('male'); setSelected(null); }}>男</button>
          <button type="button" className={body === 'female' ? 'on' : ''} onClick={() => { setBody('female'); setSelected(null); }}>女</button>
        </div>
      )}
    </div>
    <p className="fc-dict-hintline">拖动旋转 · 点击肌肉查看对应训练动作</p>
    <ExerciseSheet muscle={selected} grouped onClose={() => setSelected(null)} onChooseExercise={onChooseExercise} />
  </>;
}
