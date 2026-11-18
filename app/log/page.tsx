import type { Metadata } from 'next';
import LogScreen from '@/components/fc/LogScreen';
import { LeafIcon } from '@/components/fc/icons';
import { dayText, dayTimeline, todayStr } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '今天 · FitCheck',
};

export default function LogPage() {
  const today = todayStr();
  const { label } = dayText(today);
  const entries = dayTimeline(today);

  return (
    <div className="fc">
      <div className="fc-shell">
        <header>
          <div className="fc-brand">
            <LeafIcon />
            FitCheck
          </div>
          <h1 className="fc-h1">今天</h1>
          <p className="fc-sub">{label}</p>
        </header>

        <main style={{ marginTop: 4 }}>
          <LogScreen entries={entries} />
        </main>
      </div>
    </div>
  );
}
