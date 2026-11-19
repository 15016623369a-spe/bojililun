import { chromium } from 'playwright-core';
const exe = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const b = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 1000 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 200)));
await p.goto('http://127.0.0.1:3002/zznormalmap', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => document.body.innerText.includes('DONE'), { timeout: 240000 }).catch(() => console.log('timeout'));
console.log(await p.locator('pre').innerText());
await b.close();
