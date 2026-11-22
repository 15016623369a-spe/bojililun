'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { BarsIcon, BodyIcon } from './icons';
import RecordTab from './RecordTab';

const LEFT = { href: '/train', label: '训练', key: 'body' as const, Icon: BodyIcon };
const RIGHT = { href: '/review', label: '回顾', key: 'review' as const, Icon: BarsIcon };

export type TabKey = 'log' | 'body' | 'review';
const ORDER: TabKey[] = ['body', 'log', 'review'];

// The three routes render their own footer. Keep the last position across those mounts.
let previousTab: TabKey | undefined;

export default function TabBar({ active }: { active: TabKey }) {
  const pathname = usePathname() ?? '';
  const on = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const selected = on('/log') ? 'log' : on('/review') ? 'review' : active;
  const index = ORDER.indexOf(selected);
  const nav = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const previous = previousTab;
    previousTab = selected;
    if (!previous || previous === selected || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const tabs = nav.current?.querySelectorAll<HTMLAnchorElement>('.fc-tab');
    const first = tabs?.[0];
    const from = tabs?.[ORDER.indexOf(previous)];
    const to = tabs?.[index];
    if (!first || !from || !to || !indicator.current?.animate) return;

    const start = from.offsetLeft - first.offsetLeft;
    const end = to.offsetLeft - first.offsetLeft;
    const travel = end - start;
    indicator.current.getAnimations().forEach((animation) => animation.cancel());
    indicator.current.animate([
      { transform: `translateX(${start}px) scaleX(1)` },
      { transform: `translateX(${start + travel * .58}px) scaleX(1.13)`, offset: .48 },
      { transform: `translateX(${end}px) scaleX(1)` },
    ], { duration: 260, easing: 'cubic-bezier(.23,.78,.32,1)' });
  }, [index, selected]);

  return (
    <nav ref={nav} className="fc-tabs fc-segmented-nav" aria-label="主导航"
      style={{ '--nav-tab-index': index } as CSSProperties}>
      <span className="fc-nav-indicator" ref={indicator} aria-hidden="true" />
      <Link href={LEFT.href} className={`fc-tab${selected === LEFT.key ? ' on' : ''}`} aria-current={selected === LEFT.key ? 'page' : undefined}>
        <LEFT.Icon />
        <span>{LEFT.label}</span>
        <i className="u" />
      </Link>

      <RecordTab active={selected === 'log'} />

      <Link href={RIGHT.href} className={`fc-tab${selected === RIGHT.key ? ' on' : ''}`} aria-current={selected === RIGHT.key ? 'page' : undefined}>
        <RIGHT.Icon />
        <span>{RIGHT.label}</span>
        <i className="u" />
      </Link>
    </nav>
  );
}
