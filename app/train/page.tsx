import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import TodayPlan from '@/components/TodayPlan';
import BigDate from '@/components/ui/BigDate';
import { activeTraining, daySessions, getPlan, getSessionSets, sessionPlan, sessionTotals, todayStr } from '@/lib/core/workout';
import { journalForDate } from '@/lib/core/journal';
import { hasRecordedData } from '@/lib/journal';
import { getExercise } from '@/lib/exercise';
import { BODY_LABEL, imageUrl } from '@/lib/exercise-label';
import Icon from '@/components/ui/Icon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata = { title: '今日训练 · FitCheck' };

export default function TrainPage() {
  const today = todayStr();
  const plan = getPlan(today);
  const details = daySessions(today);
  const quickEntries = journalForDate(today).filter((entry) => entry.quickId !== undefined);
  const quickWorkouts = quickEntries.filter((entry) => entry.kind === 'training');
  // 有详细训练时，纯名称提及不列入「今天已练」；仅语音的日子保留记录入口
  const listedQuickWorkouts = details.length > 0
    ? quickWorkouts.filter((entry) => (entry.payload?.exercises ?? []).some(hasRecordedData))
    : quickWorkouts;
  const completedSessions = details.filter(({ session, sets }) => session.ended_at && sets.length > 0);
  const lastCompletedSession = completedSessions.at(-1)?.session;
  const hasRecordedWorkout = quickWorkouts.some((entry) => entry.payload?.exercises?.some(hasRecordedData));
  const totals = sessionTotals(completedSessions);
  const activeSession = activeTraining() ?? details.find(({ session }) => !session.ended_at)?.session ?? null;
  const images = Object.fromEntries(plan.map((item) => {
    const image = getExercise(item.exercise_id)?.image;
    return [item.exercise_id, image ? imageUrl(image) : ''];
  }));
  const regions = [...new Set(plan.map((item) => BODY_LABEL[item.body_part] ?? item.body_part))].slice(0, 3);

  const activeProgress = activeSession ? {
    id: activeSession.id,
    completedSets: (details.find(({ session }) => session.id === activeSession.id)?.sets ?? getSessionSets(activeSession.id)).length,
    totalSets: activeSession.plan_json ? sessionPlan(activeSession).reduce((sum, item) => sum + item.sets, 0) : null,
  } : null;

  return (
    <JournalShell active="plan" title="今日训练" today={today} className="is-train"
      headerAction={<span className="journal-head-label" aria-hidden="true">今日训练</span>}
      hero={<BigDate date={today} note={regions.join(' · ')} />}>

      <TodayPlan key={today} date={today} initialItems={plan} images={images} activeSession={activeProgress}
        hasCompletedTraining={Boolean(lastCompletedSession) || hasRecordedWorkout}
        completedSessionId={lastCompletedSession?.plan_json ? lastCompletedSession.id : null} />

      {(completedSessions.length > 0 || listedQuickWorkouts.length > 0) && (
        <section className="v-section">
          <h2 className="v-section-title">今天已练</h2>
          <div className="readouts">
            <div className="readout lemon"><b className="big-num">{totals.volume.toLocaleString()}</b><span>kg</span><em>训练容量</em></div>
            <div className="readout"><b className="big-num">{totals.sets}</b><span>组</span><em>完成组数</em></div>
            <div className="readout"><b className="big-num">{completedSessions.length > 0 ? totals.durationMin : '—'}</b><span>分钟</span><em>训练时长</em></div>
          </div>
          <div className="v-rows">
            {completedSessions.map((d) => (
              <Link key={d.session.id} href={`/history/${today}`} className="v-row">
                <span><b>{d.groups.length} 个动作 · {d.sets.length} 组</b><small>{d.groups.map((g) => g.exercise_name).join('、')}</small></span>
                <Icon name="chevron-right" size={18} className="row-chev" />
              </Link>
            ))}
            {listedQuickWorkouts.map((entry) => (
              <Link key={entry.id} href={`/history/${today}`} className="v-row">
                <span><b>语音训练记录</b><small>{(entry.payload?.exercises ?? []).map((exercise) => exercise.name).join('、')
                  || entry.payload?.summary || entry.title}</small></span>
                <Icon name="chevron-right" size={18} className="row-chev" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </JournalShell>
  );
}
