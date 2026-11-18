import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MEAL_LABEL } from '@/lib/date';
import { dayLabel } from '@/lib/period';
import { BODY_LABEL } from '@/lib/exercise-label';
import { daySessions, getPlan, sessionTotals } from '@/lib/core/workout';
import { mealsOn } from '@/lib/core/meals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const details = daySessions(date);
  const meals = mealsOn(date);
  const plan = getPlan(date);
  const totals = sessionTotals(details);
  const kcal = meals.reduce((a, m) => a + m.kcal, 0);
  const protein = Math.round(meals.reduce((a, m) => a + m.protein, 0));

  return (
    <div className="page">
      <header className="page-hdr">
        <div>
          <h1>{dayLabel(date)}</h1>
          <p>{date}</p>
        </div>
        <Link className="chip-btn" href={`/history?month=${date.slice(0, 7)}`}>
          月历
        </Link>
      </header>

      <div className="page-body">
        <section className="metric-grid">
          <div className="metric-card">
            <span>训练容量</span>
            <b>
              {totals.volume.toLocaleString('en-US')} <em>kg</em>
            </b>
            <small>
              {totals.sessions} 次 · {totals.sets} 组
            </small>
          </div>
          <div className="metric-card">
            <span>训练时长</span>
            <b>
              {details.length > 0 && totals.durationMin === 0 ? '<1' : totals.durationMin} <em>分钟</em>
            </b>
            <small>{details.length ? '含组间休息' : '无训练'}</small>
          </div>
          <div className="metric-card">
            <span>摄入</span>
            <b>
              {kcal} <em>kcal</em>
            </b>
            <small>蛋白 {protein} g</small>
          </div>
          <div className="metric-card">
            <span>训练动作</span>
            <b>
              {details.reduce((a, d) => a + d.groups.length, 0)} <em>个</em>
            </b>
            <small>{plan.length ? `计划 ${plan.length} 个` : '无计划'}</small>
          </div>
        </section>

        <section className="block">
          <h2 className="block-title">训练</h2>
          {details.length === 0 ? (
            <p className="hint">这天没有训练记录。</p>
          ) : (
            details.map((d) => (
              <div className="session-card" key={d.session.id}>
                <div className="session-hd">
                  <b>
                    {new Date(d.session.started_at).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {d.session.ended_at
                      ? ` 开始 · ${new Date(d.session.ended_at).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })} 结束`
                      : ' 开始（未结束）'}
                  </b>
                  <em>{d.sets.length} 组</em>
                </div>
                {d.groups.map((g) => (
                  <div className="ex-group-row" key={g.exercise_id}>
                    <div className="egr-hd">
                      <span>{g.exercise_name}</span>
                      <em>
                        {BODY_LABEL[g.body_part] ?? g.body_part} · {g.volume.toLocaleString('en-US')} kg
                      </em>
                    </div>
                    <div className="set-chips">
                      {g.sets.map((s) => (
                        <span className="set-chip" key={s.id}>
                          {s.weight > 0 ? `${s.weight}kg` : '自重'} × {s.reps}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </section>

        {plan.length > 0 && (
          <section className="block">
            <h2 className="block-title">当日计划</h2>
            <div className="plan-simple">
              {plan.map((p) => (
                <div key={p.id} className="ps-row">
                  <span className={p.done ? 'done' : ''}>{p.name}</span>
                  <em>
                    {p.sets} × {p.reps} · {p.weight > 0 ? `${p.weight}kg` : '自重'}
                  </em>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="block">
          <h2 className="block-title">饮食</h2>
          {meals.length === 0 ? (
            <p className="hint">这天没有饮食记录。</p>
          ) : (
            <div className="meal-list">
              {meals.map((m) => (
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
          )}
        </section>
      </div>
    </div>
  );
}
