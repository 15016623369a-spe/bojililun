/**
 * 语音长按录音：底部导航 + 录音遮罩截图。
 * 用法：
 *   OUT=docs/pr/<slug>/before node scripts/shot-voice.mjs
 *   OUT=docs/pr/<slug>/after  node scripts/shot-voice.mjs
 * 依赖：先 npm run dev；BASE 指向那个服务（默认 http://127.0.0.1:3001）。
 * 遮罩还没实现时脚本只截底部导航，不会报错。
 */

import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:3001';
const OUT = path.resolve(process.env.OUT || 'docs/voice');
fs.mkdirSync(OUT, { recursive: true });

const exe =
  process.env.CHROME ||
  path.resolve(
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
  );

const browser = await chromium.launch({
  executablePath: exe,
  args: [
    '--use-gl=angle',
    '--enable-unsafe-swiftshader',
    // 让 headless 里也能拿到麦克风，波形才有动静
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  permissions: ['microphone'],
});
const page = await context.newPage();
page.on('pageerror', (e) => console.error('pageerror:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('console error:', m.text());
});

/** 每次从干净演示数据开始 */
const resetDemo = () => {
  execFileSync(process.execPath, ['scripts/seed-demo.mjs', '--reset'], { stdio: 'ignore' });
};

const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const dockShot = async (name) => {
  const dock = await page.$('.fc-dock');
  await dock.screenshot({ path: path.join(OUT, `${name}.png`) });
};

async function open(url, selector) {
  // dev 首次按需编译时偶尔先吐一个 404 / 半成品页面，重试一次比加 sleep 稳
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    try {
      await page.waitForSelector(selector, { timeout: 15_000 });
      await page.waitForTimeout(700);
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      console.log(`  · ${url} 第 ${attempt} 次没等到 ${selector}（HTTP ${res && res.status()}），重试`);
      await page.waitForTimeout(1200);
    }
  }
}

resetDemo();

// 1. 记录页：整页 + 底部导航
await open('/log', '.fc-tl');
await shot('01-log');
await dockShot('02-log-dock');

// 2. 身体页底部导航
await open('/atlas', '.fc-tabs');
await dockShot('03-atlas-dock');

// 3. 回顾页底部导航（3D 图等它稳）
await open('/review', '.fc-seg');
await page.waitForTimeout(1600);
await dockShot('04-review-dock');

// 4. 长按录音遮罩（实现之后才有）
const recordTab = await page.$('.fc-rec-tab');
if (recordTab) {
  await open('/log', '.fc-tl');
  const tab = await page.$('.fc-rec-tab');
  const box = await tab.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // recording
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(2600);
  if (await page.$('.fc-rec')) {
    await shot('05-recording');

    // canceling：手指上滑过 80px
    await page.mouse.move(cx, cy - 150, { steps: 10 });
    await page.waitForTimeout(350);
    await shot('06-canceling');
    await page.mouse.up();
    await page.waitForTimeout(500);
  } else {
    console.log('! 长按后没有出现 .fc-rec，跳过录音态截图');
    await page.mouse.up();
  }

  // too-short：按住 320ms 就松手
  await open('/log', '.fc-tl');
  const tab2 = await page.$('.fc-rec-tab');
  const b2 = await tab2.boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(420);
  await page.mouse.up();
  await page.waitForTimeout(600);
  await shot('07-too-short');

  // 短按：应该回到记录页而不是弹遮罩
  await open('/atlas', '.fc-tabs');
  const tab3 = await page.$('.fc-rec-tab');
  const b3 = await tab3.boundingBox();
  await page.mouse.click(b3.x + b3.width / 2, b3.y + b3.height / 2);
  await page.waitForTimeout(700);
  console.log('短按后 URL：', new URL(page.url()).pathname, '遮罩存在：', Boolean(await page.$('.fc-rec')));
} else {
  console.log('· 页面上没有 .fc-rec-tab，跳过录音态截图（改造前）');
}

await browser.close();
