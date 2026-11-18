import JournalShell from '@/components/JournalShell';
import RecordToday from '@/components/RecordToday';
import { journalForDate } from '@/lib/core/journal';
import { todayStr } from '@/lib/core/workout';
import { humanDate } from '@/lib/date';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ workout?: string }> }) {
  const date = todayStr();
  const { workout } = await searchParams;
  return <JournalShell active="record" title="今天" subtitle={humanDate(date)}>
    <RecordToday date={date} entries={journalForDate(date)} workoutSaved={workout === 'saved'} />
  </JournalShell>;
}
