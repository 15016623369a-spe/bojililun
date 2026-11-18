import type { ReactNode } from 'react';
import Link from 'next/link';
import { activeTraining, getPlan } from '@/lib/core/workout';
import JournalIcon from './JournalIcon';
import TrainingQueue from './TrainingQueue';
import JournalNav from './JournalNav';

export default function JournalShell({ active, title, subtitle, children, footer, back }: {
  active: 'plan' | 'record' | 'review';
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  back?: { href: string; label: string };
}) {
  return <div className="journal-shell">
    <header className="journal-head">
      <div className="journal-brand"><JournalIcon name="brand" />FitCheck</div>
      <TrainingQueue items={getPlan()} activeId={activeTraining()?.id ?? null} />
    </header>
    <main className="journal-content">
      {back && <Link className="journal-back" href={back.href}>‹ {back.label}</Link>}
      <h1>{title}</h1>
      {subtitle && <p className="journal-date">{subtitle}</p>}
      {children}
    </main>
    <footer className="journal-footer">
      {footer}
      <JournalNav active={active} />
    </footer>
  </div>;
}
