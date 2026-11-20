import type { Metadata } from 'next';
import SculptureAtlas from '@/components/fc/SculptureAtlas';
import TabBar from '@/components/fc/TabBar';
import { LeafIcon } from '@/components/fc/icons';
import { todayMuscles } from '@/lib/log';
import { getTrainingModelSex } from '@/lib/core/training-profile';
import { sculptureVariant, type SculptureVariant } from '@/lib/sculpture-groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '身体 · FitCheck',
};

export default async function BodyPage({ searchParams }: { searchParams: Promise<{ body?: string }> }) {
  const heat = todayMuscles();
  const sp = await searchParams;
  const forced = sp.body === 'male' || sp.body === 'female' ? (sp.body as SculptureVariant) : null;
  const variant = forced ?? sculptureVariant(getTrainingModelSex());

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

        <SculptureAtlas heat={heat} variant={variant} />
      </div>

      <div className="fc-dock">
        <div className="fc-dock-inner nav-only">
          <TabBar active="body" />
        </div>
      </div>
    </div>
  );
}
