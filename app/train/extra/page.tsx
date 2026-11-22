import JournalShell from '@/components/JournalShell';
import PlanBody from '@/components/fc/PlanBody';
import PlanPill from '@/components/PlanPill';
import TabBar from '@/components/fc/TabBar';
import { activeTraining, getPlan, todayStr } from '@/lib/core/workout';
import { getTrainingModelSex } from '@/lib/core/training-profile';
import { sculptureVariant } from '@/lib/sculpture-groups';

export const metadata = { title: '加练 · FitCheck' };
export const dynamic = 'force-dynamic';

/** 加练和计划首屏同一套流程：点阵人体 → 姿势与毛玻璃抽屉 → 挑动作，挑好的动作作为加练项回到今日计划开练 */
export default function SupplementalWorkoutPage() {
  const today = todayStr();
  const plan = getPlan(today);
  const active = activeTraining();
  const variant = sculptureVariant(getTrainingModelSex());
  return <JournalShell active="plan" title="加练" today={today} className="is-plan is-extra" navigation={<TabBar active="body" />}
    back={{ href: '/train', label: '今日计划' }}
    hero={<></>} headerAction={<PlanPill total={plan.length} done={plan.filter((item) => item.done === 1).length} live={Boolean(active)} />}>
    <PlanBody key={today + variant} mode="extra" variant={variant} activeSession={active?.id ?? null}
      todayPlan={{ date: today, exerciseIds: plan.filter((item) => item.done !== 1).map((item) => item.exercise_id) }} />
  </JournalShell>;
}
