import Link from 'next/link';
import { redirect } from 'next/navigation';
import JournalShell from '@/components/JournalShell';
import PlanBody from '@/components/fc/PlanBody';
import { getPlan, todayStr } from '@/lib/core/workout';
import { humanDate, weekDates } from '@/lib/date';
import { getTrainingBodyModel } from '@/lib/core/body-model';

export const metadata = { title: '添加动作 · FitCheck' };
export const dynamic = 'force-dynamic';

export default async function BodyPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const today = todayStr();
  const query = await searchParams;
  if (query.date && (query.date < today || !weekDates(today).includes(query.date))) redirect('/train');
  const date = query.date || today;
  const target = date === today ? undefined : humanDate(date).split(' ')[1];
  const returnHref = target ? `/train?date=${date}` : '/train';
  const plan = getPlan(date);

  return (
    <JournalShell active="plan" title="添加动作" today={today} className="is-plan"
      headerAction={<Link className="plan-return" href={returnHref}>{target ? `返回${target}计划` : '返回今日训练'}</Link>}>
      <PlanBody key={date} variant={getTrainingBodyModel()}
        todayPlan={{ date, label: target ? `${target}训练` : undefined, exerciseIds: plan.map(({ exercise_id }) => exercise_id) }} />
    </JournalShell>
  );
}
