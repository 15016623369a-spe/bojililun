'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarsIcon, BodyIcon, PencilIcon } from './icons';

// 顺序：身体（左）· 记录（中）· 回顾（右）
const TABS = [
  { href: '/atlas', label: '身体', Icon: BodyIcon },
  { href: '/log', label: '记录', Icon: PencilIcon },
  { href: '/review', label: '回顾', Icon: BarsIcon },
];

export type TabKey = 'log' | 'body' | 'review';

export default function TabBar({ active }: { active: TabKey }) {
  const pathname = usePathname() ?? '';
  return (
    <nav className="fc-tabs" aria-label="主导航">
      {TABS.map((t) => {
        const key = t.href === '/atlas' ? 'body' : t.href.slice(1);
        const on = active === key || pathname === t.href || pathname.startsWith(t.href + '/');
        return (
          <Link key={t.href} href={t.href} className={`fc-tab${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined}>
            <t.Icon />
            <span>{t.label}</span>
            <i className="u" />
          </Link>
        );
      })}
    </nav>
  );
}
