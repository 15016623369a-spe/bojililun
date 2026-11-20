/** Production-page acceptance, with a disposable SQLite DB (never user records).
 * Start with FITCHECK_DB_PATH=/tmp/fitcheck-sculpture-check.sqlite before running.
 */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const BASE = process.env.BASE || 'http://127.0.0.1:3104';
const DB = process.env.FITCHECK_DB_PATH;
assert(DB?.startsWith('/tmp/fitcheck-sculpture-'), 'An explicit disposable test DB is required');
const OUT = path.resolve('docs/sculpture/ortho/integration');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1.5 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /THREE|shader|Sculpture labels/i.test(m.text())) errors.push(m.text()); });
const checks = [];
const record = (message) => { checks.push(message); console.log('PASS', message); };
const viewer = () => page.locator('.sculpture-viewer').first();
async function ready(route) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => ['ready','error'].includes(document.querySelector('.sculpture-viewer')?.getAttribute('data-status')), null, { timeout: 90000 });
  assert.equal(await viewer().getAttribute('data-status'), 'ready', await page.locator('body').innerText());
  await page.waitForTimeout(300);
}
async function at(x, y) {
  const box = await viewer().locator('canvas').boundingBox();
  await page.mouse.move(box.x+box.width*x, box.y+box.height*y);
  await page.waitForTimeout(180);
  return { x: box.x+box.width*x, y: box.y+box.height*y, id: await viewer().getAttribute('data-hovered') };
}
async function find(id, candidates) {
  for (const [x, y] of candidates) { const hit = await at(x, y); if (hit.id === id) return hit; }
  await page.screenshot({ path: path.join(OUT, 'unexpected-state.png') });
  throw new Error(`Could not hover ${id}`);
}
async function close() { await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); }
async function shot(name) { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); }
async function exercises(name) {
  const dialog = page.getByRole('dialog', { name: `${name}动作列表` });
  await dialog.locator('.fc-dict-item').first().waitFor();
  return dialog;
}

