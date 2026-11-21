'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarsIcon, BodyIcon } from './icons';
import RecordTab from './RecordTab';

// 顺序：身体（左）· 记录（中，长按就地录音）· 回顾（右）
const LEFT = { href: '/atlas', label: '身体', key: 'body' as const, Icon: BodyIcon };
const RIGHT = { href: '/review', label: '回顾', key: 'review' as const, Icon: BarsIcon };

export type TabKey = 'log' | 'body' | 'review';

export default function TabBar({ active }: { active: TabKey }) {
  const pathname = usePathname() ?? '';
  const on = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className="fc-tabs" aria-label="主导航">
      <Link href={LEFT.href} className={`fc-tab${active === LEFT.key || on(LEFT.href) ? ' on' : ''}`} aria-current={active === LEFT.key ? 'page' : undefined}>
        <LEFT.Icon />
        <span>{LEFT.label}</span>
        <i className="u" />
      </Link>

      <RecordTab active={active === 'log' || on('/log')} />

      <Link href={RIGHT.href} className={`fc-tab${active === RIGHT.key || on(RIGHT.href) ? ' on' : ''}`} aria-current={active === RIGHT.key ? 'page' : undefined}>
        <RIGHT.Icon />
        <span>{RIGHT.label}</span>
        <i className="u" />
      </Link>
    </nav>
  );
}
