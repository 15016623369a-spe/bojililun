import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import WorkoutTimeline from '@/components/WorkoutTimeline';
import { weekdayOf } from '@/components/ui/BigDate';
import { liveTraining, daySessions, exercisePerformance, getPlan, getSessionSets, sessionPlan, todayStr } from '@/lib/core/workout';
import { journalForDate } from '@/lib/core/journal';
import { hasRecordedData } from '@/lib/journal';
import { getExercise } from '@/lib/exercise';
import { imageUrl } from '@/lib/exercise-label';
import { sculptureMediaUrls } from '@/lib/exercise-anim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: '今日训练 · FitCheck' };

export default function TrainPage() {
  const today = todayStr();
  const activeSession = liveTraining()?.session ?? null;
  const plan = activeSession ? sessionPlan(activeSession) : getPlan(today);
  const activeSets = activeSession ? getSessionSets(activeSession.id) : [];
  const details = daySessions(today);

  const quickEntries = journalForDate(today).filter((entry) => entry.quickId !== undefined);
  const quickWorkouts = quickEntries.filter((entry) => entry.kind === 'training');
  const listedQuickWorkouts = details.length > 0
    ? quickWorkouts.filter((entry) => (entry.payload?.exercises ?? []).some(hasRecordedData))
    : quickWorkouts;

  const exIds = [...new Set([...plan.map((p) => p.exercise_id), ...activeSets.map((s) => s.exercise_id)])];
  const demonstrations = Object.fromEntries(exIds.map((exerciseId) => {
    const exercise = getExercise(exerciseId);
    return [exerciseId, {
      image: exercise?.image ? imageUrl(exercise.image) : undefined,
      hasAnimation: Boolean(exercise?.gif_url),
      ...sculptureMediaUrls(exerciseId),
    }];
  }));

  const planned = new Set(exIds);
  const priorBest = Object.fromEntries(
    exercisePerformance('0000-01-01', today)
      .filter((exercise) => planned.has(exercise.id))
      .map((exercise) => [
        exercise.id,
        Math.max(0, ...exercise.sessions.filter((s) => s.id !== activeSession?.id && s.pr).map((s) => s.pr!.value)),
      ]),
  );

  return (
    <JournalShell
      active="plan"
      title="今日训练"
      today={today}
      className="is-train"
      headerAction={
        <div className="journal-head-actions">
          <time className="journal-head-label train-head-date" dateTime={today}>
            {today.slice(5).replace('-', '.')} {weekdayOf(today)}
          </time>
          <Link className="journal-head-circle" href="/body" prefetch={true} aria-label="按部位挑动作">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="5" r="2.2" />
              <path d="M7 9.5h10M12 9.5v5m0 0-3 6m3-6 3 6" />
            </svg>
          </Link>
        </div>
      }
      hero={<></>}
    >
      <WorkoutTimeline
        key={`${today}:${activeSession?.id ?? 0}`}
        today={today}
        initialPlan={plan}
        initialSession={activeSession ? { id: activeSession.id, startedAt: activeSession.started_at, date: activeSession.date } : null}
        initialSets={activeSets}
        demonstrations={demonstrations}
        priorBest={priorBest}
        quickRows={listedQuickWorkouts.map((entry) => ({
          key: String(entry.id),
          href: `/history/${today}`,
          title: '语音、文字记的训练',
          sub: (entry.payload?.exercises ?? []).map((exercise) => exercise.name).join('、') || entry.payload?.summary || entry.title,
        }))}
      />
    </JournalShell>
  );
}
