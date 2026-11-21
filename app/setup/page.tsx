import { redirect } from 'next/navigation';
import SetupFlow from '@/components/SetupFlow';
import { needsTrainingSetup } from '@/lib/core/training-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: '建立训练档案 · FitCheck' };

export default function SetupPage() {
  if (!needsTrainingSetup()) redirect('/');
  return <SetupFlow />;
}
