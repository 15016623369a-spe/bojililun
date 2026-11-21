import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import PlanBody from '@/components/fc/PlanBody';
import { planMuscles } from '@/lib/core/journal';
import { getPlan, todayStr } from '@/lib/core/workout';
import { getTrainingModelSex } from '@/lib/core/training-profile';
import { sculptureVariant, type SculptureVariant } from '@/lib/sculpture-groups';

export const metadata = { title: '计划 · FitCheck' };
export const dynamic = 'force-dynamic';

export default async function BodyPage({ searchParams }: { searchParams: Promise<{ body?: string }> }) {
  const sp = await searchParams;
  const today = todayStr();
  const plan = getPlan(today);
  const heat = planMuscles(plan).map((id) => ({ id, level: 1 }));
  const forced = sp.body === 'male' || sp.body === 'female' ? (sp.body as SculptureVariant) : null;
  const variant = forced ?? sculptureVariant(getTrainingModelSex());

  return (
    <JournalShell active="plan" title="计划" subtitle="点选肌肉，为今天安排动作。" today={today}>
      <div className="fc plan-embed">
        <PlanBody key={today + variant} heat={heat} variant={variant}
          todayPlan={{ date: today, exerciseIds: plan.map((item) => item.exercise_id) }} />
      </div>
      <div className="journal-links">
        <Link href="/exercises">全部动作</Link>
        <Link href="/train">编辑今日计划</Link>
      </div>
    </JournalShell>
  );
}
