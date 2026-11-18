import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import BodyAtlas from '@/components/BodyAtlas';

export const metadata = { title: '计划 · FitCheck' };
export const dynamic = 'force-dynamic';

export default function BodyPage() {
  return <JournalShell active="plan" title="计划" subtitle="点选肌肉，为今天安排动作。">
    <BodyAtlas />
    <div className="journal-links">
      <Link href="/exercises">全部动作</Link>
      <Link href="/train">编辑今日计划</Link>
    </div>
  </JournalShell>;
}
