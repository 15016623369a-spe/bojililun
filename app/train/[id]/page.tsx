import { notFound } from 'next/navigation';
import TrainingRunner from '@/components/TrainingRunner';
import { getPlan, getSession, todayStr } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function TrainSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sid = Number(id);
  const session = Number.isFinite(sid) ? getSession(sid) : null;
  if (!session) notFound();

  const plan = getPlan(session.date);
  return <TrainingRunner session={session} plan={plan} today={session.date || todayStr()} />;
}
