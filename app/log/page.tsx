import LedgerCards from '@/components/fc/LedgerCards';
import { getDb } from '@/lib/db';
import { exportJournal } from '@/lib/export';
import { readCardPick } from '@/lib/ledger';
import type { Metadata } from 'next';
import LogScreen from '@/components/fc/LogScreen';
import { LeafIcon } from '@/components/fc/icons';
import { dayText, todayStr } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '今天 · FitCheck',
};

export default function LogPage() {
  const today = todayStr();
  const { label } = dayText(today);
  const db = getDb(),
    day = exportJournal(db, 'local', today, today).days[0];
  const picks = Object.fromEntries(day.entries.map((c) => [c.id, readCardPick(db, 'local', c.id)]));

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
          <LedgerCards cards={day.entries} picks={picks} />
          {day.body_metrics.map((m) => (
            <p key={m.logged_at}>
              {m.weight_kg} kg · {m.note || '体重记录'}
            </p>
          ))}
          <LogScreen ledgerHasRecords={!!(day.entries.length || day.body_metrics.length)} />
        </main>
      </div>
    </div>
  );
}
