import { redirect } from 'next/navigation';
import JournalShell from '@/components/JournalShell';
import TrainingProfileDashboard from '@/components/TrainingProfileDashboard';
import { getProfileRow } from '@/lib/core/meals';
import { getTrainingProfile } from '@/lib/core/training-profile';
import { todayStr } from '@/lib/core/workout';
import { listMemories } from '@/lib/memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function MePage() {
  const profile = getTrainingProfile();
  if (profile.needsSetup) redirect('/setup');
  const nutrition = getProfileRow();
  const restrictions = listMemories(true).filter(({ kind }) => kind === 'constraint');

  return <JournalShell active="review" title="我的" back={{ href: '/history', label: '回顾' }}>
    <TrainingProfileDashboard profile={profile} restrictions={restrictions}
      nutrition={nutrition ? { ...nutrition } : null} today={todayStr()} />
  </JournalShell>;
}
