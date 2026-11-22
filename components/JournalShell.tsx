import type { ReactNode } from 'react';
import Link from 'next/link';
import { todayStr, WORKOUT_TIME_ZONE } from '@/lib/core/workout';
import DailyRefresh from './DailyRefresh';
import JournalIcon from './JournalIcon';
import TabBar, { type TabKey } from './fc/TabBar';
import Icon from './ui/Icon';

const TAB: Record<'plan' | 'record' | 'review', TabKey> = { plan: 'body', record: 'log', review: 'review' };

export default function JournalShell({ active, title, subtitle, subtitleAside, children, footer, back, headerAction, navigation, today = todayStr(), className, hero, hideNav = false }: {
  active: 'plan' | 'record' | 'review';
  title: string;
  subtitle?: string;
  subtitleAside?: string;
  children: ReactNode;
  footer?: ReactNode;
  back?: { href: string; label: string };
  headerAction?: ReactNode;
  /** 替换默认的 TabBar */
  navigation?: ReactNode;
  today?: string;
  className?: string;
  /** 替代标题的大字区（大号日期、读数等）；会自带隐藏的 h1 */
  hero?: ReactNode;
  /** 页面自带页内导航时隐藏主导航（如训练统计） */
  hideNav?: boolean;
}) {
  return <div className={className ? `journal-shell ${className}` : 'journal-shell'}>
    <DailyRefresh date={today} timeZone={WORKOUT_TIME_ZONE} />
    <header className="journal-head">
      <div className="journal-brand"><JournalIcon name="brand" />FitCheck</div>
      {headerAction}
    </header>
    <main className="journal-content">
      {back && <Link className="journal-back" href={back.href}><Icon name="chevron-left" size={18} stroke={2} />{back.label}</Link>}
      {hero ? <><h1 className="sr-only">{title}</h1>{hero}</> : <>
        <h1>{title}</h1>
        {subtitle && <p className="journal-date">{subtitle}{subtitleAside && <small>{subtitleAside}</small>}</p>}
      </>}
      {children}
    </main>
    <footer className="journal-footer">
      {footer}
      {!hideNav && (navigation ?? <TabBar active={TAB[active]} />)}
    </footer>
  </div>;
}
