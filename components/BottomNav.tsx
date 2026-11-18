'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/train', label: '训练', icon: 'M4 7h3l2-3h6l2 3h3v13H4V7Zm8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z' },
  { href: '/stats', label: '统计', icon: 'M5 20V10m7 10V4m7 16v-7' },
  { href: '/exercises', label: '动作', icon: 'M13 6a3 3 0 1 0 0-1M6 21v-3a4 4 0 0 1 4-4h4l2 4M6 12l3-3 3 2' },
  { href: '/history', label: '历史', icon: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z' },
  { href: '/me', label: '我的', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function BottomNav({ active }: { active: 'train' | 'stats' | 'exercises' | 'history' | 'me' }) {
  const pathname = usePathname();
  return (
    <nav className="tabbar">
      <div className="tabbar-inner">
        {TABS.map((t) => {
          const key = t.href.slice(1);
          const on = active === key || pathname === t.href || pathname.startsWith(t.href + '/');
          return (
            <Link key={t.href} href={t.href} className={`tab ${on ? 'on' : ''}`}>
              <Icon d={t.icon} />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>
      <Link href="/chat" className="fab-chat" aria-label="跟教练对话（支持语音）">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </Link>
    </nav>
  );
}
