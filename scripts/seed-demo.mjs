/**
 * 给复刻稿灌一份演示数据（默认是 11月18日 周三 的「午餐 + 背部训练」）。
 * 用法：
 *   node scripts/seed-demo.mjs            # 写入今天
 *   node scripts/seed-demo.mjs --clear    # 删掉脚本写过的东西
 *
 * 标记：meal_log.photo_path = 'demo:seed'，session.note = 'demo:seed'
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const DB = path.resolve('data/fitness.db');
const TZ = process.env.APP_TZ || 'Asia/Shanghai';
const TZ_OFFSET = '+08:00';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const db = new DatabaseSync(DB);

const clear = process.argv.includes('--clear');
const reset = process.argv.includes('--reset');

if (reset) {
  const ids = db.prepare('SELECT id FROM session WHERE date = ?').all(today).map((r) => r.id);
  for (const id of ids) db.prepare('DELETE FROM session_set WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM session WHERE date = ?').run(today);
  db.prepare('DELETE FROM meal_log WHERE date = ?').run(today);
  console.log(`已清空 ${today} 的全部记录`);
}

const sessions = db
  .prepare("SELECT id FROM session WHERE note LIKE 'demo:%' AND date = ?")
  .all(today)
  .map((r) => r.id);
for (const id of sessions) {
  db.prepare('DELETE FROM session_set WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM session WHERE id = ?').run(id);
}
db.prepare("DELETE FROM meal_log WHERE photo_path = 'demo:seed' AND date = ?").run(today);

if (clear) {
  console.log(`已清掉 ${today} 的演示记录`);
  process.exit(0);
}

/* ------------------------------ 午餐 ------------------------------ */

const mealItems = [
  { name: '牛肉面', grams: 400, kcal_100g: 130, protein_100g: 6, carb_100g: 22, fat_100g: 3, matched: false },
  { name: '卤蛋', grams: 55, kcal_100g: 144, protein_100g: 13.3, carb_100g: 2.8, fat_100g: 8.8, matched: true },
  { name: '无糖乌龙茶', grams: 330, kcal_100g: 0, protein_100g: 0, carb_100g: 0, fat_100g: 0, matched: true },
];

const k = (it) => it.grams / 100;
const kcal = Math.round(mealItems.reduce((a, it) => a + it.kcal_100g * k(it), 0));
const protein = Math.round(mealItems.reduce((a, it) => a + it.protein_100g * k(it), 0) * 10) / 10;
const carb = Math.round(mealItems.reduce((a, it) => a + it.carb_100g * k(it), 0) * 10) / 10;
const fat = Math.round(mealItems.reduce((a, it) => a + it.fat_100g * k(it), 0) * 10) / 10;

db.prepare(
  `INSERT INTO meal_log (date, meal_type, photo_path, items_json, kcal, protein, carb, fat, created_at)
   VALUES (?, 'lunch', 'demo:seed', ?, ?, ?, ?, ?, ?)`,
).run(today, JSON.stringify(mealItems), kcal, protein, carb, fat, new Date(`${today}T12:10:00${TZ_OFFSET}`).toISOString());

/* ------------------------------ 背部训练 20 分钟 ------------------------------ */

const pick = (kw) => {
  const row = db
    .prepare('SELECT id, zh_name, body_part, target FROM exercise WHERE zh_name LIKE ? ORDER BY length(zh_name) ASC LIMIT 1')
    .get(`%${kw}%`);
  return row ?? null;
};

const exercises = [
  { spoken: '高位下拉', ex: pick('高位下拉') },
  { spoken: '划船', ex: pick('划船') },
];

const started = new Date(`${today}T19:40:00${TZ_OFFSET}`);
const ended = new Date(started.getTime() + 20 * 60000);

db.prepare('INSERT INTO session (date, started_at, ended_at, note) VALUES (?, ?, ?, ?)').run(
  today,
  started.toISOString(),
  ended.toISOString(),
  'demo:seed',
);
const sessionId = db.prepare('SELECT id FROM session ORDER BY id DESC LIMIT 1').get().id;

exercises.forEach((x, i) => {
  db.prepare(
    `INSERT INTO session_set (session_id, plan_item_id, exercise_id, exercise_name, body_part, target, set_index, weight, reps, duration_sec, rest_sec, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
  ).run(
    sessionId,
    x.ex?.id ?? `demo-${i}`,
    x.spoken,
    x.ex?.body_part ?? 'back',
    x.ex?.target ?? '',
    i + 1,
    new Date().toISOString(),
  );
});

console.log(`已写入 ${today}：午餐（${kcal} kcal）+ 背部训练 20 分钟（session #${sessionId}）`);
