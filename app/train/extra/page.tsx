import JournalShell from '@/components/JournalShell';
import SupplementalWorkout from '@/components/SupplementalWorkout';
import { getProfileRow } from '@/lib/core/meals';
import { sculptureVariant } from '@/lib/sculpture-groups';

export const metadata = { title: '加练 · FitCheck' };
export const dynamic = 'force-dynamic';

export default function SupplementalWorkoutPage() {
  return <JournalShell active="record" title="加练" back={{ href: '/', label: '记录' }}>
    <SupplementalWorkout variant={sculptureVariant(getProfileRow()?.sex)} />
  </JournalShell>;
}
