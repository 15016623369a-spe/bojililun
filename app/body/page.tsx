import JournalShell from '@/components/JournalShell';
import TabBar from '@/components/fc/TabBar';
import PlanPill from '@/components/PlanPill';
import PlanBody from '@/components/fc/PlanBody';
import { activeTraining, getPlan, todayStr } from '@/lib/core/workout';
import { getTrainingModelSex } from '@/lib/core/training-profile';
import { sculptureGroup, sculptureVariant, type SculptureVariant } from '@/lib/sculpture-groups';

export const metadata = { title: '计划 · FitCheck' };
export const dynamic = 'force-dynamic';

export default async function BodyPage({ searchParams }: { searchParams: Promise<{ body?: string; muscle?: string }> }) {
  const sp = await searchParams;
  const today = todayStr();
  const plan = getPlan(today);
  const active = activeTraining();
  const forced = sp.body === 'male' || sp.body === 'female' ? (sp.body as SculptureVariant) : null;
  const variant = forced ?? sculptureVariant(getTrainingModelSex());

  const initialMuscle = sculptureGroup(sp.muscle ?? '')?.id;

  return (
    <JournalShell active="plan" title="点选肌群" today={today} className="is-plan" navigation={<TabBar active="body" />}
      hero={<></>} headerAction={<PlanPill total={plan.length} done={plan.filter((item) => item.done === 1).length} live={Boolean(active)} />}>
      <PlanBody key={today + variant + (initialMuscle ?? '')} variant={variant} initialMuscle={initialMuscle} activeSession={active?.id ?? null}
        todayPlan={{ date: today, exerciseIds: plan.map((item) => item.exercise_id), allDone: plan.length > 0 && plan.every((item) => item.done === 1) }} />
    </JournalShell>
  );
}
