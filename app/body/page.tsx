import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import PlanBody from '@/components/fc/PlanBody';
import { activeTraining, getPlan, todayStr } from '@/lib/core/workout';
import { getTrainingModelSex } from '@/lib/core/training-profile';
import { sculptureVariant, type SculptureVariant } from '@/lib/sculpture-groups';

export const metadata = { title: '计划 · FitCheck' };
export const dynamic = 'force-dynamic';

export default async function BodyPage({ searchParams }: { searchParams: Promise<{ body?: string }> }) {
  const sp = await searchParams;
  const today = todayStr();
  const plan = getPlan(today);
  const active = activeTraining();
  const forced = sp.body === 'male' || sp.body === 'female' ? (sp.body as SculptureVariant) : null;
  const variant = forced ?? sculptureVariant(getTrainingModelSex());

  return (
    <JournalShell active="plan" title="点选肌群" today={today} className="is-plan"
      headerAction={<div className="journal-head-actions">
        <span className="journal-head-label">训练计划</span>
        <Link className="journal-head-circle" href="/train" aria-label={`今日计划，${plan.length} 个动作`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" /></svg>
          {plan.length > 0 && <b className="journal-head-badge">{plan.length}</b>}
        </Link>
      </div>}>
      <PlanBody key={today + variant} variant={variant} activeSession={active?.id ?? null}
        todayPlan={{ date: today, exerciseIds: plan.map((item) => item.exercise_id) }} />
    </JournalShell>
  );
}
