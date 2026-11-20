import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import PlanBody from '@/components/fc/PlanBody';
import { todayMuscles } from '@/lib/log';

export const metadata = { title: '计划 · FitCheck' };
export const dynamic = 'force-dynamic';

export default function BodyPage() {
  const heat = todayMuscles();

  return (
    <JournalShell active="plan" title="计划" subtitle="点选肌肉，为今天安排动作。">
      <div className="fc plan-embed">
        <PlanBody heat={heat} />
      </div>
      <div className="journal-links">
        <Link href="/exercises">全部动作</Link>
        <Link href="/train">编辑今日计划</Link>
      </div>
    </JournalShell>
  );
}
