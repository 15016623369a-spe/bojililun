import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import TodayPlan from '@/components/TodayPlan';
import BigDate from '@/components/ui/BigDate';
import { daySessions, getPlan, liveTraining, sessionTotals, todayStr } from '@/lib/core/workout';
import { journalForDate } from '@/lib/core/journal';
import { hasRecordedData } from '@/lib/journal';
import { todaySnapshot } from '@/lib/core/meals';
import { getExercise } from '@/lib/exercise';
import { BODY_LABEL, imageUrl } from '@/lib/exercise-label';
import Icon from '@/components/ui/Icon';
import { getDb } from '@/lib/db';
import { exportJournal } from '@/lib/export';
import { calcMealTotals, formatDisplayKcal } from '@/lib/calculations';
import { dayExerciseBurn } from '@/lib/exercise-burn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function Meter({ label, value, target, unit, tone, approx }: { label: string; value: number; target: number; unit: string; tone?: 'coral'; approx?: boolean }) {
  const filled = target ? Math.round(Math.min(1, value / target) * 40) : 0;
  return <div className="meter" data-tone={tone}>
    <span className="meter-label">{label}</span>
    <span className="meter-ticks" aria-hidden="true">{Array.from({ length: 40 }, (_, i) => <i key={i} data-on={i < filled || undefined} />)}</span>
    <span className="meter-value"><b>{approx ? '≈' : ''}{value}</b>{target && !approx ? <em>/ {target}</em> : null} {unit}</span>
  </div>;
}

export default function TrainPage() {
  const today = todayStr();
  const plan = getPlan(today);
  const snap = todaySnapshot();
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
  // 饮食与摄入以手账为准（和记录、回顾同一份数据），运动消耗按训练粗估
  const ledgerDay = exportJournal(getDb(), 'local', today, today).days[0];
  const mealCards = ledgerDay.entries.filter((c) => c.entry_type === 'meal');
  const burn = dayExerciseBurn(trainedSessions.map((d) => d.session), ledgerDay.entries, snap.profile?.weight_kg ?? 70);
  // 只有还有没练完动作的那一节才算「训练中」
  const live = liveTraining();
  const activeSession = live?.session ?? null;
  const images = Object.fromEntries(plan.map((item) => {
    const image = getExercise(item.exercise_id)?.image;
    return [item.exercise_id, image ? imageUrl(image) : ''];
  }));
  const regions = [...new Set(plan.map((item) => BODY_LABEL[item.body_part] ?? item.body_part))].slice(0, 3);

  const kcal = Math.round(ledgerDay.daily_summary.intake.kcal ?? 0);
  const protein = Math.round(ledgerDay.daily_summary.intake.protein_g ?? 0);
  const allDone = plan.length > 0 && plan.every((item) => item.done === 1) && !activeSession;
  const targetKcal = snap.profile?.target_kcal ?? 0;
  const targetProtein = snap.profile?.target_protein ?? 0;

  return (
    <JournalShell active="plan" title="今日计划" today={today} className="is-train"
      headerAction={<div className="journal-head-actions">
        <span className="journal-head-label">今日计划</span>
        <Link className="journal-head-circle" href="/body" aria-label="回到点选肌群">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.2" /><path d="M7 9.5h10M12 9.5v5m0 0-3 6m3-6 3 6" /></svg>
        </Link>
      </div>}
      hero={<BigDate date={today} note={regions.length ? `${regions.join(' · ')}${allDone ? ' · 已完成' : ''}` : '还没安排'} />}>

      {!snap.profile && (
        <Link href="/me" className="soft-banner">先完善个人资料，才能计算热量目标和训练建议<Icon name="arrow-right" size={18} /></Link>
      )}

      <TodayPlan key={today} initialItems={plan} images={images} activeSession={activeSession
        ? { id: activeSession.id, startedAt: activeSession.started_at, next: live!.next } : null} />

      {(trainedSessions.length > 0 || listedQuickWorkouts.length > 0) && (
        <section className="v-section">
          <h2 className="v-section-title">今天已练</h2>
          <div className="readouts">
            <div className="readout lemon"><b className="big-num">{totals.volume.toLocaleString()}</b><span>kg</span><em>训练容量</em></div>
            <div className="readout"><b className="big-num">{totals.sets}</b><span>组</span><em>完成组数</em></div>
            <div className="readout"><b className="big-num">{details.length > 0 ? totals.durationMin : '—'}</b><span>分钟</span><em>训练时长</em></div>
          </div>
          <div className="v-rows">
            {trainedSessions.map((d) => (
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

      <section className="v-section">
        <h2 className="v-section-title">今日营养</h2>
        <Meter label="摄入" value={kcal} target={targetKcal} unit="kcal" />
        <Meter label="运动消耗" value={burn.kcal} target={targetKcal} unit="kcal" tone="coral" approx />
        <Meter label="蛋白质" value={protein} target={targetProtein} unit="g" />
        <p className="burn-note">
          {burn.kcal > 0
            ? <>净摄入 <b>{(kcal - burn.kcal).toLocaleString()}</b> kcal · 运动消耗按部位、器械、容量和约 {burn.minutes} 分钟训练估算，误差约 ±20%</>
            : '今天还没有训练，练完后这里会估算运动消耗'}
        </p>
        {mealCards.length > 0 && <div className="v-rows">
          {mealCards.map((c) => (
            <Link key={c.id} href="/log" className="v-row">
              <span><b>{c.summary_title} · {formatDisplayKcal(calcMealTotals(c.items).kcal)}</b>
                <small>{c.items.map((i) => [i.food_name, i.portion_text].filter(Boolean).join(' ')).join('、')}</small></span>
              <Icon name="chevron-right" size={18} className="row-chev" />
            </Link>
          ))}
        </div>}
      </section>
    </JournalShell>
  );
}
