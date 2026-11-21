import JournalShell from '@/components/JournalShell';
import SupplementalWorkout from '@/components/SupplementalWorkout';
import { getTrainingModelSex } from '@/lib/core/training-profile';
import { sculptureVariant } from '@/lib/sculpture-groups';

export const metadata = { title: '加练 · FitCheck' };
export const dynamic = 'force-dynamic';

export default function SupplementalWorkoutPage() {
  return <JournalShell active="record" title="加练" back={{ href: '/', label: '记录' }} className="is-train is-extra"
    hero={<div className="extra-hero"><p className="hero-word" aria-hidden="true">加练</p><p>今天的计划练完了，再挑几个动作。</p></div>}>
    <SupplementalWorkout variant={sculptureVariant(getTrainingModelSex())} />
  </JournalShell>;
}
