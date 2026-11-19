'use client';

import { useState } from 'react';
import MuscleDict, { type HeatItem } from './MuscleDict';
import BodyMap from './BodyMap';

export default function PlanBody({ heat }: { heat: HeatItem[] }) {
  const [view, setView] = useState<'3d' | 'flat'>('3d');

  return (
    <div className="fc-plan-stage">
      <div className="fc-plan-view">
        <button type="button" className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>
          3D
        </button>
        <button type="button" className={view === 'flat' ? 'on' : ''} onClick={() => setView('flat')}>
          平面
        </button>
      </div>

      {view === '3d' ? (
        <div className="fc plan-embed">
          <MuscleDict heat={heat} showControls={false} />
        </div>
      ) : (
        <BodyMap heat={heat} />
      )}
    </div>
  );
}
