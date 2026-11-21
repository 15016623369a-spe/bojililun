import { notFound } from 'next/navigation';
import { getExercise } from '@/lib/exercise';
import { imageUrl } from '@/lib/exercise-label';
import TrainingRunner from '@/components/TrainingRunner';
import { exercisePerformance, getSession, getSessionSets, sessionPlan } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function TrainSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sid = Number(id);
  const session = Number.isSafeInteger(sid) ? getSession(sid) : null;
  if (!session) notFound();

  const plan = sessionPlan(session);
  const demonstrations = Object.fromEntries([...new Set(plan.map((item) => item.exercise_id))].map((exerciseId) => {
    const exercise = getExercise(exerciseId);
    return [exerciseId, {
      image: exercise?.image ? imageUrl(exercise.image) : undefined,
      hasAnimation: Boolean(exercise?.gif_url),
    }];
  }));
  // 本节以前的最高估算 1RM，用来在完成小结里标出新纪录
  const planned = new Set(plan.map((item) => item.exercise_id));
  const priorBest = Object.fromEntries(exercisePerformance('0000-01-01', session.date)
    .filter((exercise) => planned.has(exercise.id))
    .map((exercise) => [exercise.id, Math.max(0, ...exercise.sessions.filter((s) => s.id !== sid && s.pr).map((s) => s.pr!.value))]));
  return <TrainingRunner session={session} plan={plan} initialSets={getSessionSets(sid)} demonstrations={demonstrations} priorBest={priorBest} />;
}
