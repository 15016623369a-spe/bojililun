import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import TodayPlan from '@/components/TodayPlan';
import BigDate from '@/components/ui/BigDate';
import { daySessions, getPlan, liveTraining, sessionTotals, todayStr } from '@/lib/core/workout';
import { journalForDate } from '@/lib/core/journal';
import { hasRecordedData } from '@/lib/journal';
import { getExercise } from '@/lib/exercise';
import { BODY_LABEL, imageUrl } from '@/lib/exercise-label';

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
  const totals = sessionTotals(details);
  // 开了又没记任何一组的训练不列出来
  const trainedSessions = details.filter((d) => d.sets.length > 0);
  // 只有还有没练完动作的那一节才算「训练中」
  const live = liveTraining();
  const activeSession = live?.session ?? null;
  const images = Object.fromEntries(plan.map((item) => {
    const image = getExercise(item.exercise_id)?.image;
    return [item.exercise_id, image ? imageUrl(image) : ''];
  }));
  const regions = [...new Set(plan.map((item) => BODY_LABEL[item.body_part] ?? item.body_part))].slice(0, 3);

  const allDone = plan.length > 0 && plan.every((item) => item.done === 1) && !activeSession;

  return (
    <JournalShell active="plan" title="今日训练" today={today} className="is-train"
      headerAction={<div className="journal-head-actions">
        <span className="journal-head-label">今日训练</span>
        <Link className="journal-head-circle" href="/body" prefetch={true} aria-label="按部位挑动作">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.2" /><path d="M7 9.5h10M12 9.5v5m0 0-3 6m3-6 3 6" /></svg>
        </Link>
      </div>}
      hero={<BigDate date={today} note={regions.length ? `${regions.join(' · ')}${allDone ? ' · 已完成' : ''}` : '还没安排'} />}>

      {/* 训练单只放动作和「今日已练」；今日营养挪到回顾的「今日饮食」块（11 月 24 日用户要求） */}
      <TodayPlan key={today} initialItems={plan} images={images} activeSession={activeSession
        ? { id: activeSession.id, startedAt: activeSession.started_at, next: live!.next,
          completedSets: details.find((d) => d.session.id === activeSession.id)?.sets.length ?? 0 } : null}
        trained={{
          summary: trainedSessions.length
            ? [totals.volume ? `${totals.volume.toLocaleString('zh-CN')} kg` : null, `${totals.sets} 组`, totals.durationMin ? `${totals.durationMin} 分钟` : null].filter(Boolean).join(' · ')
            : null,
          rows: listedQuickWorkouts.map((entry) => ({
            key: String(entry.id), href: `/history/${today}`, title: '语音、文字记的训练',
            sub: (entry.payload?.exercises ?? []).map((exercise) => exercise.name).join('、') || entry.payload?.summary || entry.title,
          })),
        }} />
    </JournalShell>
  );
}
