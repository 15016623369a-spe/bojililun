/**
 * 动作库页面截图。用法：先 npm run dev，然后 node scripts/shot-library.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { resolveChromiumShell } from './browser-path.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:3001';
const OUT = path.resolve('docs/shots');
fs.mkdirSync(OUT, { recursive: true });

const shell = resolveChromiumShell();

const browser = await chromium.launch({ executablePath: shell });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('pageerror:', e.message));

await page.goto(`${BASE}/exercises`, { waitUntil: 'networkidle' });
await page.waitForSelector('.ex-card', { timeout: 15_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '07-library.png') });

await page.goto(`${BASE}/exercises?body=chest&equip=dumbbell`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(OUT, '08-library-filter.png') });

// 点进第一个动作
await page.click('.ex-card');
await page.waitForSelector('.detail-media img', { timeout: 15_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, '09-detail.png') });
await page.screenshot({ path: path.join(OUT, '10-detail-full.png'), fullPage: true });

await browser.close();
console.log('library screenshots ->', OUT);
