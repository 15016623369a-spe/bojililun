import JournalShell from '@/components/JournalShell';
import PendingPlan from '@/components/PendingPlan';
import RecordToday from '@/components/RecordToday';
import { recordedJournalForDate } from '@/lib/core/journal';
import { activeTraining, getPlanProgress, todayStr } from '@/lib/core/workout';
import { humanDate } from '@/lib/date';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ workout?: string }> }) {
  const date = todayStr();
  const items = getPlanProgress(date).filter((item) => !item.done);
  const activeId = activeTraining()?.id ?? null;
  const { workout } = await searchParams;
  const entries = recordedJournalForDate(date);
  const meals = entries.filter((entry) => entry.kind === 'meal' && !entry.payload?.planned).length;
  const workouts = entries.filter((entry) => entry.kind === 'training').length;
  return <JournalShell active="record" title="今天" subtitle={humanDate(date)} today={date}
    subtitleAside={`${meals} 餐 · ${workouts} 项训练`}>
    <PendingPlan key={date} items={items} activeId={activeId} />
    <RecordToday date={date} entries={entries} workoutSaved={workout === 'saved'} />
  </JournalShell>;
}
