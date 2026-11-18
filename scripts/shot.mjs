/**
 * 用 headless chromium 跑一遍真实 UI，产出截图。
 * 用法：先 npm run dev，然后 node scripts/shot.mjs
 * 注意：数据库为空时会先走一遍引导页。
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

const browser = await chromium.launch({ executablePath: shell });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('pageerror:', e.message));

await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
await page.waitForSelector('.composer input', { timeout: 15_000 });

// 没有建档时先走引导页
if (await page.$('.overlay .sheet')) {
  await shot(page, '00-onboarding');
  await page.click('.goal-list button:nth-of-type(1)');
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(1500);
}

await shot(page, '01-home');

// 文字记一餐
await page.fill('.composer input', '午饭吃了米饭200g、鸡胸肉150g、西兰花100g');
await page.press('.composer input', 'Enter');
await page.waitForSelector('.card', { timeout: 20_000 });
await page.waitForTimeout(400);
await shot(page, '02-card');

// 确认记录
await page.click('.card .btn.primary');
await page.waitForTimeout(1200);
await shot(page, '03-confirmed');

// 记忆：说出约束
await page.fill('.composer input', '我左肩有伤，不能做过顶推举，另外我家里只有哑铃');
await page.press('.composer input', 'Enter');
await page.waitForTimeout(1200);
await shot(page, '04-memory');

// 点击「记住」，让训练计划真的用上这些约束
await page.locator('.card').last().locator('.btn.primary').click();
await page.waitForTimeout(1000);

// 训练计划
await page.fill('.composer input', '今天练胸');
await page.press('.composer input', 'Enter');
await page.waitForTimeout(1500);
await shot(page, '05-workout');

// 抽屉
await page.click('.hdr-actions .chip-btn');
await page.waitForTimeout(500);
await shot(page, '06-drawer');

await browser.close();
console.log('screenshots ->', OUT);
