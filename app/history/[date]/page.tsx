import { notFound } from 'next/navigation';
import JournalIcon from '@/components/JournalIcon';
import JournalShell from '@/components/JournalShell';
import JournalTimeline from '@/components/JournalTimeline';
import { DEFAULT_TZ, humanDate, MEAL_LABEL } from '@/lib/date';
import { validDate } from '@/lib/period';
import { BODY_LABEL } from '@/lib/exercise-label';
import { journalForDate } from '@/lib/core/journal';
import { daySessions, getPlan, sessionTotals } from '@/lib/core/workout';
import { mealsOn } from '@/lib/core/meals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clock = new Intl.DateTimeFormat('zh-CN', {
  timeZone: process.env.APP_TZ || DEFAULT_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export default async function DayPage({ params, searchParams }: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ from?: string; period?: string }>;
}) {
  const { date } = await params;
  if (!validDate(date)) notFound();
  const { from, period } = await searchParams;
  const calendarPeriod = period === 'day' || period === 'week' ? period : 'month';
  const back = from === 'calendar'
    ? { href: `/history/calendar?date=${date}&period=${calendarPeriod}`, label: '月历' }
    : { href: `/history?period=day&date=${date}`, label: '回顾' };

  const sessions = daySessions(date);
  const meals = mealsOn(date);
  const plan = getPlan(date);
  const quick = journalForDate(date).filter((entry) => entry.quickId !== undefined);
  const quickWorkouts = quick.filter((entry) => entry.kind === 'training');
  const quickMeals = quick.filter((entry) => entry.kind === 'meal');
  const totals = sessionTotals(sessions);
  const calories = meals.reduce((total, meal) => total + meal.kcal, 0);
  const protein = Math.round(meals.reduce((total, meal) => total + meal.protein, 0));
  const movements = sessions.reduce((total, session) => total + session.groups.length, 0);
  const duration = sessions.some(({ session }) => session.ended_at) && totals.durationMin === 0 ? '<1' : totals.durationMin;

  return (
    <JournalShell active="review" title={humanDate(date)} subtitle={date.slice(0, 4) + ' 年'}
      back={back}>
      {sessions.length > 0 && <dl className="day-metrics" aria-label="训练摘要">
        <div><dt>训练容量</dt><dd>{totals.volume.toLocaleString('zh-CN')} <small>kg</small></dd></div>
        <div><dt>训练时长</dt><dd>{duration} <small>分钟</small></dd></div>
        <div><dt>完成组数</dt><dd>{totals.sets} <small>组</small></dd></div>
        <div><dt>训练动作</dt><dd>{movements} <small>个</small></dd></div>
      </dl>}

      <section className="day-panel">
        <h2 className="day-heading training"><JournalIcon name="training" />训练记录
          {sessions.length > 0 && <span>{totals.sessions} 次</span>}
        </h2>
        {sessions.length === 0 && quickWorkouts.length === 0 && <p className="hint">这天没有训练记录。</p>}
        {sessions.map(({ session, groups, sets }) => (
          <article className="day-session" id={`session-${session.id}`} key={session.id}>
            <header>
              <strong>{clock.format(new Date(session.started_at))}{session.ended_at ? ` – ${clock.format(new Date(session.ended_at))}` : ' · 进行中'}</strong>
              <span>{sets.length} 组</span>
            </header>
            {groups.map((group) => (
              <div className="day-exercise" key={group.exercise_id}>
                <div className="day-exercise-name">
                  <strong>{group.exercise_name}</strong>
                  <span>{BODY_LABEL[group.body_part] ?? group.body_part} · {group.volume.toLocaleString('zh-CN')} kg</span>
                </div>
                <ol className="set-chips" aria-label="训练组">
                  {group.sets.map((set) => <li className="set-chip" key={set.id}>
                    {set.weight > 0 ? `${set.weight} kg` : '自重'} × {set.reps}
                  </li>)}
                </ol>
              </div>
            ))}
          </article>
        ))}
        {quickWorkouts.length > 0 && <JournalTimeline entries={quickWorkouts} compact />}
      </section>

      <section className="day-panel">
        <h2 className="day-heading meal"><JournalIcon name="meal" />饮食记录
          {meals.length > 0 && <span>{calories} kcal · 蛋白质 {protein} g</span>}
        </h2>
        {meals.length === 0 && quickMeals.length === 0 && <p className="hint">这天没有饮食记录。</p>}
        {meals.map((meal) => (
          <div className="day-meal" key={meal.id}>
            <strong>{MEAL_LABEL[meal.meal_type]} <small>{meal.kcal} kcal</small></strong>
            <p>{meal.items.map((item) => `${item.name} ${item.grams} g`).join('、')}</p>
          </div>
        ))}
        {quickMeals.length > 0 && <JournalTimeline entries={quickMeals} compact />}
      </section>

      {plan.length > 0 && <section className="day-panel">
        <h2 className="day-heading">当日计划 <span>{plan.length} 个动作</span></h2>
        <ul className="day-plan">
          {plan.map((item) => <li key={item.id}>
            <span>{item.done ? '✓ ' : ''}{item.name}</span>
            <small>{item.sets} 组 × {item.reps} 次 · {item.weight > 0 ? `${item.weight} kg` : '自重'}</small>
          </li>)}
        </ul>
      </section>}
    </JournalShell>
  );
}
