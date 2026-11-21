import type { DatabaseSync } from 'node:sqlite';
import dictionary from '../data/exercises-seed.json';
import {
  formatWorkoutSummary,
  type Item,
  type Movement,
  type Confidence,
  type SetDetail,
} from './calculations';
export type Source = 'manual' | 'photo' | 'voice' | 'scale';
export interface Draft {
  entry_type: 'meal' | 'workout' | 'plan_draft' | 'body_metrics';
  summary_title: string;
  confidence: Confidence;
  raw_text: string | null;
  note: string | null;
  feeling_tags: string[];
  logged_at: string;
  items?: Item[];
  exercises?: Movement[];
  weight_kg?: number;
  body_fat_pct?: number | null;
}
export type Parsed = { route: 'qa'; question: string } | { route: 'record'; records: Draft[] };
export const localDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TZ || 'Asia/Shanghai' }).format(new Date(iso));
export function transaction<T>(db: DatabaseSync, fn: () => T) {
  db.exec('SAVEPOINT ledger_write');
  try {
    const result = fn();
    db.exec('RELEASE ledger_write');
    return result;
  } catch (e) {
    db.exec('ROLLBACK TO ledger_write; RELEASE ledger_write');
    throw e;
  }
}
export function initLedger(db: DatabaseSync) {
  db.exec('PRAGMA foreign_keys=ON');
  transaction(db, () => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS exercises(id TEXT PRIMARY KEY,name_zh TEXT NOT NULL,aliases TEXT NOT NULL,primary_muscles TEXT NOT NULL,secondary_muscles TEXT NOT NULL,gif_url TEXT,cues TEXT);
    CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL,date TEXT NOT NULL,entry_type TEXT NOT NULL CHECK(entry_type IN ('meal','workout','plan_draft')),logged_at TEXT NOT NULL,input_method TEXT CHECK(input_method IN ('voice','photo','manual')),confidence TEXT NOT NULL CHECK(confidence IN ('estimated','exact')),raw_text TEXT,summary_title TEXT NOT NULL,feeling_tags TEXT NOT NULL,note TEXT,is_deleted INTEGER NOT NULL DEFAULT 0,actions TEXT NOT NULL DEFAULT '[]',request_key TEXT NOT NULL, UNIQUE(user_id,request_key));
    CREATE TABLE IF NOT EXISTS body_metrics(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL,date TEXT NOT NULL,logged_at TEXT NOT NULL,weight_kg REAL NOT NULL CHECK(weight_kg>0),body_fat_pct REAL CHECK(body_fat_pct BETWEEN 0 AND 100),source TEXT CHECK(source IN ('voice','scale','manual')),confidence TEXT NOT NULL CHECK(confidence IN ('exact','estimated')),note TEXT,raw_text TEXT,feeling_tags TEXT NOT NULL,request_key TEXT NOT NULL, UNIQUE(user_id,request_key));
    CREATE TABLE IF NOT EXISTS meal_items(id INTEGER PRIMARY KEY,entry_id INTEGER NOT NULL REFERENCES entries(id),food_name TEXT NOT NULL,portion_text TEXT,estimated_grams REAL,kcal INTEGER,protein_g REAL,carbs_g REAL,fat_g REAL,confidence TEXT NOT NULL CHECK(confidence IN ('exact','estimated')));
    CREATE TABLE IF NOT EXISTS workout_sets(id INTEGER PRIMARY KEY,entry_id INTEGER NOT NULL REFERENCES entries(id),exercise_id TEXT REFERENCES exercises(id),exercise_name TEXT NOT NULL,action_index INTEGER NOT NULL,set_order INTEGER NOT NULL,weight_kg REAL,reps INTEGER,duration_sec INTEGER,UNIQUE(entry_id,action_index,set_order));
    CREATE INDEX IF NOT EXISTS ledger_date ON entries(user_id,date,logged_at);
    CREATE INDEX IF NOT EXISTS metric_date ON body_metrics(user_id,date,logged_at);
    CREATE INDEX IF NOT EXISTS ledger_ex_history ON workout_sets(exercise_id,entry_id);
    CREATE TABLE IF NOT EXISTS ledger_requests(user_id TEXT,request_id TEXT,PRIMARY KEY(user_id,request_id));`);
    const insert = db.prepare('INSERT OR IGNORE INTO exercises VALUES(?,?,?,?,?,?,?)');
    for (const e of dictionary)
      insert.run(
        e.id,
        e.name_zh,
        JSON.stringify(e.aliases),
        JSON.stringify(e.primary_muscles),
        JSON.stringify(e.secondary_muscles),
        e.gif_url,
        JSON.stringify(e.cues),
      );
  });
}
function checked(n: unknown, integer = false) {
  if (n == null) return null;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e7 || (integer && !Number.isInteger(n)))
    throw Error('数值无效');
  return n;
}
function writeSets(db: DatabaseSync, id: number, index: number, m: Movement) {
  const stmt = db.prepare(
    'INSERT INTO workout_sets(entry_id,exercise_id,exercise_name,action_index,set_order,weight_kg,reps,duration_sec) VALUES(?,?,?,?,?,?,?,?)',
  );
  m.sets.forEach((s, i) =>
    stmt.run(
      id,
      m.exercise_id,
      m.exercise_name,
      index,
      i + 1,
      checked(s.weight_kg),
      checked(s.reps, true),
      checked(s.duration_sec, true),
    ),
  );
}
export function writeItems(db: DatabaseSync, id: number, items: Item[]) {
  if (!Array.isArray(items) || !items.length) throw Error('缺少饮食明细');
  const insert = db.prepare(
    'INSERT INTO meal_items(entry_id,food_name,portion_text,estimated_grams,kcal,protein_g,carbs_g,fat_g,confidence) VALUES(?,?,?,?,?,?,?,?,?)',
  );
  for (const i of items) {
    if (!i.food_name?.trim()) throw Error('缺少食物名称');
    insert.run(
      id,
      i.food_name,
      i.portion_text ?? null,
      checked(i.estimated_grams),
      checked(i.kcal, true),
      checked(i.protein_g),
      checked(i.carbs_g),
      checked(i.fat_g),
      i.confidence,
    );
  }
}
export function saveBatch(
  db: DatabaseSync,
  user: string,
  request: string,
  source: Source | null,
  records: Draft[],
) {
  if (!request || !Array.isArray(records) || !records.length || records.length > 100)
    throw Error('记录批次无效');
  return transaction(db, () => {
    if (!db.prepare('INSERT OR IGNORE INTO ledger_requests VALUES(?,?)').run(user, request).changes) return;
    records.forEach((r, index) => {
      if (
        typeof r.summary_title !== 'string' ||
        !r.summary_title.trim() ||
        !(r.note === null || typeof r.note === 'string') ||
        !(r.raw_text === null || typeof r.raw_text === 'string')
      )
        throw Error('记录内容无效');
      const stamp = new Date(r.logged_at).toISOString(),
        date = localDay(stamp),
        key = request + '/' + index;
      if (!Array.isArray(r.feeling_tags) || !r.feeling_tags.every((t) => typeof t === 'string'))
        throw Error('体感标签无效');
      if (r.entry_type === 'body_metrics') {
        db.prepare(
          'INSERT INTO body_metrics(user_id,date,logged_at,weight_kg,body_fat_pct,source,confidence,note,raw_text,feeling_tags,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
          user,
          date,
          stamp,
          checked(r.weight_kg),
          checked(r.body_fat_pct),
          source,
          r.confidence,
          r.note,
          r.raw_text,
          JSON.stringify(r.feeling_tags),
          key,
        );
        return;
      }
      const actions = (r.exercises ?? []).map((m) => {
        const e = dictionary.find(
          (e) =>
            e.id === m.exercise_id || e.name_zh === m.exercise_name || e.aliases.includes(m.exercise_name),
        );
        if (!m.exercise_name?.trim() || !Array.isArray(m.sets)) throw Error('动作明细无效');
        return {
          exercise_id: e?.id ?? null,
          exercise_name: e?.name_zh ?? m.exercise_name,
          primary_muscles: e?.primary_muscles ?? [],
          secondary_muscles: e?.secondary_muscles ?? [],
          sets: m.sets,
        };
      });
      if (r.entry_type === 'workout' && !actions.length) throw Error('缺少动作');
      const id = Number(
        db
          .prepare(
            'INSERT INTO entries(user_id,date,entry_type,logged_at,input_method,confidence,raw_text,summary_title,feeling_tags,note,actions,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            user,
            date,
            r.entry_type,
            stamp,
            source,
            r.confidence,
            r.raw_text,
            r.summary_title,
            JSON.stringify(r.feeling_tags),
            r.note,
            JSON.stringify(actions.map(({ sets, ...m }) => m)),
            key,
          ).lastInsertRowid,
      );
      if (r.entry_type === 'meal') writeItems(db, id, r.items ?? []);
      actions.forEach((m, i) => writeSets(db, id, i, m));
    });
  });
}
export function getLastExerciseRecord(
  db: DatabaseSync,
  user: string,
  exerciseId: string,
  beforeTime: string,
) {
  const row = db
    .prepare(
      "SELECT e.id,e.date,s.action_index FROM entries e JOIN workout_sets s ON s.entry_id=e.id WHERE e.user_id=? AND e.entry_type='workout' AND e.is_deleted=0 AND s.exercise_id=? AND e.logged_at<? ORDER BY e.logged_at DESC,e.id DESC,s.action_index DESC LIMIT 1",
    )
    .get(user, exerciseId, beforeTime);
  if (!row) return null;
  const sets = db
    .prepare(
      'SELECT weight_kg,reps,duration_sec FROM workout_sets WHERE entry_id=? AND action_index=? ORDER BY set_order',
    )
    .all(row.id, row.action_index) as unknown as SetDetail[];
  const days = (Date.parse(localDay(beforeTime)) - Date.parse(String(row.date))) / 86400000;
  return { sets, label: `上次 · ${formatWorkoutSummary(sets)}（${days}天前）` };
}
export function fillSets(
  db: DatabaseSync,
  user: string,
  id: number,
  index: number,
  choice: 3 | 4 | 5 | 'last' | 'skip',
) {
  transaction(db, () => {
    const row = db
      .prepare("SELECT * FROM entries WHERE id=? AND user_id=? AND entry_type='workout' AND is_deleted=0")
      .get(id, user);
    if (!row) throw Error('训练记录不存在');
    const actions = JSON.parse(String(row.actions)) as Movement[],
      m = actions[index];
    if (!m) throw Error('动作不存在');
    if (
      m.skipped ||
      db.prepare('SELECT 1 FROM workout_sets WHERE entry_id=? AND action_index=?').get(id, index)
    )
      return;
    if (choice === 'skip') {
      m.skipped = true;
      db.prepare('UPDATE entries SET actions=? WHERE id=?').run(JSON.stringify(actions), id);
      return;
    }
    const sets =
      choice === 'last'
        ? getLastExerciseRecord(db, user, m.exercise_id ?? '', String(row.logged_at))?.sets
        : [3, 4, 5].includes(choice)
          ? Array.from({ length: choice }, () => ({ weight_kg: null, reps: null, duration_sec: null }))
          : null;
    if (!sets?.length) throw Error('没有可用组数');
    writeSets(db, id, index, { ...m, sets });
  });
}
