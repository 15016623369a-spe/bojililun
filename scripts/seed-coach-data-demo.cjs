/**
 * 教练数据问答的演示库：「我的」营养资料、近 30 天晨重、饮食和训练，以及伤病限制和动作偏好。
 * 用法：node scripts/seed-coach-data-demo.cjs [数据库路径]，不给路径时建在临时目录，最后打印库的路径。
 * 只用于测试和 PR 截图，全部是虚构数据。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const target = process.argv[2] ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fitcheck-coach-data-')), 'fitness.db');
fs.mkdirSync(path.dirname(target), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(target + suffix, { force: true });
process.env.FITCHECK_DB_PATH = target;
require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true },
  }).outputText,
  filename,
);

const { getDb } = require('../lib/db.ts');
const { todayStr } = require('../lib/core/workout.ts');
const { saveTrainingProfile } = require('../lib/core/training-profile.ts');
const { setExercisePreference } = require('../lib/core/exercise-preferences.ts');
const { saveBatch } = require('../lib/ledger.ts');
const { calcTargets } = require('../lib/nutrition.ts');

const db = getDb();
const today = todayStr();
const day = offset => new Date(Date.parse(today) + offset * 86_400_000).toISOString().slice(0, 10);
const at = (offset, time) => `${day(offset)}T${time}+08:00`;
const base = (offset, time) => ({ confidence: 'exact', raw_text: null, note: null, feeling_tags: [], logged_at: at(offset, time) });

saveTrainingProfile({ setup: true, name: '演示用户', sex: 'male', goal: 'muscle', restriction: '左肩有旧伤，避免过顶推举' });
const profile = { name: '演示用户', sex: 'male', age: 30, height_cm: 178, weight_kg: 72.5, activity: 'moderate', goal: 'bulk', protein_per_kg: 1.8 };
const targets = calcTargets(profile);
db.prepare(`INSERT INTO profile (id, name, sex, age, height_cm, weight_kg, activity, goal, protein_per_kg, target_kcal, target_protein, updated_at)
  VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  profile.name, profile.sex, profile.age, profile.height_cm, profile.weight_kg, profile.activity, profile.goal,
  profile.protein_per_kg, targets.target_kcal, targets.target_protein, `${day(-30)}T00:00:00Z`,
);

// 晨重：隔天称一次，30 天从 72.4 kg 慢慢涨到 73.4 kg
const weights = [];
for (let offset = -29; offset <= 0; offset += 2) {
  const kg = Math.round((72.4 + ((offset + 29) / 29) * 1.0 + (offset % 4 === 0 ? 0.15 : -0.1)) * 10) / 10;
  weights.push({ ...base(offset, '07:20:00'), entry_type: 'body_metrics', summary_title: '晨重', weight_kg: kg, body_fat_pct: null });
}
saveBatch(db, 'local', 'coach-data-demo/weights', 'scale', weights);

// 饮食：30 天里记了 24 天，每天三餐
const meal = (offset, time, title, kcal, protein, carbs, fat) => ({
  ...base(offset, time), confidence: 'estimated', entry_type: 'meal', summary_title: title,
  items: [{ food_name: title, portion_text: '一份', estimated_grams: null, kcal, protein_g: protein, carbs_g: carbs, fat_g: fat, confidence: 'estimated' }],
});
for (let offset = -29; offset <= 0; offset++) {
  if ([-27, -22, -17, -12, -8, -3].includes(offset)) continue;
  const wobble = ((offset * 37) % 7) - 3;
  saveBatch(db, 'local', `coach-data-demo/meals/${offset}`, 'manual', [
    meal(offset, '08:10:00', '燕麦牛奶和鸡蛋', 520 + wobble * 10, 28, 62, 16),
    meal(offset, '12:30:00', '鸡腿饭', 820 + wobble * 25, 38, 98, 27),
    ...(offset === 0 ? [] : [meal(offset, '19:00:00', '牛肉面和青菜', 760 + wobble * 20, 36, 92, 24)]),
  ]);
}

// 训练：推 / 拉为主，腿和肩练得少；卧推重量逐步上去
const move = (name, weight, reps, sets) => ({
  exercise_name: name,
  sets: Array.from({ length: sets }, () => ({ weight_kg: weight, reps, duration_sec: null })),
});
const sessions = [
  [-28, '胸和三头', [move('杠铃卧推', 60, 8, 4), move('上斜卧推', 45, 10, 3), move('绳索下压', 25, 12, 3)]],
  [-26, '背和二头', [move('高位下拉', 50, 10, 4), move('坐姿划船', 45, 12, 3), move('杠铃弯举', 25, 12, 3)]],
  [-23, '腿', [move('腿举', 120, 10, 4), move('罗马尼亚硬拉', 70, 8, 3)]],
  [-21, '胸和三头', [move('杠铃卧推', 62.5, 8, 4), move('上斜卧推', 45, 10, 3), move('绳索下压', 25, 12, 3)]],
  [-19, '背和二头', [move('高位下拉', 52.5, 10, 4), move('坐姿划船', 45, 12, 3), move('杠铃弯举', 25, 12, 3)]],
  [-14, '胸和三头', [move('杠铃卧推', 65, 8, 4), move('上斜卧推', 47.5, 10, 3), move('绳索下压', 27.5, 12, 3)]],
  [-12, '背和二头', [move('高位下拉', 55, 10, 4), move('坐姿划船', 47.5, 12, 3), move('杠铃弯举', 27.5, 10, 3)]],
  [-9, '肩', [move('侧平举', 8, 15, 3), move('反向飞鸟', 8, 15, 3)]],
  [-7, '胸和三头', [move('杠铃卧推', 65, 9, 4), move('哑铃飞鸟', 14, 12, 3), move('绳索下压', 27.5, 12, 3)]],
  [-5, '背和二头', [move('高位下拉', 55, 11, 4), move('杠铃划船', 50, 10, 3), move('杠铃弯举', 27.5, 12, 3)]],
  [-2, '腿', [move('腿举', 130, 10, 4), move('罗马尼亚硬拉', 75, 8, 3)]],
  [0, '胸和三头', [move('杠铃卧推', 67.5, 8, 4), move('上斜卧推', 50, 10, 3), move('绳索下压', 27.5, 12, 3)]],
];
for (const [offset, title, exercises] of sessions) {
  saveBatch(db, 'local', `coach-data-demo/workout/${offset}`, 'manual', [
    { ...base(offset, '18:30:00'), entry_type: 'workout', summary_title: title, exercises },
  ]);
}

const libraryId = name => db.prepare('SELECT id FROM exercise WHERE zh_name = ? ORDER BY id LIMIT 1').get(name)?.id;
for (const [name, preference] of [['杠铃卧推', 'liked'], ['高位下拉', 'liked'], ['杠铃深蹲', 'disliked']]) {
  const id = libraryId(name);
  if (id) setExercisePreference(id, preference);
}

db.close();
console.log(target);
