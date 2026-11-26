import { notFound } from 'next/navigation';
import { getExercise } from '@/lib/exercise';
import { imageUrl } from '@/lib/exercise-label';
import { sculptureMediaUrls } from '@/lib/exercise-anim';
import TrainingRunner from '@/components/TrainingRunner';
import { getTrainingBodyModel } from '@/lib/core/body-model';
import { exercisePerformance, getSession, getSessionSets, sessionPlan, todayStr } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function TrainSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const sid = Number(id);
  const session = Number.isSafeInteger(sid) ? getSession(sid) : null;
  if (!session) notFound();

  const plan = sessionPlan(session);
  const parsedItem = Number(sp.item);
  const initialItemId = Number.isInteger(parsedItem) && plan.some((entry) => entry.id === parsedItem) ? parsedItem : null;
  const demonstrations = Object.fromEntries([...new Set(plan.map((item) => item.exercise_id))].map((exerciseId) => {
    const exercise = getExercise(exerciseId);
    return [exerciseId, {
      image: exercise?.image ? imageUrl(exercise.image) : undefined,
      hasAnimation: Boolean(exercise?.gif_url),
      ...sculptureMediaUrls(exerciseId),
    }];
  }));
  // 本节以前的最高估算 1RM，用来在完成小结里标出新纪录
  const planned = new Set(plan.map((item) => item.exercise_id));
  const priorBest = Object.fromEntries(exercisePerformance('0000-01-01', session.date)
    .filter((exercise) => planned.has(exercise.id))
    .map((exercise) => [exercise.id, Math.max(0, ...exercise.sessions.filter((s) => s.id !== sid && s.pr).map((s) => s.pr!.value))]));
  return <TrainingRunner session={session} plan={plan} initialSets={getSessionSets(sid)} demonstrations={demonstrations} priorBest={priorBest} variant={getTrainingBodyModel()}
    initialItemId={initialItemId}
    receiptHref={session.date === todayStr() ? '/train' : `/history/${session.date}`} />;
}
