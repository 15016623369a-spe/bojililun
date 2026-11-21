const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript');
require.extensions['.ts'] = (mod, name) =>
  mod._compile(
    ts.transpileModule(fs.readFileSync(name, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    name,
  );
const calc = require('../lib/calculations.ts'),
  store = require('../lib/ledger.ts'),
  ex = require('../lib/export.ts'),
  { parseInput } = require('../lib/ledger-parse.ts');
const user = 'local',
  time = '2026-11-21T04:00:00Z',
  day = '2026-11-21';
const base = { logged_at: time, note: '外食', confidence: 'exact', raw_text: '原话', feeling_tags: ['轻松'] };
function setup() {
  const db = new DatabaseSync(':memory:');
  store.initLedger(db);
  return db;
}
const item = {
  food_name: '饭',
  kcal: 665,
  protein_g: 0.1,
  carbs_g: 2.35,
  fat_g: null,
  confidence: 'estimated',
};
const bench = (sets = []) => ({
  ...base,
  entry_type: 'workout',
  summary_title: '卧推',
  exercises: [{ exercise_name: '卧推', sets }],
});
const set = { weight_kg: 70, reps: 8, duration_sec: null };
test('营养小数、缺失和展示', () => {
  const n = calc.calcMealTotals([item, item, item]);
  assert.equal(n.protein_g, 0.3);
  assert.equal(n.fat_g, null);
  assert.deepEqual(n.incomplete_fields, ['fat_g']);
  assert.ok(n.hasEstimates);
  assert.equal(calc.formatDisplayKcal(665), '≈ 670 千卡');
});
test('组序、容量和折叠', () => {
  assert.equal(calc.formatWorkoutSummary(Array(4).fill(set)), '70kg × 8 · 4组');
  assert.equal(
    calc.formatWorkoutSummary([{ ...set, weight_kg: 60, reps: 12 }, set, set, set]),
    '60kg×12 / 70kg×8×3',
  );
  assert.deepEqual(calc.calcWorkoutTotals([set, { ...set, reps: null }]), {
    totalSets: 2,
    totalVolumeKg: 560,
  });
});
test('每天第一次（乱序输入）、七个自然日、区间之前的测量', () => {
  const metric = (stamp, w) => ({ date: stamp.slice(0, 10), logged_at: stamp + 'Z', weight_kg: w });
  const t = calc.calcWeightTrend(
    [
      metric('2026-11-21T12:00', 82),
      metric('2026-11-21T07:00', 70),
      metric('2026-11-15T07:00', 72),
      metric('2026-11-14T08:00', 90),
    ],
    day,
    day,
  );
  assert.deepEqual(t.points, [{ date: day, weight_kg: 70, days: 2, average7: 71 }]);
});
test('混合拆单、事务、重试、导出', async (t) => {
  const key=process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  t.after(()=>{if(key)process.env.DEEPSEEK_API_KEY=key;});
  const db = setup();
  const p = await parseInput('卧推四组，练完喝了牛奶，早上称了70公斤', undefined, 'voice');
  assert.deepEqual(
    p.records.map((r) => r.entry_type),
    ['workout', 'meal', 'body_metrics'],
  );
  p.records.forEach((r) => (r.logged_at = time));
  for (let n = 0; n < 2; n++) store.saveBatch(db, user, 'one', 'voice', p.records);
  assert.throws(() =>
    store.saveBatch(db, user, 'bad', 'voice', [
      bench(),
      { ...base, entry_type: 'body_metrics', weight_kg: -1 },
    ]),
  );
  const book = ex.exportJournal(db, user, day, day);
  assert.equal(book.days[0].entries.length, 2);
  assert.equal(book.days[0].body_metrics.length, 1);
  assert.equal(book.days[0].daily_summary.totalSets, 4);
  assert.match(ex.renderMarkdown(book), /牛奶/);
  db.close();
});
test('缺组按三组热力，历史限定用户和时间，补组与跳过幂等', () => {
  const db = setup();
  store.saveBatch(db, user, 'old', 'manual', [
    { ...bench(Array(4).fill(set)), logged_at: '2026-11-16T04:00:00Z' },
  ]);
  store.saveBatch(db, user, 'new', 'voice', [bench(), bench()]);
  const read = () => ex.exportJournal(db, user, day, day).days[0];
  const [a, b] = read().entries;
  assert.equal(read().daily_summary.totalSets, 0);
  const heat = () => calc.calcMuscleHeatmap(read().entries, 'day').chest_mid.score;
  function calcMuscleHeatmap(...args) {
    return calc.calcMuscleHeatmap(...args);
  }
  assert.equal(heat(), 6);
  assert.match(store.getLastExerciseRecord(db, user, 'barbell-bench-press', time).label, /5天前/);
  assert.equal(store.getLastExerciseRecord(db, 'other', 'barbell-bench-press', time), null);
  store.fillSets(db, user, a.id, 0, 'last');
  store.fillSets(db, user, a.id, 0, 5);
  store.fillSets(db, user, b.id, 0, 'skip');
  assert.equal(read().daily_summary.totalSets, 4);
  assert.equal(heat(), 7);
  assert.ok(read().entries[1].exercises[0].skipped);
  db.prepare('UPDATE entries SET is_deleted=1 WHERE id=?').run(a.id);
  assert.equal(heat(), 3);
  db.close();
});
test('日周月阈值、草稿和撤销', () => {
  const m = { ...bench().exercises[0], primary_muscles: ['abs'], secondary_muscles: ['obliques'] };
  const w = { entry_type: 'workout', exercises: [m] };
  for (const [p, level] of [
    ['day', 3],
    ['week', 2],
    ['month', 1],
  ]) {
    const h = calc.calcMuscleHeatmap([w, { ...w, is_deleted: true }, { ...w, entry_type: 'plan_draft' }], p);
    assert.equal(h.abs.level, level);
    assert.equal(h.obliques.score, 1.2);
    assert.equal(h.quads.level, 0);
  }
});
test('补指定组数、编辑删除食材后 JSON 与 Markdown 同步', () => {
  const db = setup();
  store.saveBatch(db, user, '1', 'manual', [
    bench(),
    { ...base, entry_type: 'meal', summary_title: '午饭', items: [item, item] },
  ]);
  const read = () => ex.exportJournal(db, user, day, day);
  let [w, m] = read().days[0].entries;
  store.fillSets(db, user, w.id, 0, 5);
  assert.equal(read().days[0].daily_summary.totalSets, 5);
  db.prepare('DELETE FROM meal_items WHERE id=?').run(m.items[0].id);
  db.prepare('UPDATE meal_items SET kcal=100 WHERE entry_id=?').run(m.id);
  const book = read();
  assert.equal(book.days[0].daily_summary.intake.kcal, 100);
  assert.match(ex.renderMarkdown(book), /\|100\|/);
});
test('重复迁移，旧入口更新和删除', () => {
  const tmp = fs.mkdtempSync(require('node:os').tmpdir() + '/fit-ledger-');
  process.env.FITCHECK_DB_PATH = path.join(tmp, 'demo.db');
  const { getDb } = require('../lib/db.ts'),
    { installBridge, flushLegacy } = require('../lib/ledger-legacy.ts');
  const db = getDb();
  db.prepare('INSERT INTO weight_entry(date,weight) VALUES(?,?)').run(day, 70);
  flushLegacy(db);
  installBridge(db);
  flushLegacy(db);
  assert.equal(db.prepare('SELECT count(*) n FROM body_metrics').get().n, 1);
  db.prepare('UPDATE weight_entry SET weight=71 WHERE date=?').run(day);
  flushLegacy(db);
  assert.equal(db.prepare('SELECT weight_kg FROM body_metrics').get().weight_kg, 71);
  db.prepare('DELETE FROM weight_entry WHERE date=?').run(day);
  flushLegacy(db);
  assert.equal(db.prepare('SELECT count(*) n FROM body_metrics').get().n, 0);
  db.close();
  fs.rmSync(tmp, { recursive: true });
});
