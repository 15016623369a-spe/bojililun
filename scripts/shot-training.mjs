/**
 * 训练全链路截图：动作库加动作 → 今日清单 → 训练执行（自动计时/组间休息）→ 历史 → 统计 → 我的 → 对话排计划
 * 用法：先 npm run dev，然后 node scripts/shot-training.mjs
 * 适配新版 TrainingRunner：进入即自动计时，「完成本组」记一组，休息页「结束休息，开始下一组/下一动作」。
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { resolveChromiumShell } from './browser-path.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:3001';
const OUT = path.resolve('docs/shots');
fs.mkdirSync(OUT, { recursive: true });

const shell = resolveChromiumShell();
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

const api = async (p, init) => {
  const res = await fetch(BASE + p, init);
  if (!res.ok) throw new Error(`${p} -> ${res.status} ${await res.text()}`);
  return res.json();
};
const patch = (p, payload) =>
  api(p, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

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

// 2) 清理残留：结束未完成的会话、清空今日清单，保证脚本可重复运行
await page.goto(`${BASE}/train`, { waitUntil: 'networkidle' });
const resumeBanner = page.locator('.banner.accent');
if (await resumeBanner.count()) {
  const href = await resumeBanner.getAttribute('href');
  const id = Number(href?.split('/').pop());
  if (id) await patch('/api/session', { id });
}
for (const item of (await api('/api/plan')).items) {
  await api(`/api/plan?id=${item.id}`, { method: 'DELETE' });
}

// 3) 动作库挑三个胸肌动作
await page.goto(`${BASE}/exercises?body=chest&equip=barbell`, { waitUntil: 'networkidle' });
await page.waitForSelector('.ex-card');
for (let i = 0; i < 3; i++) {
  await page.locator('.ex-card .add-btn').nth(i).click();
  await page.waitForTimeout(400);
}
await shot(page, '11-library-add');

// 4) 今日训练清单：把第一个动作设为 80kg
await page.goto(`${BASE}/train`, { waitUntil: 'networkidle' });
await page.waitForSelector('.plan-row');
const weightInput = page.locator('.plan-row').first().locator('input').nth(2);
await weightInput.fill('80');
await page.waitForTimeout(500);
await shot(page, '12-today-plan');

// 5) 开始训练（进入即自动计时）
await page.click('.btn.primary.big');
await page.waitForURL(/\/train\/\d+/, { timeout: 15000 });
await page.waitForSelector('.run-fields input');
await page.fill('.run-fields input >> nth=0', '80');
await page.fill('.run-fields input >> nth=1', '8');
await shot(page, '13-runner-idle');

// 6) 第一组：计时 2 秒 → 完成本组 → 组间休息倒计时
await page.waitForTimeout(2200);
await shot(page, '14-runner-working');
await page.click('button:has-text("完成本组")');
await page.waitForSelector('button:has-text("结束休息")', { timeout: 10000 });
await page.waitForTimeout(1200);
await shot(page, '15-runner-rest');

// 7) 跳过休息，再记一组
await page.click('button:has-text("结束休息")');
await page.waitForSelector('button:has-text("完成本组")');
await page.waitForTimeout(1200);
await page.click('button:has-text("完成本组")');
await page.waitForSelector('button:has-text("结束休息")', { timeout: 10000 });

// 8) 提前结束训练并归档（新版会跳回首页）
await page.click('button:has-text("结束训练并归档")');
await page.waitForTimeout(1500);
const today = new Date().toISOString().slice(0, 10);
await page.goto(`${BASE}/history/${today}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await shot(page, '16-history-day');

// 9) 历史月历 / 回顾 / 统计 / 我的
await page.goto(`${BASE}/history/calendar`, { waitUntil: 'networkidle' });
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

// 10) 让教练直接排今天的训练
await page.fill('.composer input', '帮我安排今天练腿的动作，加进训练清单');
await page.press('.composer input', 'Enter');
await page.waitForTimeout(1800);
await shot(page, '21-chat-plan');

await browser.close();
console.log('training screenshots ->', OUT);