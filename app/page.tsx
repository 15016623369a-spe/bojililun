import DayPlan from '@/components/DayPlan';
import JournalShell from '@/components/JournalShell';
import RecordToday from '@/components/RecordToday';
import TrainingQueue from '@/components/TrainingQueue';
import { recordedJournalForDate } from '@/lib/core/journal';
import { activeTraining, getPlanProgress, todayStr } from '@/lib/core/workout';
import { humanDate } from '@/lib/date';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ workout?: string }> }) {
  const date = todayStr();
  const items = getPlanProgress(date);
  const activeId = activeTraining()?.id ?? null;
  const { workout } = await searchParams;
  return <JournalShell active="record" title="今天" subtitle={humanDate(date)} today={date}
    headerAction={<TrainingQueue key={date} items={items} activeId={activeId} />}>
    {items.length > 0 && <section className="day-panel">
      <h2 className="day-heading">今日训练计划 <span>{items.length} 个动作</span></h2>
      <DayPlan items={items} />
    </section>}
    <RecordToday date={date} entries={recordedJournalForDate(date)} workoutSaved={workout === 'saved'} />
  </JournalShell>;
}
