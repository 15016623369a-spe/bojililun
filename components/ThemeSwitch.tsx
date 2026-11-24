'use client';

import { useState } from 'react';

type Theme = 'light' | 'dark';
const haptic = (ms = 6) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };

/** 太阳 / 月亮都用点阵画，和全站的圆点语言一致 */
function DotSun() {
  const dots: [number, number][] = [[8, 2], [8, 14], [2, 8], [14, 8], [3.8, 3.8], [12.2, 12.2], [3.8, 12.2], [12.2, 3.8]];
  return <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="3.2" fill="currentColor" />
    {dots.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="currentColor" />)}
  </svg>;
}
function DotMoon() {
  return <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10.8 2.3a6 6 0 1 0 2.9 9.7A5 5 0 0 1 10.8 2.3Z" fill="currentColor" />
    <circle cx="13.2" cy="3.2" r=".9" fill="currentColor" /><circle cx="11.6" cy="6.2" r=".6" fill="currentColor" />
  </svg>;
}

/**
 * 白天 / 夜间切换：写进 cookie（服务端渲染时直接带上主题，不会先闪一下白），
 * 同时立即改 <html data-theme>。切换瞬间给全站颜色一个短过渡。
 */
export default function ThemeSwitch({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

  function choose(next: Theme) {
    if (next === theme) return;
    haptic(8);
    setTheme(next);
    const root = document.documentElement;
    root.classList.add('theme-switching');
    root.dataset.theme = next;
    document.cookie = `fc-theme=${next}; path=/; max-age=31536000; samesite=lax`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#0e0f10' : '#e2e3df');
    window.setTimeout(() => root.classList.remove('theme-switching'), 420);
  }

  return <section className="theme-switch" aria-label="显示模式">
    <div className="theme-switch-head">
      <span>显示模式</span>
    </div>
    <div className="theme-switch-track" role="radiogroup" aria-label="显示模式" data-value={theme}>
      <span className="theme-switch-thumb" aria-hidden="true" />
      <button type="button" role="radio" aria-checked={theme === 'light'} onClick={() => choose('light')}><DotSun />白天</button>
      <button type="button" role="radio" aria-checked={theme === 'dark'} onClick={() => choose('dark')}><DotMoon />夜间</button>
    </div>
  </section>;
}
