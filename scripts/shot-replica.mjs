/**
 * 复刻稿截图：记录页（含语音快记卡片）+ 回顾页（周 / 月）
 * 用法：先 npm run dev，然后 node scripts/shot-replica.mjs
 * 浏览器：默认用本机 playwright 缓存里的 chrome-headless-shell，可用 CHROME 指定路径
 */

import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:3001';
const OUT = path.resolve(process.env.OUT || 'docs/replica');
fs.mkdirSync(OUT, { recursive: true });

const exe =
  process.env.CHROME ||
  path.resolve(
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
  );

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('pageerror:', e.message));

const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

/** 每次都从干净的演示数据开始，截图才有可比性 */
const resetDemo = () => {
  execFileSync(process.execPath, ['scripts/seed-demo.mjs', '--reset'], { stdio: 'ignore' });
};

resetDemo();

// 1. 记录页（已记录状态）
await page.goto(`${BASE}/log`, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForSelector('.fc-tl', { timeout: 30_000 });
await page.waitForTimeout(500);
await shot('01-log');

// 2. 语音快记：短按 → 打字兜底 → 记下来 → 已记录卡片
await page.click('.fc-speak');
await page.waitForSelector('.fc-sheet textarea', { timeout: 10_000 });
await page.waitForTimeout(450);
await page.fill('.fc-sheet textarea', '刚做了 20 分钟高位下拉和划船');
await page.waitForTimeout(350);
await shot('02-type-sheet');
await page.click('.fc-sheet .fc-btn.primary');
await page.waitForSelector('.fc-card', { timeout: 30_000 });
await page.waitForTimeout(400);
await shot('03-log-card');

// 3. 回顾：周（先把快记的那条清掉，回到演示数据）
resetDemo();
await page.goto(`${BASE}/review`, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForSelector('.fc-figure', { timeout: 30_000 });
await page.waitForTimeout(3200);
await shot('04-review-week');

// 4. 回顾：月
await page.goto(`${BASE}/review?period=month`, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForTimeout(3200);
await shot('05-review-month');

// 5. 回顾：日
await page.goto(`${BASE}/review?period=day`, { waitUntil: 'networkidle', timeout: 120_000 });
await page.waitForTimeout(2600);
await shot('06-review-day');

await browser.close();
console.log('done →', OUT);
