'use client';

import { useState } from 'react';
import SculptureAtlas from './SculptureAtlas';
import type { HeatItem } from './MuscleDict';
import BodyMap from './BodyMap';

export default function PlanBody({ heat }: { heat: HeatItem[] }) {
  const [view, setView] = useState<'3d' | 'flat'>('3d');
  const [back, setBack] = useState(false);

  return (
    <div className="fc-plan-stage">
      <div className="fc-plan-view">
        <button type="button" className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>
          3D
        </button>
        <button type="button" className={view === 'flat' ? 'on' : ''} onClick={() => setView('flat')}>
          平面
        </button>
        {view === '3d' && (
          <>
            <span className="fc-plan-sep" aria-hidden>·</span>
            <button type="button" className={!back ? 'on' : ''} onClick={() => setBack(false)}>
              正面
            </button>
            <button type="button" className={back ? 'on' : ''} onClick={() => setBack(true)}>
              背面
            </button>
          </>
        )}
      </div>

      {view === '3d' ? (
        <div className="fc plan-embed">
          <SculptureAtlas heat={heat} back={back} hideTabs />
        </div>
      ) : (
        <BodyMap heat={heat} />
      )}
    </div>
  );
}
