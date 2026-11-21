import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

const base = process.env.LEDGER_E2E_URL;
assert.ok(
  base && process.env.CHROME,
  'Set LEDGER_E2E_URL to a server using a temporary SQLite DB and CHROME to Chromium',
);
const text = '中午吃了 500 克鸡肉做的鸡肉牛肉饭';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const path = base + '/api/ledger';
  const response = await page.request.post(path, {
    data: { source: 'voice', text, request_id: randomUUID() },
  });
  assert.ok(response.ok(), await response.text());
  const read = async () => (await (await page.request.get(path)).json()).days[0];
  const before = (await read()).entries.filter((e) => e.raw_text === text).at(-1);
  assert.ok(before?.items.length);
  assert.ok(before.items.some((i) => i.estimated_grams === 500));
  await page.goto(base + '/log');
  const card = page
    .locator('article')
    .filter({ has: page.getByText(before.summary_title, { exact: true }) })
    .last();
  const prompt = card.locator('fieldset');
  await prompt.waitFor();
  assert.ok((await prompt.getByRole('button').count()) >= 3);
  const name = /整份|整餐|饭的总重/;
  const option = prompt.getByRole('button', { name }).first();
  const label = await option.innerText();
  const patch = page.waitForResponse((r) => r.url() === path && r.request().method() === 'PATCH');
  await option.click();
  assert.ok((await patch).ok());
  await page
    .getByText(before.summary_title + ' · ' + label, { exact: true })
    .last()
    .waitFor();
  assert.equal(await card.locator('fieldset').count(), 0);
  const day = await read(),
    edited = day.entries.find((e) => e.id === before.id);
  assert.equal(
    Math.round(
      edited.items.reduce((sum, i) => sum + (i.nutrition_basis?.measured_grams ?? i.estimated_grams ?? 0), 0),
    ),
    500,
  );
  assert.notDeepEqual(edited.items, before.items);
  const markdown = await (await page.request.get(path + '?format=md')).text();
  assert.ok(markdown.includes(edited.summary_title));
  assert.ok(markdown.includes('|' + day.daily_summary.intake.kcal + '|'));
  await page.goto(base + '/review?period=day');
  await page.getByText(edited.summary_title, { exact: true }).waitFor();
  assert.ok(
    (await page.locator('section').filter({ hasText: edited.summary_title }).innerText()).includes(
      '蛋白质 ' + day.daily_summary.intake.protein_g + ' g',
    ),
  );
  console.log('Passed: AI quick pick, default save, one-tap recalculation, review and JSON/Markdown parity');
} finally {
  await browser.close();
}
