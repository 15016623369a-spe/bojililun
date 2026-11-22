import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import PlanBody from '@/components/fc/PlanBody';
import { getPlan, todayStr } from '@/lib/core/workout';
import { getBodyModelSettings } from '@/lib/core/body-model';

export const metadata = { title: '添加动作 · FitCheck' };
export const dynamic = 'force-dynamic';

export default async function BodyPage() {
  const today = todayStr();
  const plan = getPlan(today);
  const { preference, profileModel } = await getBodyModelSettings();

  return (
    <JournalShell active="plan" title="添加动作" today={today} className="is-plan"
      headerAction={<Link className="plan-return" href="/train">返回今日训练</Link>}>
      <PlanBody key={today} profileModel={profileModel} modelPreference={preference}
        todayPlan={{ date: today, exerciseIds: plan.map(({ exercise_id }) => exercise_id) }} />
    </JournalShell>
  );
}
