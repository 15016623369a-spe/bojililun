'use client';

import { useState } from 'react';
import SculptureAtlas from './SculptureAtlas';
import type { HeatItem } from './MuscleDict';
import type { SculptureVariant } from '@/lib/sculpture-groups';

export default function PlanBody({ heat, variant = 'male' }: { heat: HeatItem[]; variant?: SculptureVariant }) {
  const [back, setBack] = useState(false);
  const [body, setBody] = useState<SculptureVariant>(variant);

  return (
    <div className="fc-plan-stage">
      <div className="fc-plan-view">
        <button type="button" className={!back ? 'on' : ''} onClick={() => setBack(false)}>
          正面
        </button>
        <button type="button" className={back ? 'on' : ''} onClick={() => setBack(true)}>
          背面
        </button>
        <span className="fc-plan-sep" aria-hidden>·</span>
        <button type="button" className={body === 'male' ? 'on' : ''} onClick={() => setBody('male')}>
          男
        </button>
        <button type="button" className={body === 'female' ? 'on' : ''} onClick={() => setBody('female')}>
          女
        </button>
      </div>

      <div className="fc plan-embed">
        <SculptureAtlas heat={heat} back={back} hideTabs variant={body} />
      </div>
    </div>
  );
}
