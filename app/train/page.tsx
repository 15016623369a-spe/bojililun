import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import TodayPlan from '@/components/TodayPlan';
import TrainingOverview from '@/components/TrainingOverview';
import { activeTraining, daySessions, getPlan, getSessionSets, sessionPlan, todayStr } from '@/lib/core/workout';
import { getTrainingBodyModel } from '@/lib/core/body-model';
import { journalForDate } from '@/lib/core/journal';
import { hasRecordedData } from '@/lib/journal';
import { getExercise } from '@/lib/exercise';
import { BODY_LABEL, imageUrl, TARGET_LABEL } from '@/lib/exercise-label';
import { weekDates } from '@/lib/date';
import { idsForTarget } from '@/lib/energy';
import type { PlanItem } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: '训练 · FitCheck' };

function trainingFocus(exercises: Pick<PlanItem, 'target' | 'body_part'>[]) {
  const labels = [...new Set(exercises.map(({ target, body_part }) => {
    if (target === 'pectorals') return '胸';
    return TARGET_LABEL[target] ?? BODY_LABEL[body_part] ?? '全身';
  }))];
  return labels.length > 3 ? '全身训练' : labels.join('与');
}

export default async function TrainPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const today = todayStr();
  const week = weekDates(today);
  const query = await searchParams;
  const date = query.date && week.includes(query.date) ? query.date : today;
  const days = week.map((day) => {
    const plan = getPlan(day);
    const details = daySessions(day);
    const completed = details.filter(({ session, sets }) => session.ended_at && sets.length > 0);
    const quick = journalForDate(day).filter((entry) => entry.quickId !== undefined && entry.kind === 'training');
    const quickExercises = quick.flatMap((entry) => entry.payload?.exercises ?? []).filter(hasRecordedData);
    const sets = completed.flatMap((entry) => entry.sets);
    return { date: day, plan, details, completed, quick, quickExercises, sets,
      focus: trainingFocus(plan.length ? plan : sets), recorded: sets.length > 0 || quickExercises.length > 0 };
  });
  const selected = days.find((day) => day.date === date)!;
  const { plan, completed, quick, quickExercises, sets } = selected;
  const active = activeTraining();
  const activeSession = date === today ? active ?? selected.details.find(({ session }) => !session.ended_at)?.session ?? null : null;
  const activeSets = activeSession ? getSessionSets(activeSession.id) : [];
  const activePlan = activeSession ? sessionPlan(activeSession) : [];
  const activeProgress = activeSession ? {
    id: activeSession.id, completedSets: activeSets.length,
    totalSets: activeSession.plan_json ? activePlan.reduce((sum, item) => sum + item.sets, 0) : null,
  } : null;
  const images = Object.fromEntries(plan.map((item) => {
    const image = getExercise(item.exercise_id)?.image;
    return [item.exercise_id, image ? imageUrl(image) : ''];
  }));
  const names = new Map<string, number>();
  for (const set of sets) names.set(set.exercise_name, (names.get(set.exercise_name) ?? 0) + 1);
  const last = completed.at(-1);
  const finished = last?.session.plan_json && sessionPlan(last.session)
    .every((item) => last.sets.filter((set) => set.plan_item_id === item.id).length >= item.sets);
  const lastEnded = selected.details.findLast(({ session }) => session.plan_json && session.ended_at);
  const pending = plan.filter((item) => !item.done);
  const targets = activeSession ? activePlan : pending;
  const focus = (activeSession && trainingFocus(activePlan)) || selected.focus || (quick.length ? '训练记录' : '暂无训练安排');
  const status = activeProgress ? `训练中 · 已记录 ${activeProgress.completedSets} 组`
    : sets.length ? `${finished && pending.length === 0 ? '已完成' : completed.length > 1 ? '当天已记录' : '本次已记录'} ${sets.length} 组`
    : lastEnded ? '训练已结束 · 已记录 0 组'
    : quick.length ? '已有训练记录'
    : plan.length ? `${plan.length} 个动作 · ${plan.reduce((sum, item) => sum + item.sets, 0)} 组`
    : '';
  const receipt = [...names].map(([name, count]) => `${name} ${count} 组`).join(' · ')
    || quickExercises.map((exercise) => exercise.name).join(' · ');

  return (
    <JournalShell active="plan" title="训练" today={today} className="is-train"
      headerAction={<span className="journal-head-label">训练</span>}
      hero={<TrainingOverview key={date} today={today} date={date} focus={focus} status={status} receipt={receipt}
        variant={getTrainingBodyModel()}
        planned={[...new Set(targets.flatMap((item) => idsForTarget(item.target)))]}
        recorded={[...new Set([...sets, ...activeSets].flatMap((set) => idsForTarget(set.target)))]}
        days={days.map((day) => ({ date: day.date, focus: day.focus, recorded: day.recorded }))} />}>

      {date >= today && <TodayPlan key={date} date={date} isToday={date === today} initialItems={plan} images={images}
        activeSession={activeProgress} hasCompletedTraining={Boolean(last) || quickExercises.length > 0}
        completedSessionId={last?.session.plan_json ? last.session.id : null} />}

      {(quick.length > 0 || (date < today && sets.length > 0)) && (
        <Link href={`/history/${date}`} className="add-row">查看当天记录</Link>
      )}
    </JournalShell>
  );
}
