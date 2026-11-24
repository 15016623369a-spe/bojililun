const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fitcheck-coach-demo-'));
process.env.FITCHECK_DB_PATH = path.join(directory, 'fitness.db');
require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,
  filename,
);

const { getDb } = require('../lib/db.ts');
const { todayStr } = require('../lib/core/workout.ts');
const { saveTrainingProfile } = require('../lib/core/training-profile.ts');
const { saveBatch } = require('../lib/ledger.ts');
const { upsertMemory } = require('../lib/memory.ts');

const today = todayStr();
const date = offset => new Date(Date.parse(today) + offset * 86_400_000).toISOString().slice(0, 10);
const base = (offset, time) => ({
  confidence: 'exact',
  raw_text: null,
  note: null,
  feeling_tags: [],
  logged_at: `${date(offset)}T${time}+08:00`,
});
const workout = (offset, reps) => ({
  ...base(offset, '18:10:00'),
  entry_type: 'workout',
  summary_title: '杠铃卧推与高位下拉',
  exercises: [
    { exercise_name: '杠铃卧推', sets: [{ weight_kg: 50, reps, duration_sec: null }] },
    { exercise_name: '高位下拉', sets: [{ weight_kg: 30, reps: 10, duration_sec: null }] },
  ],
});
const meal = (offset, title, name, kcal, protein) => ({
  ...base(offset, '12:35:00'),
  confidence: 'estimated',
  entry_type: 'meal',
  summary_title: title,
  items: [{
    food_name: name, portion_text: '一份', estimated_grams: null, kcal,
    protein_g: protein, carbs_g: null, fat_g: null, confidence: 'estimated',
  }],
});

saveTrainingProfile({ setup: true, name: '教练测试用户', goal: 'muscle' });
upsertMemory({ kind: 'preference', key: 'coach-fixture:food', content: '点外卖时偏好清淡口味，不喜欢鸡蛋。', importance: 4 });
saveBatch(getDb(), 'local', 'coach-fixture-v1', 'manual', [
  workout(-21, 6),
  workout(-4, 7),
  workout(0, 8),
  meal(-2, '豆腐盖饭', '豆腐盖饭', 490, 25),
  meal(0, '午餐 · 牛肉面', '牛肉面', 560, 29),
]);

console.log(process.env.FITCHECK_DB_PATH);
