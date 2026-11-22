import JournalShell from '@/components/JournalShell';
import SupplementalWorkout from '@/components/SupplementalWorkout';
import { getTrainingBodyModel } from '@/lib/core/body-model';

export const metadata = { title: '加练 · FitCheck' };
export const dynamic = 'force-dynamic';

export default async function SupplementalWorkoutPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const fromTraining = (await searchParams).from === 'train';
  return <JournalShell active={fromTraining ? 'plan' : 'record'} title="加练"
    back={fromTraining ? { href: '/train', label: '今日训练' } : { href: '/log', label: '记录' }} className="is-train is-extra"
    hero={<div className="extra-hero"><p className="hero-word" aria-hidden="true">加练</p><p>今天的计划练完了，再挑几个动作。</p></div>}>
    <SupplementalWorkout variant={getTrainingBodyModel()} />
  </JournalShell>;
}
