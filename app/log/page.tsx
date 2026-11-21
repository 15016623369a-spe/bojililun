import LedgerCards from '@/components/fc/LedgerCards';
import { getDb } from '@/lib/db';
import { exportJournal } from '@/lib/export';
import { getLastExerciseRecord } from '@/lib/ledger';
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
  const history: Record<string, string> = {};
  for (const c of day.entries)
    c.exercises.forEach((m, index) => {
      if (!m.sets.length && m.exercise_id) {
        const last = getLastExerciseRecord(db, 'local', m.exercise_id, c.logged_at);
        if (last) history[c.id + ':' + index] = last.label.replace(/^上次 · /, '');
      }
    });

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
          <LedgerCards cards={day.entries} history={history} />
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
