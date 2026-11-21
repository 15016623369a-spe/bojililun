import { redirect } from 'next/navigation';
import JournalShell from '@/components/JournalShell';
import TrainingProfileDashboard from '@/components/TrainingProfileDashboard';
import Icon from '@/components/ui/Icon';
import { getProfileRow } from '@/lib/core/meals';
import { getExercisePreferences } from '@/lib/core/exercise-preferences';
import { getTrainingProfile } from '@/lib/core/training-profile';
import { todayStr } from '@/lib/core/workout';
import { listMemories } from '@/lib/memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: '我的 · FitCheck' };

export default function MePage() {
  const profile = getTrainingProfile();
  if (profile.needsSetup) redirect('/setup');
  const nutrition = getProfileRow();
  const restrictions = listMemories(true).filter(({ kind }) => kind === 'constraint');
  const prefs = [...getExercisePreferences().values()];

  return <JournalShell active="review" title="我的" back={{ href: '/history', label: '回顾' }} className="is-review is-me"
    headerAction={<div className="journal-head-actions">
      <span className="journal-head-label">我的</span>
      <span className="journal-head-circle ink" aria-hidden="true"><Icon name="user" size={18} /></span>
    </div>}
    hero={<span />}>
    <TrainingProfileDashboard profile={profile} restrictions={restrictions}
      nutrition={nutrition ? { ...nutrition } : null} today={todayStr()}
      preferences={{ liked: prefs.filter((p) => p === 'liked').length, disliked: prefs.filter((p) => p === 'disliked').length }} />
  </JournalShell>;
}
