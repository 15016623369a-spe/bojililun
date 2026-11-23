'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BarsIcon, BodyIcon } from './icons';
import RecordTab from './RecordTab';

// 顺序：训练（左，今日训练单）· 记录（中，长按就地录音）· 回顾（右）。选中胶囊的弹簧动画见 app/motion.css
const LEFT = { href: '/train', label: '训练', key: 'body' as const, Icon: BodyIcon };
const RIGHT = { href: '/review', label: '回顾', key: 'review' as const, Icon: BarsIcon };

export type TabKey = 'log' | 'body' | 'review';

export default function TabBar({ active }: { active: TabKey }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const on = (href: string) => pathname === href || pathname.startsWith(href + '/');

  useEffect(() => {
    setPending(null);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      router.prefetch('/train');
      router.prefetch('/log');
      router.prefetch('/body');
      router.prefetch('/review');
      void import('./SculptureBody')
        .then((m) => {
          if (cancelled) return;
          const match = document.cookie.match(/(?:^|;\s*)fc-body-model=(male|female)/);
          m.preloadSculpture(match?.[1] === 'female' ? 'female' : 'male');
        })
        .catch(() => {});
    };
    const win = window as Partial<Window>;
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(warm, { timeout: 600 });
      return () => {
        cancelled = true;
        win.cancelIdleCallback?.(id);
      };
    }
    const timer = globalThis.setTimeout(warm, 200);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timer);
    };
  }, [router]);

  const leftOn = pending ? pending === LEFT.href : active === LEFT.key || on(LEFT.href);
  const logOn = pending ? pending === '/log' : active === 'log' || on('/log');
  const rightOn = pending ? pending === RIGHT.href : active === RIGHT.key || on(RIGHT.href);

  return (
    <nav className="fc-tabs" aria-label="主导航">
      <Link
        href={LEFT.href}
        prefetch={true}
        onClick={() => { if (!on(LEFT.href)) setPending(LEFT.href); }}
        className={`fc-tab${leftOn ? ' on' : ''}`}
        aria-current={active === LEFT.key ? 'page' : undefined}
      >
        <LEFT.Icon />
        <span>{LEFT.label}</span>
        <i className="u" />
      </Link>

      <RecordTab
        active={logOn}
        onTapStart={() => { if (!on('/log')) setPending('/log'); }}
      />

      <Link
        href={RIGHT.href}
        prefetch={true}
        onClick={() => { if (!on(RIGHT.href)) setPending(RIGHT.href); }}
        className={`fc-tab${rightOn ? ' on' : ''}`}
        aria-current={active === RIGHT.key ? 'page' : undefined}
      >
        <RIGHT.Icon />
        <span>{RIGHT.label}</span>
        <i className="u" />
      </Link>
    </nav>
  );
}
