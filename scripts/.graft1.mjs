import { chromium } from 'playwright-core';
const exe = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const b = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
for (const side of ['front', 'back']) {
  await p.goto(`http://127.0.0.1:3002/body?view=${side}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.waitForTimeout(15000);
  await p.screenshot({ path: `../shots-check/g-${side}.png` });
}
console.log('errors:', errs.slice(0, 2).join(' | ') || 'none');
await b.close();
