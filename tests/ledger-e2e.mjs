import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.LEDGER_E2E_URL;
assert.ok(base, 'Set LEDGER_E2E_URL to a server using a fresh temporary SQLite database');
const api = '/api/ledger';
async function request(path, method = 'GET', data) {
  const response = await fetch(base + path, {
    method,
    ...(data ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : {}),
  });
  const content = await response.text();
  assert.ok(response.ok, content);
  return response.headers.get('content-type').includes('json') ? JSON.parse(content) : content;
}
const add = (text) => request(api, 'POST', { source: 'voice', request_id: randomUUID(), text });
const day = async () => (await request(api)).days[0];

await add('喝了一杯250克纯牛奶，做了杠铃卧推还没记组数，早上称体重70公斤。');
let book = await day();
const milk = book.entries.find((e) => e.entry_type === 'meal');
const workout = book.entries.find((e) => e.entry_type === 'workout');
assert.equal(milk.input_method, 'voice');
assert.equal(milk.items[0].nutrition_basis.source, 'tfda');
assert.equal(workout.exercises[0].sets.length, 0);
assert.equal(book.body_metrics[0].weight_kg, 70);
await request(api, 'PATCH', { id: workout.id, index: 0, choice: 4 });
book = await day();
assert.equal(book.daily_summary.totalSets, 4);
assert.match(await request(api + '?format=md'), /卧推/);

await add('晚饭吃了500克鸡腿肉，500克是下锅前生的带骨重量，做成炖鸡腿后肉吃完了。');
book = await day();
const chicken = book.entries.find((e) => e.items.some((i) => i.nutrition_basis?.weight_basis === 'bone_in'));
const item = chicken.items[0];
assert.equal(item.nutrition_basis.food_state, 'raw');
assert.equal(item.nutrition_basis.measured_grams, 500);
assert.ok(item.estimated_grams < 500);
await request(api, 'PATCH', {
  id: chicken.id,
  nutrition_edit: { item_id: item.id, measured_grams: 200, food_state: 'cooked', weight_basis: 'edible' },
});
book = await day();
const updated = book.entries.find((e) => e.id === chicken.id).items[0];
assert.equal(updated.nutrition_basis.reference, 'usda:172389');
assert.equal(updated.estimated_grams, 200);
assert.equal(book.daily_summary.intake.kcal, updated.kcal + milk.items[0].kcal);
const md = await request(api + '?format=md');
assert.match(md, /usda:172389/);
assert.ok(md.includes('|' + book.daily_summary.intake.kcal + '|'));
assert.ok(
  (await request('/review?period=day')).includes(`蛋白质 <!-- -->${book.daily_summary.intake.protein_g}`),
);
assert.ok((await request('/log')).includes('熟重可食部分约 200 g'));
console.log(
  'Passed: mixed voice transcript, workout completion, raw bone-in to cooked edible edit, and page/JSON/Markdown parity',
);
