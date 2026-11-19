import JournalShell from '@/components/JournalShell';
import BodyAtlas from '@/components/BodyAtlas';

export const metadata = { title: '计划 · FitCheck' };
export const dynamic = 'force-dynamic';

export default function BodyPage() {
  return <JournalShell active="plan" title="计划">
    <BodyAtlas />
  </JournalShell>;
}
