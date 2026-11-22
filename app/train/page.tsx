import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import TodayPlan from '@/components/TodayPlan';
import BigDate from '@/components/ui/BigDate';
import { MEAL_LABEL } from '@/lib/date';
import { activeTraining, daySessions, getPlan, sessionTotals, todayStr } from '@/lib/core/workout';
import { journalForDate } from '@/lib/core/journal';
import { hasRecordedData } from '@/lib/journal';
import { todaySnapshot } from '@/lib/core/meals';
import { getExercise } from '@/lib/exercise';
import { BODY_LABEL, imageUrl } from '@/lib/exercise-label';
import Icon from '@/components/ui/Icon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function Meter({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  const filled = target ? Math.round(Math.min(1, value / target) * 40) : 0;
  return <div className="meter">
    <span className="meter-label">{label}</span>
    <span className="meter-ticks" aria-hidden="true">{Array.from({ length: 40 }, (_, i) => <i key={i} data-on={i < filled || undefined} />)}</span>
    <span className="meter-value"><b>{value}</b>{target ? <em>/ {target}</em> : null} {unit}</span>
  </div>;
}

export default function TrainPage() {
  const today = todayStr();
  const plan = getPlan(today);
  const snap = todaySnapshot();
  const details = daySessions(today);
  const quickEntries = journalForDate(today).filter((entry) => entry.quickId !== undefined);
  const quickWorkouts = quickEntries.filter((entry) => entry.kind === 'training');
  const quickMeals = quickEntries.filter((entry) => entry.kind === 'meal' && !entry.payload?.planned);
  // 有详细训练时，纯名称提及不列入「今天已练」；仅语音的日子保留记录入口
  const listedQuickWorkouts = details.length > 0
    ? quickWorkouts.filter((entry) => (entry.payload?.exercises ?? []).some(hasRecordedData))
    : quickWorkouts;
  const totals = sessionTotals(details);
  const activeSession = activeTraining() ?? details.find(({ session }) => !session.ended_at)?.session ?? null;
  const images = Object.fromEntries(plan.map((item) => {
    const image = getExercise(item.exercise_id)?.image;
    return [item.exercise_id, image ? imageUrl(image) : ''];
  }));
  const regions = [...new Set(plan.map((item) => BODY_LABEL[item.body_part] ?? item.body_part))].slice(0, 3);

  const kcal = snap.consumed.kcal;
  const protein = Math.round(snap.consumed.protein);
  const targetKcal = snap.profile?.target_kcal ?? 0;
  const targetProtein = snap.profile?.target_protein ?? 0;

  return (
    <JournalShell active="plan" title="今日计划" today={today} className="is-train"
      headerAction={<div className="journal-head-actions">
        <span className="journal-head-label">今日计划</span>
        <Link className="journal-head-circle" href="/atlas" aria-label="回到点选肌群">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.2" /><path d="M7 9.5h10M12 9.5v5m0 0-3 6m3-6 3 6" /></svg>
        </Link>
      </div>}
      hero={<BigDate date={today} note={regions.length ? regions.join(' · ') : '还没安排'} />}>

      {!snap.profile && (
        <Link href="/me" className="soft-banner">先完善个人资料，才能计算热量目标和训练建议<Icon name="arrow-right" size={18} /></Link>
      )}

      <TodayPlan key={today} initialItems={plan} images={images} activeSession={activeSession
        ? { id: activeSession.id, startedAt: activeSession.started_at } : null} />

      {(details.length > 0 || listedQuickWorkouts.length > 0) && (
        <section className="v-section">
          <h2 className="v-section-title">今天已练</h2>
          <div className="readouts">
            <div className="readout lemon"><b className="big-num">{totals.volume.toLocaleString()}</b><span>kg</span><em>训练容量</em></div>
            <div className="readout"><b className="big-num">{totals.sets}</b><span>组</span><em>完成组数</em></div>
            <div className="readout"><b className="big-num">{details.length > 0 ? totals.durationMin : '—'}</b><span>分钟</span><em>训练时长</em></div>
          </div>
          <div className="v-rows">
            {details.map((d) => (
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
        <Meter label="热量" value={kcal} target={targetKcal} unit="kcal" />
        <Meter label="蛋白质" value={protein} target={targetProtein} unit="g" />
        {(snap.meals.length > 0 || quickMeals.length > 0) && <div className="v-rows">
          {snap.meals.map((m) => (
            <div key={m.id} className="v-row static">
              <span><b>{MEAL_LABEL[m.meal_type]} · {m.kcal} kcal</b><small>{m.items.map((i) => `${i.name} ${i.grams}g`).join('、')}</small></span>
            </div>
          ))}
          {quickMeals.map((entry) => (
            <Link key={entry.id} href={`/history/${today}`} className="v-row">
              <span><b>{entry.title} · {(entry.payload?.items ?? []).map((item) => item.name).join('、')}</b>{entry.meta && <small>{entry.meta}</small>}</span>
              <Icon name="chevron-right" size={18} className="row-chev" />
            </Link>
          ))}
        </div>}
      </section>
    </JournalShell>
  );
}
