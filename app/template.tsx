'use client';

import { usePathname } from 'next/navigation';

/** 页面所属的主导航位置：计划 0 · 记录 1 · 回顾 2；「我的」放在最右 */
function slot(path: string) {
  if (/^\/(body|atlas|train)(\/|$)/.test(path)) return 0;
  if (/^\/(log|chat)(\/|$)/.test(path)) return 1;
  if (/^\/(review|stats|history)(\/|$)/.test(path)) return 2;
  if (/^\/me(\/|$)/.test(path)) return 3;
  return null;
}

// 记住「上一页」和「这一页」；同一页重复渲染（开发模式会渲染两次）时结果不变
let current: { path: string; slot: number | null } | null = null;
let previous: { path: string; slot: number | null } | null = null;

/**
 * 每次换页都会重新挂载：按主导航的左右顺序算出方向，
 * 页面内容从那一侧带弹簧滑入，底部导航的选中胶囊从上一个位置弹过来（见 motion.css）。
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? '';
  // 服务端不记状态（模块变量会被所有请求共用），首屏也不播动画，避免水合不一致
  if (typeof window === 'undefined') return <div className="page-flow">{children}</div>;
  if (!current || current.path !== path) {
    previous = current;
    current = { path, slot: slot(path) };
  }
  let shift: number | undefined;
  if (previous && previous.path !== path) {
    shift = previous.slot !== null && current.slot !== null ? Math.max(-2, Math.min(2, current.slot - previous.slot)) : 0;
  }
  return <div className="page-flow" data-shift={shift}>{children}</div>;
}
