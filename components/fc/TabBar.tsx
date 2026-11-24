'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { BarsIcon, BodyIcon } from './icons';
import RecordTab from './RecordTab';

// 顺序：训练（左）· 记录（中，长按就地录音）· 回顾（右）。选中胶囊的弹簧动画见 app/motion.css
// 训练入口先到点阵人体选肌群（11 月 24 日用户要求）；今日训练单从右上角的计划胶囊进
const LEFT = { href: '/body', label: '训练', key: 'body' as const, Icon: BodyIcon };
const RIGHT = { href: '/review', label: '回顾', key: 'review' as const, Icon: BarsIcon };

export type TabKey = 'log' | 'body' | 'review';

export default function TabBar({ active }: { active: TabKey }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const on = (href: string) => pathname === href || pathname.startsWith(href + '/');

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

  // 选中胶囊只在换到新页面后从上一个位置弹过去（motion.css 的 pill-from）。
  // 不在点下时先把胶囊挪到新入口：那样新页面一加载，胶囊会先跳回原位再弹一次。按下的反馈由按压回弹负责。
  const leftOn = active === LEFT.key || on(LEFT.href) || on('/train');
  const logOn = active === 'log' || on('/log');
  const rightOn = active === RIGHT.key || on(RIGHT.href);

  // 导航条右边常驻一颗录音键（像 iOS 26 标签栏旁的按钮）：每个页面都在，切页时导航和它都不动。
  // 按住说话在哪个页面都能记（也能说「今天练胸，给我排四个动作」）；轻点打开记录页的「记一条」面板
  return (
    <div className="fc-nav-row">
    <nav className="fc-tabs" aria-label="主导航">
      <Link
        href={LEFT.href}
        prefetch={true}
        className={`fc-tab${leftOn ? ' on' : ''}`}
        aria-current={active === LEFT.key ? 'page' : undefined}
      >
        <LEFT.Icon />
        <span>{LEFT.label}</span>
        <i className="u" />
      </Link>

      <RecordTab active={logOn} />

      <Link
        href={RIGHT.href}
        prefetch={true}
        className={`fc-tab${rightOn ? ' on' : ''}`}
        aria-current={active === RIGHT.key ? 'page' : undefined}
      >
        <RIGHT.Icon />
        <span>{RIGHT.label}</span>
        <i className="u" />
      </Link>
    </nav>
    <RecordTab variant="orb" active={logOn} />
    </div>
  );
}
