import type { ReactNode } from 'react';
import Link from 'next/link';
import { todayStr, WORKOUT_TIME_ZONE } from '@/lib/core/workout';
import DailyRefresh from './DailyRefresh';
import JournalIcon from './JournalIcon';
import JournalNav from './JournalNav';

export default function JournalShell({ active, title, subtitle, subtitleAside, children, footer, back, headerAction, today = todayStr() }: {
  active: 'plan' | 'record' | 'review';
  title: string;
  subtitle?: string;
  subtitleAside?: string;
  children: ReactNode;
  footer?: ReactNode;
  back?: { href: string; label: string };
  headerAction?: ReactNode;
  today?: string;
}) {
  return <div className="journal-shell">
    <DailyRefresh date={today} timeZone={WORKOUT_TIME_ZONE} />
    <header className="journal-head">
      <div className="journal-brand"><JournalIcon name="brand" />FitCheck</div>
      {headerAction}
    </header>
    <main className="journal-content">
      {back && <Link className="journal-back" href={back.href}>‹ {back.label}</Link>}
      <h1>{title}</h1>
      {subtitle && <p className="journal-date">{subtitle}{subtitleAside && <small>{subtitleAside}</small>}</p>}
      {children}
    </main>
    <footer className="journal-footer">
      {footer}
      <JournalNav active={active} />
    </footer>
  </div>;
}
