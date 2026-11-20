import JournalShell from '@/components/JournalShell';
import ExercisePreferences from '@/components/ExercisePreferences';

export const metadata = { title: '动作偏好 · FitCheck' };

export default function ExercisePreferencesPage() {
  return <JournalShell active="review" title="动作偏好" back={{ href: '/me', label: '我的' }}>
    <ExercisePreferences />
  </JournalShell>;
}
