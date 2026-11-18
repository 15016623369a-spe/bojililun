/**
 * 训练全链路截图：动作库加动作 → 今日清单 → 训练执行（计时/休息）→ 历史 → 统计 → 我的
 * 用法：先 npm run dev，然后 node scripts/shot-training.mjs
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

// 1) 建档
await fetch(`${BASE}/api/profile`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: '我',
    sex: 'male',
    age: 27,
    height_cm: 178,
    weight_kg: 74,
    activity: 'moderate',
    goal: 'cut',
  }),
});

const browser = await chromium.launch({ executablePath: shell });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('pageerror:', e.message));

// 2) 动作库挑三个胸肌动作
await page.goto(`${BASE}/exercises?body=chest&equip=barbell`, { waitUntil: 'networkidle' });
await page.waitForSelector('.ex-card');
for (let i = 0; i < 3; i++) {
  await page.locator('.ex-card .add-btn').nth(i).click();
  await page.waitForTimeout(400);
}
await shot(page, '11-library-add');

// 3) 今日训练清单
await page.goto(`${BASE}/train`, { waitUntil: 'networkidle' });
await page.waitForSelector('.plan-row');
// 简化：把第一个动作设为 80kg × 8
const weightInput = page.locator('.plan-row').first().locator('input').nth(2);
await weightInput.fill('80');
await page.waitForTimeout(500);
await shot(page, '12-today-plan');

// 4) 开始训练
await page.click('.btn.primary.big');
await page.waitForURL(/\/train\/\d+/, { timeout: 15000 });
await page.waitForTimeout(800);
await shot(page, '13-runner-idle');

// 5) 第一组：开始 → 等 2 秒 → 结束 → 休息倒计时
await page.fill('.set-inputs input >> nth=0', '80');
await page.click('button:has-text("开始第 1 组")');
await page.waitForTimeout(2200);
await shot(page, '14-runner-working');
await page.click('button:has-text("结束本组")');
await page.waitForTimeout(1500);
await shot(page, '15-runner-rest');

// 6) 跳过休息，再记一组
await page.click('button:has-text("跳过休息")');
await page.waitForTimeout(400);
await page.fill('.set-inputs input >> nth=1', '8');
await page.click('button:has-text("开始第 2 组")');
await page.waitForTimeout(1200);
await page.click('button:has-text("结束本组")');
await page.waitForTimeout(600);
await page.click('button:has-text("跳过休息")');
await page.waitForTimeout(400);

// 7) 结束训练
await page.click('button:has-text("结束训练")');
await page.waitForTimeout(1500);
await shot(page, '16-history-day');

// 8) 历史月历 / 统计 / 我的
await page.goto(`${BASE}/history`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await shot(page, '17-history-calendar');

await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await shot(page, '18-stats');

await page.goto(`${BASE}/me`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await shot(page, '19-me');

await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await shot(page, '20-chat-voice');

// 让教练直接排今天的训练
await page.fill('.composer input', '帮我安排今天练腿的动作，加进训练清单');
await page.press('.composer input', 'Enter');
await page.waitForTimeout(1800);
await shot(page, '21-chat-plan');

await browser.close();
console.log('training screenshots ->', OUT);
