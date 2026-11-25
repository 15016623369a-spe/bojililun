import JournalShell from '@/components/JournalShell';
import TabBar from '@/components/fc/TabBar';
import PlanPill from '@/components/PlanPill';
import PlanBody from '@/components/fc/PlanBody';
import { getPlan, liveTraining, todayStr } from '@/lib/core/workout';
import { getBodyModelSettings } from '@/lib/core/body-model';
import { parseBodyModel } from '@/lib/body-model-preference';
import { sculptureGroup } from '@/lib/sculpture-groups';

export const metadata = { title: '训练 · FitCheck' };
export const dynamic = 'force-dynamic';

export default async function BodyPage({ searchParams }: { searchParams: Promise<{ body?: string; muscle?: string }> }) {
  const sp = await searchParams;
  const today = todayStr();
  const plan = getPlan(today);
  const live = liveTraining();
  const active = live?.session ?? null;
  // 「默认 / 男 / 女」存在 cookie；旧链接带 ?body= 时以链接为准
  const { preference, profileModel } = await getBodyModelSettings();
  const forced = parseBodyModel(sp.body);
  const variant = forced ?? preference ?? profileModel;

  const initialMuscle = sculptureGroup(sp.muscle ?? '')?.id;

  return (
    <JournalShell active="plan" title="点选肌群" today={today} className="is-plan" navigation={<TabBar active="body" />}
      hero={<></>} headerAction={<PlanPill total={plan.length} done={plan.filter((item) => item.done === 1).length} live={Boolean(active)} />}>
      <PlanBody key={today + (initialMuscle ?? '')} variant={variant} profileModel={profileModel} modelChoice={forced ?? preference} initialMuscle={initialMuscle} activeSession={active?.id ?? null} activeMeta={live ? `${live.next.name} · 剩 ${live.next.setsLeft} 组` : undefined}
        todayPlan={{ date: today, exerciseIds: plan.map((item) => item.exercise_id), allDone: plan.length > 0 && plan.every((item) => item.done === 1) }} />
    </JournalShell>
  );
}