try {
  await ready('/atlas');
  record('Production /atlas loads approved mesh, .bin and mapping with no approximate fallback');
  const chest = await find('chest_mid', [[.55,.24],[.55,.26],[.56,.28],[.54,.30],[.52,.27]]);
  await shot('chest-hover');
  record('Chest pointer hover uses the baked chest label');
  await page.mouse.click(chest.x, chest.y);
  await exercises('胸部');
  assert.equal(await viewer().getAttribute('data-selected'), 'chest_mid');
  await shot('chest-selected');
  record('Chest click selects the full chest and opens the chest exercise union');
  await close();
  for (const [name, x, y] of [['head',.5,.12],['neck',.50,.18],['front shorts',.53,.55],['foot',.62,.94],['hand',.76,.55],['background',.1,.5]]) {
    const hit = await at(x,y);
    assert.equal(hit.id, '', `${name} must not hover`);
    await page.mouse.click(hit.x, hit.y);
    assert.equal(await page.getByRole('dialog').count(), 0, `${name} must not open exercises`);
  }
  record('Head, neck, front shorts, foot, hand and background do not hover/click');
  // Mouse drag across the selected surface must only orbit.
  await page.mouse.move(chest.x,chest.y); await page.mouse.down();
  await page.mouse.move(chest.x+65,chest.y+5,{steps:10}); await page.mouse.up();
  assert.equal(await page.getByRole('dialog').count(),0);
  record('Orbit dragging does not fire a muscle click');
  await page.getByRole('button',{name:'背面',exact:true}).click();
  await page.waitForTimeout(400);
  const glutes = await find('glutes', [[.55,.52],[.56,.54],[.54,.55],[.52,.52],[.56,.50]]);
  await page.mouse.click(glutes.x,glutes.y);
  await exercises('臀部');
  assert.equal(await viewer().getAttribute('data-selected'),'glutes');
  await shot('glutes-selected');
  record('Posterior shorts glutes hover/select and open glute exercises after orbit/reset');
  await close();
  await page.getByRole('button',{name:'正面',exact:true}).click();
  const shoulder = await find('delt_side', [[.67,.25],[.68,.26],[.65,.23],[.66,.28],[.7,.24]]);
  await page.mouse.click(shoulder.x,shoulder.y);
  await exercises('肩部');
  record('Deltoid click opens the full shoulder list');
  await close();

  const db = new DatabaseSync(DB);
  for (const [group,target] of [['chest','pectorals'],['shoulders','delts']]) {
    const response = await fetch(`${BASE}/api/exercises?group=${group}&limit=100`);
    const result = await response.json();
    const expected = db.prepare('SELECT count(*) AS n FROM exercise WHERE target=?').get(target).n;
    assert.equal(response.status,200); assert.equal(result.total,expected);
    assert(result.total > 0);
  }
  const fine = await (await fetch(`${BASE}/api/exercises?muscle=chest_upper&limit=100`)).json();
  const coarse = await (await fetch(`${BASE}/api/exercises?group=chest&limit=100`)).json();
  assert(fine.total < coarse.total);
  record('API totals match ALL pectorals/delts while legacy upper-chest filtering stays narrower');

  // Deliberately isolated fixtures: known date ranges, one fine-only journal entry.
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
  db.exec('DELETE FROM session_set; DELETE FROM session; DELETE FROM journal_entry');
  const session = db.prepare('INSERT INTO session(date,started_at,ended_at) VALUES(?,?,?)').run(today,`${today}T01:00:00Z`,`${today}T01:30:00Z`).lastInsertRowid;
  const insert = db.prepare('INSERT INTO session_set(session_id,exercise_id,exercise_name,body_part,target,set_index,weight,reps,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  insert.run(session,'ui-chest','上胸','chest','pectorals',1,20,10,`${today}T01:10:00Z`);
  insert.run(session,'ui-delt','肩部','shoulders','rear deltoids',2,10,12,`${today}T01:15:00Z`);
  insert.run(session,'ui-glutes','臀桥','upper legs','glutes',3,40,10,`${today}T01:20:00Z`);
  db.prepare('INSERT INTO journal_entry(request_id,date,kind,title,detail,source_text,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('ui-fine-chest',today,'training','训练','练上胸','练上胸',`${today}T02:00:00Z`);
  db.close();
  await ready('/stats?period=week');
  const recorded = (await viewer().getAttribute('data-recorded')).split(',');
  for (const id of ['chest_mid','delt_side','glutes']) assert(recorded.includes(id), id);
  await shot('stats-recorded');
  record('Statistics highlights chest, rear-deltoid-to-shoulder and glutes in selected range');
  await ready(`/history?period=day&date=${today}`);
  await page.locator('.review-muscles summary').click();
  await page.getByRole('button',{name:'胸部',exact:true}).click();
  assert.equal(await viewer().getAttribute('data-selected'),'chest_mid');
  assert((await page.locator('body').innerText()).includes('练上胸'));
  record('Review chest selection retains a chest_upper-only journal record');
  await ready('/atlas?muscle=delt_rear');
  await page.getByRole('dialog',{name:'肩部动作列表'}).waitFor();
  assert.equal(await viewer().getAttribute('data-selected'),'delt_side');
  record('Fine-ID deep link maps to its coarse selection');
  await close();
  await page.setViewportSize({width:390,height:844});
  await ready('/atlas');
  const mobileChest = await find('chest_mid',[[.54,.25],[.55,.27],[.55,.29],[.53,.23]]);
  await page.mouse.click(mobileChest.x,mobileChest.y);
  await page.getByRole('dialog',{name:'胸部动作列表'}).waitFor();
  await shot('mobile-chest');
  record('Mobile layout still supports model picking and the exercise sheet');
  assert.deepEqual(errors,[]);
  record('No browser exceptions, label errors or shader compilation errors');
  fs.writeFileSync(path.join(OUT,'ui-checks.json'),JSON.stringify({base:BASE,checks,errors},null,2)+'\n');
} finally { await browser.close(); }
