import { notFound } from 'next/navigation';
import EntryTable from '@/components/EntryTable';
import ExerciseRecord from '@/components/ExerciseRecord';
import JournalIcon from '@/components/JournalIcon';
import JournalShell from '@/components/JournalShell';
import JournalTimeline from '@/components/JournalTimeline';
import { DEFAULT_TZ, humanDate, MEAL_LABEL } from '@/lib/date';
import { validDate } from '@/lib/period';
import { mealLogPayload, recordedJournalForDate } from '@/lib/core/journal';
import { hasRecordedData, type QuickPayload } from '@/lib/journal';
import { daySessions, sessionTotals } from '@/lib/core/workout';
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

  // 组被全部删掉的历史训练不再作为一条空记录展示
  const sessions = daySessions(date).filter(({ sets }) => sets.length > 0);
  const meals = mealsOn(date);
  const quick = recordedJournalForDate(date).filter((entry) => entry.quickId !== undefined);
  const quickWorkouts = quick.filter((entry) => entry.kind === 'training');
  // 有详细训练时，纯名称提及（无组数/次数/重量/用时）不作为记录卡片列出；仅语音的日子保留标准化摘要
  const listedQuickWorkouts = sessions.length > 0
    ? quickWorkouts.filter((entry) => (entry.payload?.exercises ?? []).some(hasRecordedData))
    : quickWorkouts;
  const quickMeals = quick.filter((entry) => entry.kind === 'meal');
  const quickSleep = quick.filter((entry) => entry.kind === 'sleep');
  const totals = sessionTotals(sessions);
  const workoutCount = totals.sessions + (sessions.length === 0 ? quickWorkouts.length : 0);
  const calories = meals.reduce((total, meal) => total + meal.kcal, 0);
  const protein = Math.round(meals.reduce((total, meal) => total + meal.protein, 0));
  const movements = sessions.reduce((total, session) => total + session.groups.length, 0);
  const duration = sessions.length === 0 && quickWorkouts.length > 0 ? '—'
    : sessions.some(({ session }) => session.ended_at) && totals.durationMin === 0 ? '<1' : totals.durationMin;

  // 饮食：全天合成一张标准表格，餐次作为一列——所有食物共用同一套列宽，上下自然对齐；
  // 分量平时是纯文本，点一下才进入输入态，保存后回到纯文本。
  const mealRank = (label?: string) => ['早餐', '午餐', '晚餐', '加餐'].indexOf(label ?? '');
  const mealItems: NonNullable<QuickPayload['items']> = [
    ...quickMeals.flatMap((entry) => (entry.payload?.items ?? []).map((item) => ({
      ...item,
      meal: item.meal ?? entry.payload?.mealType ?? entry.title,
      planned: item.planned ?? entry.payload?.planned,
    }))),
    ...meals.flatMap((meal) => (mealLogPayload(meal).items ?? []).map((item) => ({
      ...item,
      meal: MEAL_LABEL[meal.meal_type],
    }))),
  ];
  mealItems.sort((a, b) => (mealRank(a.meal) + 1 || 99) - (mealRank(b.meal) + 1 || 99));
  // 只有一餐时不重复餐次列
  const mealLabels = new Set(mealItems.map((item) => item.meal));
  const mealTable = mealLabels.size > 1 ? mealItems : mealItems.map(({ meal: _meal, ...item }) => item);

  return (
    <JournalShell active="review" title={humanDate(date)} subtitle={date.slice(0, 4) + ' 年'}
      back={back}>
      {(sessions.length > 0 || quickWorkouts.length > 0) && <dl className="day-metrics" aria-label="训练摘要">
        <div><dt>训练容量</dt><dd>{totals.volume.toLocaleString('zh-CN')} <small>kg</small></dd></div>
        <div><dt>训练时长</dt><dd>{duration} <small>分钟</small></dd></div>
        <div><dt>完成组数</dt><dd>{totals.sets} <small>组</small></dd></div>
        <div><dt>训练动作</dt><dd>{movements} <small>个</small></dd></div>
      </dl>}

      <section className="day-panel">
        <h2 className="day-heading training"><JournalIcon name="training" />训练记录
          {workoutCount > 0 && <span>{workoutCount} 次</span>}
        </h2>
        {sessions.length === 0 && quickWorkouts.length === 0 && <p className="hint">这天没有训练记录。</p>}
        {sessions.map(({ session, groups, sets }) => (
          <article className="day-session" id={`session-${session.id}`} key={session.id}>
            <header>
              <strong>{clock.format(new Date(session.started_at))}{session.ended_at ? ` – ${clock.format(new Date(session.ended_at))}` : ' · 进行中'}</strong>
              <span>{sets.length} 组</span>
            </header>
            {groups.map((group) => <ExerciseRecord group={group} key={group.exercise_id} />)}
          </article>
        ))}
        {listedQuickWorkouts.length > 0 && <>
          {sessions.length > 0 && <p className="hint">语音记录 · 数据行已并入今日训练表格</p>}
          <JournalTimeline entries={listedQuickWorkouts} compact />
        </>}
      </section>

      <section className="day-panel">
        <h2 className="day-heading meal"><JournalIcon name="meal" />饮食记录
          {meals.length > 0 && <span>{calories} kcal · 蛋白质 {protein} g</span>}
        </h2>
        {meals.length === 0 && quickMeals.length === 0 && <p className="hint">这天没有饮食记录。</p>}
        {mealTable.length > 0 && <EntryTable payload={{ kind: 'meal', items: mealTable }} />}
      </section>

      {quickSleep.length > 0 && <section className="day-panel">
        <h2 className="day-heading sleep"><JournalIcon name="sleep" />睡眠记录
          <span>{quickSleep.length} 条</span>
        </h2>
        <JournalTimeline entries={quickSleep} compact />
      </section>}
    </JournalShell>
  );
}
