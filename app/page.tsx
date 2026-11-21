import Link from 'next/link';
import { redirect } from 'next/navigation';
import { needsTrainingSetup } from '@/lib/core/training-profile';
import JournalShell from '@/components/JournalShell';
import PendingPlan from '@/components/PendingPlan';
import RecordToday from '@/components/RecordToday';
import BigDate from '@/components/ui/BigDate';
import Icon from '@/components/ui/Icon';
import { recordedJournalForDate } from '@/lib/core/journal';
import { activeTraining, getPlanProgress, todayStr } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ workout?: string }> }) {
  if (needsTrainingSetup()) redirect('/setup');
  const date = todayStr();
  const items = getPlanProgress(date).filter((item) => !item.done);
  const activeId = activeTraining()?.id ?? null;
  const { workout } = await searchParams;
  const entries = recordedJournalForDate(date);
  const meals = entries.filter((entry) => entry.kind === 'meal' && !entry.payload?.planned).length;
  const workouts = entries.filter((entry) => entry.kind === 'training').length;
  return <JournalShell active="record" title="今天" today={date} className="is-record"
    headerAction={<div className="journal-head-actions">
      <span className="journal-head-label">记录</span>
      <Link className="journal-head-circle" href={`/history/${date}`} aria-label="今天的详细记录">
        <Icon name="list" size={18} stroke={1.9} />
      </Link>
    </div>}
    hero={<>
      <p className="hero-word" aria-hidden="true">今天</p>
      <BigDate date={date} note={`${meals} 餐 · ${workouts} 项训练`} />
    </>}>
    <RecordToday date={date} entries={entries} workoutSaved={workout === 'saved'} />
    <PendingPlan key={date} items={items} activeId={activeId} />
  </JournalShell>;
}
