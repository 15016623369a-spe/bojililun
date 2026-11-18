import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import TodayPlan from '@/components/TodayPlan';
import { dayLabel } from '@/lib/period';
import { MEAL_LABEL } from '@/lib/date';
import { daySessions, getPlan, sessionTotals, todayStr } from '@/lib/core/workout';
import { todaySnapshot } from '@/lib/core/meals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function TrainPage() {
  const today = todayStr();
  const plan = getPlan(today);
  const snap = todaySnapshot();
  const details = daySessions(today);
  const totals = sessionTotals(details);
  const activeSession = details.find((d) => !d.session.ended_at)?.session ?? null;

  const kcal = snap.consumed.kcal;
  const protein = Math.round(snap.consumed.protein);
  const targetKcal = snap.profile?.target_kcal ?? 0;
  const targetProtein = snap.profile?.target_protein ?? 0;

  return (
    <JournalShell active="plan" title="编辑今日计划" subtitle={dayLabel(today)} back={{ href: "/body", label: "计划" }}>
      <div className="journal-utility">
        <div className="journal-links"><Link href="/exercises">动作库</Link></div>
        {!snap.profile && (
          <Link href="/me" className="banner warn">
            先完善个人资料，才能计算热量目标和训练建议 →
          </Link>
        )}

        {activeSession && (
          <Link href={`/train/${activeSession.id}`} className="banner accent">
            有一节训练还没结束（{new Date(activeSession.started_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 开始）· 继续训练 →
          </Link>
        )}

        <section className="mini-stats">
          <div className="mini-card">
            <span>热量</span>
            <b>{kcal}</b>
            <em>/ {targetKcal} kcal</em>
            <div className="bar">
              <i style={{ width: `${targetKcal ? Math.min(100, (kcal / targetKcal) * 100) : 0}%` }} />
            </div>
          </div>
          <div className="mini-card">
            <span>蛋白质</span>
            <b>{protein}</b>
            <em>/ {targetProtein} g</em>
            <div className="bar">
              <i style={{ width: `${targetProtein ? Math.min(100, (protein / targetProtein) * 100) : 0}%` }} />
            </div>
          </div>
        </section>

        <TodayPlan initialItems={plan} activeSession={activeSession ? activeSession.id : null} />

        {details.length > 0 && (
          <section className="block">
            <h2 className="block-title">今天已练</h2>
            <div className="today-summary">
              <div>
                <b>{totals.volume}</b>
                <span>kg 容量</span>
              </div>
              <div>
                <b>{totals.sets}</b>
                <span>组</span>
              </div>
              <div>
                <b>{totals.durationMin}</b>
                <span>分钟</span>
              </div>
            </div>
            <div className="meal-list">
              {details.map((d) => (
                <Link key={d.session.id} href={`/history/${today}`} className="meal-row">
                  <div>
                    <b>
                      {d.groups.length} 个动作 · {d.sets.length} 组
                    </b>
                    <p>{d.groups.map((g) => g.exercise_name).join('、')}</p>
                  </div>
                  <span className="arrow">›</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {snap.meals.length > 0 && (
          <section className="block">
            <h2 className="block-title">今天吃了</h2>
            <div className="meal-list">
              {snap.meals.map((m) => (
                <div key={m.id} className="meal-row static">
                  <div>
                    <b>
                      {MEAL_LABEL[m.meal_type]} · {m.kcal} kcal
                    </b>
                    <p>{m.items.map((i) => `${i.name} ${i.grams}g`).join('、')}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

    </JournalShell>
  );
}
