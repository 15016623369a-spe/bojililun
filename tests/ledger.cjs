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
  const key = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  t.after(() => {
    if (key) process.env.DEEPSEEK_API_KEY = key;
  });
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
test('保留模型给出的单项营养估值和份量依据', async (t) => {
  t.mock.method(global, 'fetch', async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              route: 'record',
              records: [
                {
                  entry_type: 'meal',
                  summary_title: '鸡汤',
                  raw_text: null,
                  note: null,
                  feeling_tags: [],
                  confidence: 'estimated',
                  items: [
                    {
                      food_name: '未收录的自制浓汤',
                      portion_text: '暂按一小碗',
                      estimated_grams: 180,
                      kcal: 365,
                      protein_g: 4,
                      carbs_g: 0.5,
                      fat_g: 2,
                      confidence: 'estimated',
                    },
                  ],
                },
              ],
            }),
          },
        },
      ],
    }),
  );
  const key = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test';
  t.after(() => {
    if (key) process.env.DEEPSEEK_API_KEY = key;
    else delete process.env.DEEPSEEK_API_KEY;
  });
  const result = await parseInput('喝了鸡汤', undefined, 'manual');
  assert.equal(result.records[0].items[0].protein_g, 4);
  assert.equal(result.records[0].items[0].kcal, 36);
  assert.equal(result.records[0].items[0].portion_text, '暂按一小碗');
});
test('繁简别名命中同一来源，带骨生重转为可食重，改熟重只用本地库', () => {
  const { estimateNutrition, editNutrition } = require('../lib/ledger-nutrition.ts');
  const raw = estimateNutrition(
    { ...item, food_name: '雞腿', estimated_grams: 500, food_state: 'raw', weight_basis: 'bone_in' },
    true,
  );
  assert.equal(raw.nutrition_basis.reference, 'tfda:I0404501');
  assert.equal(raw.estimated_grams, 333.5);
  const cooked = editNutrition(raw, { measured_grams: 200, food_state: 'cooked', weight_basis: 'edible' });
  assert.equal(cooked.nutrition_basis.reference, 'usda:172389');
  assert.equal(cooked.estimated_grams, 200);
  assert.notEqual(cooked.protein_g, raw.protein_g);
  const db = setup();
  store.saveBatch(db, user, 'portion', 'voice', [
    { ...base, entry_type: 'meal', summary_title: '鸡腿', items: [cooked] },
  ]);
  const book = ex.exportJournal(db, user, day, day);
  assert.equal(book.days[0].daily_summary.intake.protein_g, cooked.protein_g);
  assert.match(ex.renderMarkdown(book), /usda:172389/);
  db.close();
});
test('已存在的 meal_items 表可重复迁移，旧明细保留', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    "CREATE TABLE meal_items(id INTEGER PRIMARY KEY,food_name TEXT); INSERT INTO meal_items VALUES(7,'旧数据')",
  );
  store.initLedger(db);
  store.initLedger(db);
  assert.equal(db.prepare('SELECT food_name FROM meal_items WHERE id=7').get().food_name, '旧数据');
  assert.equal(
    db
      .prepare('PRAGMA table_info(meal_items)')
      .all()
      .filter((c) => c.name === 'nutrition_basis').length,
    1,
  );
  db.close();
});

test('饮食快选过滤低影响问题和不可计算的补丁', () => {
  const { estimateNutrition } = require('../lib/ledger-nutrition.ts');
  const { prepareMealPick } = require('../lib/quick-pick.ts');
  const chicken = estimateNutrition(
    { ...item, food_name: '鸡肉', estimated_grams: 500, food_state: 'cooked', weight_basis: 'edible' },
    true,
  );
  const make = (edit) => ({
    kind: 'meal',
    question: '500 克指什么？',
    options: [
      { label: '鸡肉重', edits: [] },
      { label: '整份重', edits: [edit] },
    ],
  });
  assert.equal(prepareMealPick(make({ item_index: 0, measured_grams: 499 }), [chicken]), null);
  assert.equal(prepareMealPick(make({ item_index: 9, measured_grams: 150 }), [chicken]), null);
  assert.ok(prepareMealPick(make({ item_index: 0, measured_grams: 150 }), [chicken]));
});

test('快选默认落卡，选中原地重算，跳过及重复请求不会改写', () => {
  const { estimateNutrition } = require('../lib/ledger-nutrition.ts');
  const db = setup();
  const chicken = estimateNutrition(
    { ...item, food_name: '鸡肉', estimated_grams: 500, food_state: 'cooked', weight_basis: 'edible' },
    true,
  );
  const meal = {
    ...base,
    summary_title: '鸡肉饭',
    entry_type: 'meal',
    items: [chicken],
    quick_pick: {
      kind: 'meal',
      question: '500 克是什么重量？',
      options: [
        { label: '鸡肉重', edits: [] },
        { label: '整份重', edits: [{ item_index: 0, measured_grams: 150 }] },
      ],
    },
  };
  store.saveBatch(db, user, 'pick', 'voice', [meal, meal]);
  const read = () => ex.exportJournal(db, user, day, day);
  const [first, second] = read().days[0].entries;
  assert.equal(first.items[0].estimated_grams, 500);
  assert.equal(store.readCardPick(db, user, first.id).options.length, 2);
  assert.throws(() => store.chooseCardPick(db, user, first.id, '999'));
  store.chooseCardPick(db, user, first.id, '1');
  store.chooseCardPick(db, user, first.id, '0');
  store.chooseCardPick(db, user, second.id, 'skip');
  const result = read();
  assert.equal(result.days[0].entries[0].items[0].id, first.items[0].id);
  assert.equal(result.days[0].entries[0].items[0].estimated_grams, 150);
  assert.deepEqual(result.days[0].entries[1], second);
  assert.equal(store.readCardPick(db, user, first.id), null);
  assert.equal(store.readCardPick(db, user, second.id), null);
  assert.match(ex.renderMarkdown(result), /鸡肉饭 · 整份重/);
  assert.equal(
    result.days[0].daily_summary.intake.kcal,
    result.days[0].entries.reduce((s, e) => s + e.items[0].kcal, 0),
  );
  db.close();
});

