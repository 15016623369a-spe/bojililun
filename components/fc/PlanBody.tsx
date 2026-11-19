'use client';

import { useState } from 'react';
import SculptureAtlas from './SculptureAtlas';
import type { HeatItem } from './MuscleDict';

export default function PlanBody({ heat }: { heat: HeatItem[] }) {
  const [back, setBack] = useState(false);

  return (
    <div className="fc-plan-stage">
      <div className="fc-plan-view">
        <button type="button" className={!back ? 'on' : ''} onClick={() => setBack(false)}>
          正面
        </button>
        <button type="button" className={back ? 'on' : ''} onClick={() => setBack(true)}>
          背面
        </button>
      </div>

      <div className="fc plan-embed">
        <SculptureAtlas heat={heat} back={back} hideTabs />
      </div>
    </div>
  );
}
