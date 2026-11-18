import { notFound } from 'next/navigation';
import { getExercise } from '@/lib/exercise';
import { imageUrl } from '@/lib/exercise-label';
import TrainingRunner from '@/components/TrainingRunner';
import { getSession, getSessionSets, sessionPlan } from '@/lib/core/workout';

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
  return <TrainingRunner session={session} plan={plan} initialSets={getSessionSets(sid)} demonstrations={demonstrations} />;
}