test('训练每张卡最多一个快选，收起后不再追问另一动作', () => {
  const db = setup();
  const workout = bench();
  workout.exercises.push({ exercise_name: '深蹲', sets: [] });
  workout.quick_pick = {
    kind: 'workout',
    question: '深蹲做了几组？',
    exercise_index: 1,
    options: [
      { label: '2组', sets: 2 },
      { label: '4组', sets: 4 },
    ],
  };
  store.saveBatch(db, user, 'multi', 'voice', [workout]);
  const read = () => ex.exportJournal(db, user, day, day).days[0];
  const id = read().entries[0].id;
  assert.equal(store.readCardPick(db, user, id).question, '深蹲做了几组？');
  store.chooseCardPick(db, user, id, '1:2');
  assert.equal(read().entries[0].exercises[1].sets.length, 2);
  assert.equal(read().entries[0].exercises[0].sets.length, 0);
  assert.equal(store.readCardPick(db, user, id), null);
  db.close();
});
test('本地解析：长名优先，词典外动作照原话记，份量跟着食物走', async (t) => {
  const keys = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, AI_API_KEY: process.env.AI_API_KEY };
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.AI_API_KEY;
  t.after(() => {
    for (const [k, v] of Object.entries(keys)) if (v) process.env[k] = v;
  });
  const parse = async (text) => (await parseInput(text, undefined, 'manual')).records;
  const moves = async (text) =>
    (await parse(text)).flatMap((r) => r.exercises ?? []).map((m) => [m.exercise_name, m.exercise_id, m.sets.length]);
  // 「哑铃卧推」「上斜卧推」里的「卧推」不再多记一个杠铃卧推
  assert.deepEqual(await moves('哑铃卧推 30公斤 10次 3组'), [['哑铃卧推', 'dumbbell-bench-press', 3]]);
  assert.deepEqual(await moves('上斜卧推 50公斤 8次 3组'), [['上斜卧推', 'barbell-incline-bench-press', 3]]);
  // 词典外的动作不套用词典里的近似动作，按原话记下
  assert.deepEqual(await moves('哈克深蹲 80公斤 10次 4组'), [['哈克深蹲', null, 4]]);
  assert.deepEqual(await moves('哑铃划船 25公斤 12次 3组'), [['哑铃划船', null, 3]]);
  assert.deepEqual(await moves('器械推胸 40公斤 12次 3组'), [['器械推胸', null, 3]]);
  // 前后的口头说法不影响词典动作
  assert.deepEqual(await moves('早上做了深蹲 100公斤 5次 5组'), [['杠铃深蹲', 'barbell-full-squat', 5]]);
  assert.deepEqual(await moves('深蹲卧推各3组'), [['杠铃深蹲', 'barbell-full-squat', 3], ['杠铃卧推', 'barbell-bench-press', 3]]);
  // 负重不是体重
  const pull = await parse('负重20公斤引体向上 5次 3组');
  assert.deepEqual(pull.map((r) => r.entry_type), ['workout']);
  assert.equal(pull[0].exercises[0].exercise_name, '引体向上');
  assert.equal((await parse('体重 72.5'))[0].weight_kg, 72.5);
  // 份量写在食物前或后都归到对应的食物
  const grams = async (text) => (await parse(text)).flatMap((r) => r.items ?? []).map((i) => [i.food_name, i.estimated_grams]);
  assert.deepEqual(await grams('午饭吃了米饭 200克 鸡胸肉 150克'), [['米饭', 200], ['鸡胸肉', 150]]);
  assert.deepEqual(await grams('午饭吃了200克米饭和150克鸡胸肉'), [['米饭', 200], ['鸡胸肉', 150]]);
  assert.deepEqual(await grams('鸡胸肉 150g 米饭 100g'), [['鸡胸肉', 150], ['米饭', 100]]);
  // 词典外的动作存进手账后名字不变
  const db = setup();
  const records = await parse('哈克深蹲 80公斤 10次 4组');
  records.forEach((r) => (r.logged_at = time));
  store.saveBatch(db, user, 'hack', 'manual', records);
  const card = ex.exportJournal(db, user, day, day).days[0].entries[0];
  assert.deepEqual([card.exercises[0].exercise_name, card.exercises[0].sets.length], ['哈克深蹲', 4]);
  db.close();
});
