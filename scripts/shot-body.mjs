/**
 * 3D 人体页截图。用法：先 npm run dev，然后 node scripts/shot-body.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:3001';
const OUT = path.resolve('docs/shots');
fs.mkdirSync(OUT, { recursive: true });

const shell = path.resolve(
  '../.playwright/chromium_headless_shell-1255/chrome-headless-shell-mac-arm64/chrome-headless-shell',
);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

const browser = await chromium.launch({
  executablePath: shell,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('console:', m.text().slice(0, 200));
});

await page.goto(`${BASE}/body`, { waitUntil: 'networkidle' });
await page.waitForSelector('.body-canvas canvas', { timeout: 30000 });
// 等模型加载完（加载提示消失）
await page.waitForFunction(() => !document.querySelector('.body-loading'), null, { timeout: 60000 });
await page.waitForTimeout(2500);
await shot(page, '22-body-3d');

// 直接打开上胸的动作弹层（深链）
await page.goto(`${BASE}/body?muscle=chest_upper`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !document.querySelector('.body-loading'), null, { timeout: 60000 });
await page.waitForTimeout(1800);
await shot(page, '23-body-sheet');

// 关掉，旋转一下看背面
await page.click('.ms-close');
await page.waitForTimeout(300);
const box = await page.locator('.body-canvas').boundingBox();
if (box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 60, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
}
await shot(page, '24-body-back');

await browser.close();
console.log('body screenshots ->', OUT);
