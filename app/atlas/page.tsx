import type { Metadata } from 'next';
import MuscleDict from '@/components/fc/MuscleDict';
import TabBar from '@/components/fc/TabBar';
import { LeafIcon } from '@/components/fc/icons';
import { todayMuscles } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '身体 · FitCheck',
};

export default function BodyPage() {
  const heat = todayMuscles();

  return (
    <div className="fc">
      <div className="fc-shell atlas">
        <header className="fc-atlas-hd">
          <div className="fc-brand">
            <LeafIcon />
            FitCheck
          </div>
          <h1 className="fc-h1">身体</h1>
        </header>

        <MuscleDict heat={heat} />
      </div>

      <div className="fc-dock">
        <div className="fc-dock-inner nav-only">
          <TabBar active="body" />
        </div>
      </div>
    </div>
  );
}
