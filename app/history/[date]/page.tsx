import Link from 'next/link';
import { notFound } from 'next/navigation';
import EntryTable from '@/components/EntryTable';
import ExerciseRecord from '@/components/ExerciseRecord';
import JournalShell from '@/components/JournalShell';
import RecordDeck from '@/components/RecordDeck';
import BigDate from '@/components/ui/BigDate';
import Icon from '@/components/ui/Icon';
import SplitNumber from '@/components/ui/SplitNumber';
import { DEFAULT_TZ, humanDate } from '@/lib/date';
import { validDate } from '@/lib/period';
import { recordedJournalForDate } from '@/lib/core/journal';
import { hasRecordedData, mealNutritionLabel, type JournalMealItem } from '@/lib/journal';
import { daySessions, sessionTotals, todayStr } from '@/lib/core/workout';

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
  searchParams: Promise<{ from?: string; period?: string; anchor?: string }>;
}) {
  const { date } = await params;
  if (!validDate(date)) notFound();
  const { from, period } = await searchParams;
  const calendarPeriod = period === 'day' || period === 'week' ? period : 'month';
  const back = from === 'calendar'
    ? { href: `/history/calendar?date=${date}&period=${calendarPeriod}`, label: '月历' }
    : { href: period === 'month' ? '/review?period=month' : period === 'day' ? '/review?period=day' : '/review', label: '回顾' };

  // 组被全部删掉的历史训练不再作为一条空记录展示
  const sessions = daySessions(date).filter(({ sets }) => sets.length > 0);
  const entries = recordedJournalForDate(date);
  const quick = entries.filter((entry) => entry.quickId !== undefined);
  const quickWorkouts = quick.filter((entry) => entry.kind === 'training');
  // 有详细训练时，纯名称提及（无组数/次数/重量/用时）不作为记录卡片列出；仅语音的日子保留标准化摘要
  const listedQuickWorkouts = sessions.length > 0
    ? quickWorkouts.filter((entry) => (entry.payload?.exercises ?? []).some(hasRecordedData))
    : quickWorkouts;
  const meals = entries.filter((entry) => entry.kind === 'meal');
  const quickSleep = quick.filter((entry) => entry.kind === 'sleep');
  const totals = sessionTotals(sessions);
  const workoutCount = totals.sessions + (sessions.length === 0 ? quickWorkouts.length : 0);
  const movements = sessions.reduce((total, session) => total + session.groups.length, 0);
  const duration = sessions.length === 0 && quickWorkouts.length > 0 ? '—'
    : sessions.some(({ session }) => session.ended_at) && totals.durationMin === 0 ? '<1' : totals.durationMin;

  // 饮食：全天合成一张标准表格，餐次作为一列——所有食物共用同一套列宽，上下自然对齐；
  // 分量平时是纯文本，点一下才进入输入态，保存后回到纯文本。
  const mealRank = (label?: string) => ['早餐', '午餐', '晚餐', '加餐'].indexOf(label ?? '');
  const mealSummary = mealNutritionLabel(meals.flatMap((entry) => entry.payload ? [entry.payload] : []));
  const mealItems: JournalMealItem[] = meals.flatMap((entry) => (entry.payload?.items ?? []).map((item) => ({
    ...item,
    meal: item.meal ?? entry.payload?.mealType ?? entry.title,
    planned: item.planned ?? entry.payload?.planned,
  })));
  mealItems.sort((a, b) => (mealRank(a.meal) + 1 || 99) - (mealRank(b.meal) + 1 || 99));
  // 只有一餐时不重复餐次列
  const mealLabels = new Set(mealItems.map((item) => item.meal));
  const mealType = mealLabels.size === 1 ? [...mealLabels][0] : undefined;

  const mealCount = meals.filter((entry) => !entry.payload?.planned).length;
  const hasTraining = sessions.length > 0 || quickWorkouts.length > 0;

  return (
    <JournalShell active="review" title={humanDate(date)} back={back} className="is-review is-day"
      hero={<BigDate date={date} note={`${workoutCount} 次训练 · ${mealCount} 餐`} />}>
      <RecordDeck entries={entries} isToday={date === todayStr()} emptyHint="这天没有记录" />

      {hasTraining && <section className="v-section">
        <h2 className="v-section-title">训练</h2>
        <div className="readouts">
          <div className="readout lemon"><SplitNumber value={totals.volume} /><span>kg</span><em>训练容量</em></div>
          <div className="readout"><b className="big-num">{duration}</b><span>分钟</span><em>训练时长</em></div>
          <div className="readout"><b className="big-num">{totals.sets}</b><span>组</span><em>{movements} 个动作</em></div>
        </div>
        {sessions.map(({ session, groups, sets }) => (
          <article className="session-card" id={`session-${session.id}`} key={session.id}>
            <header>
              <b className="big-num">{clock.format(new Date(session.started_at))}</b>
              <span>{session.ended_at ? `— ${clock.format(new Date(session.ended_at))}` : '进行中'}</span>
              <em>{sets.length} 组</em>
            </header>
            {groups.map((group) => <ExerciseRecord group={group} key={group.exercise_id} />)}
          </article>
        ))}
        {sessions.length > 0 && listedQuickWorkouts.length > 0 && <p className="hint">语音记录的数据行已并入训练表格，原句在上方卡片里。</p>}
      </section>}

      {meals.length > 0 && <section className="v-section">
        <h2 className="v-section-title with-aside">饮食{mealSummary && <span>{mealSummary}</span>}</h2>
        {mealItems.length > 0 && <div className="table-card"><EntryTable payload={{ kind: 'meal', mealType, items: mealItems }} /></div>}
      </section>}

      {!hasTraining && meals.length === 0 && quickSleep.length === 0 && entries.length === 0 && <p className="hint center">这天没有训练和饮食记录。</p>}
      <Link className="v-link-row" href={`/history/calendar?date=${date}&period=${calendarPeriod}`}>
        <span><Icon name="calendar" size={18} />打开月历</span><Icon name="chevron-right" size={18} />
      </Link>
    </JournalShell>
  );
}
