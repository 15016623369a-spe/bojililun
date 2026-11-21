import { redirect } from 'next/navigation';
import TrainingProfileForm from '@/components/TrainingProfileForm';
import JournalIcon from '@/components/JournalIcon';
import { needsTrainingSetup } from '@/lib/core/training-profile';
import { todayStr } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function SetupPage() {
  if (!needsTrainingSetup()) redirect('/');
  return <main className="journal-shell training-profile-onboarding">
    <header className="journal-brand"><JournalIcon name="brand" />FitCheck</header>
    <h1>建立训练档案</h1>
    <p className="journal-muted">设置默认模型和训练目标，之后可在「我的」修改。</p>
    <TrainingProfileForm mode="setup" today={todayStr()} />
  </main>;
}
