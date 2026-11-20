import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FOODS } from './foods';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.resolve(process.env.FITCHECK_DB_PATH || path.join(DATA_DIR, 'fitness.db'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// Increment when the schema or column migrations change. Next.js keeps globalThis across hot reloads.
const SCHEMA_REVISION = 6;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '我',
  sex TEXT NOT NULL DEFAULT 'male',
  age INTEGER NOT NULL DEFAULT 25,
  height_cm REAL NOT NULL DEFAULT 175,
  weight_kg REAL NOT NULL DEFAULT 70,
  activity TEXT NOT NULL DEFAULT 'light',
  goal TEXT NOT NULL DEFAULT 'maintain',
  protein_per_kg REAL NOT NULL DEFAULT 1.8,
  target_kcal INTEGER NOT NULL DEFAULT 2000,
  target_protein INTEGER NOT NULL DEFAULT 120,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS food_cache (
  name TEXT PRIMARY KEY,
  aliases TEXT NOT NULL DEFAULT '',
  kcal_100g REAL NOT NULL,
  protein_100g REAL NOT NULL DEFAULT 0,
  carb_100g REAL NOT NULL DEFAULT 0,
  fat_100g REAL NOT NULL DEFAULT 0,
  default_grams REAL NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS meal_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  photo_path TEXT,
  items_json TEXT NOT NULL,
  kcal REAL NOT NULL,
  protein REAL NOT NULL DEFAULT 0,
  carb REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meal_date ON meal_log(date);

CREATE TABLE IF NOT EXISTS draft (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercise (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zh_name TEXT NOT NULL DEFAULT '',
  body_part TEXT NOT NULL,
  equipment TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  muscle_group TEXT NOT NULL DEFAULT '',
  secondary_muscles TEXT NOT NULL DEFAULT '',
  zh TEXT NOT NULL DEFAULT '',
  zh_steps TEXT NOT NULL DEFAULT '[]',
  image TEXT NOT NULL DEFAULT '',
  gif_url TEXT NOT NULL DEFAULT '',
  media_id TEXT NOT NULL DEFAULT '',
  attribution TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ex_body ON exercise(body_part);

CREATE TABLE IF NOT EXISTS workout_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  body_part TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body_part TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  equipment TEXT NOT NULL DEFAULT '',
  sets INTEGER NOT NULL DEFAULT 4,
  reps INTEGER NOT NULL DEFAULT 10,
  weight REAL NOT NULL DEFAULT 0,
  rest_sec INTEGER NOT NULL DEFAULT 90,
  position INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_date ON plan_item(date);

CREATE TABLE IF NOT EXISTS session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS journal_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT UNIQUE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('meal', 'training', 'note', 'sleep')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  source_text TEXT NOT NULL,
  merged_session_id INTEGER,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_entry_date ON journal_entry(date);

CREATE INDEX IF NOT EXISTS idx_session_date ON session(date);

CREATE TABLE IF NOT EXISTS session_set (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  plan_item_id INTEGER,
  exercise_id TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  body_part TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  set_index INTEGER NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  rest_sec INTEGER NOT NULL DEFAULT 0,
  actual_rest_sec INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_set_session ON session_set(session_id);
CREATE INDEX IF NOT EXISTS idx_set_ex ON session_set(exercise_id);

CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 3,
  source TEXT NOT NULL DEFAULT 'chat',
  confidence REAL NOT NULL DEFAULT 0.8,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory(kind);
`;

function seedFoods(db: DatabaseSync) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM food_cache').get() as { c: number };
  if (row.c > 0) return;
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO food_cache (name, aliases, kcal_100g, protein_100g, carb_100g, fat_100g, default_grams)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  try {
    for (const f of FOODS) {
      stmt.run(f.name, f.aliases, f.kcal_100g, f.protein_100g, f.carb_100g, f.fat_100g, f.default_grams);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function loadZhMap(): Map<string, string> {
  const map = new Map<string, string>();
  const file = path.join(DATA_DIR, 'exercise-zh.json');
  if (!fs.existsSync(file)) return map;
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ id: string; zh: string }>;
    for (const r of list) if (r.id && r.zh) map.set(r.id, r.zh);
  } catch {
    /* 文件损坏时退回英文名 */
  }
  return map;
}

function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

function ensureJournalKinds(db: DatabaseSync) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'journal_entry'").get() as { sql?: string } | undefined;
  if (!table?.sql || table.sql.includes("'sleep'")) return;

  // SQLite 不能修改 CHECK 约束；保留原记录和 request_id，重建一次表。
  db.exec('DROP INDEX IF EXISTS idx_journal_entry_date');
  db.exec('ALTER TABLE journal_entry RENAME TO journal_entry_legacy');
  db.exec(`CREATE TABLE journal_entry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT UNIQUE,
    date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('meal', 'training', 'note', 'sleep')),
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    source_text TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.exec(`INSERT INTO journal_entry (id, request_id, date, kind, title, detail, source_text, created_at)
    SELECT id, request_id, date, kind, title, detail, source_text, created_at FROM journal_entry_legacy`);
  db.exec('DROP TABLE journal_entry_legacy');
  db.exec('CREATE INDEX idx_journal_entry_date ON journal_entry(date)');
}

function ensureColumns(db: DatabaseSync) {
  ensureJournalKinds(db);

  ensureColumn(db, 'exercise', 'zh_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'session', 'plan_json', 'TEXT');
  // 记录也支持挂一张照片（训练 / 餐食都当“笔记”用）
  ensureColumn(db, 'session', 'photo_path', 'TEXT');
  ensureColumn(db, 'meal_log', 'photo_path', 'TEXT');
  ensureColumn(db, 'session_set', 'actual_rest_sec', 'INTEGER');
  ensureColumn(db, 'journal_entry', 'merged_session_id', 'INTEGER');
  ensureColumn(db, 'journal_entry', 'payload_json', 'TEXT');
}

/** 同步中文名：只更新和 data/exercise-zh.json 不一致的行 */
function backfillZhNames(db: DatabaseSync) {
  const zhMap = loadZhMap();
  if (!zhMap.size) return;
  const rows = db.prepare('SELECT id, zh_name FROM exercise').all() as unknown as Array<{ id: string; zh_name: string }>;
  const diffs = rows.filter((r) => r.zh_name !== (zhMap.get(r.id) ?? ''));
  if (!diffs.length) return;
  const stmt = db.prepare('UPDATE exercise SET zh_name = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const r of diffs) stmt.run(zhMap.get(r.id) ?? '', r.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function seedExercises(db: DatabaseSync) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM exercise').get() as { c: number };
  if (row.c > 0) return;

  // 数据集来自 https://github.com/hasaneyldrm/exercises-dataset（MIT，媒体版权归 Gym visual）
  const file = path.join(DATA_DIR, 'exercises.json');
  if (!fs.existsSync(file)) return;
  const list = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Record<string, unknown>>;

  const zhMap = loadZhMap();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO exercise
     (id, name, zh_name, body_part, equipment, target, muscle_group, secondary_muscles, zh, zh_steps, image, gif_url, media_id, attribution)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  try {
    for (const x of list) {
      const id = String(x.id ?? '');
      stmt.run(
        id,
        String(x.name ?? ''),
        zhMap.get(id) ?? '',
        String(x.body_part ?? ''),
        String(x.equipment ?? ''),
        String(x.target ?? ''),
        String(x.muscle_group ?? ''),
        JSON.stringify(x.secondary_muscles ?? []),
        String(x.zh ?? ''),
        JSON.stringify(x.zh_steps ?? []),
        String(x.image ?? ''),
        String(x.gif_url ?? ''),
        String(x.media_id ?? ''),
        String(x.attribution ?? ''),
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function initialize(db: DatabaseSync): void {
  db.exec('PRAGMA busy_timeout = 5000');
  try {
    db.exec('PRAGMA journal_mode = WAL');
  } catch {
    /* 内存/只读文件系统上可能不支持，忽略 */
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(SCHEMA);
    ensureColumns(db);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  seedFoods(db);
  seedExercises(db);
  backfillZhNames(db);
}

const g = globalThis as unknown as {
  __fitDb?: DatabaseSync;
  __fitDbSchema?: { database: DatabaseSync; revision: number; path: string };
};

export function getDb(): DatabaseSync {
  const cached = g.__fitDbSchema;
  if (cached && cached.database === g.__fitDb && cached.path === DB_PATH && cached.revision === SCHEMA_REVISION) {
    return cached.database;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const existing = g.__fitDb?.location?.() === DB_PATH ? g.__fitDb : undefined;
  const db = existing ?? new DatabaseSync(DB_PATH);
  try {
    initialize(db);
  } catch (error) {
    if (!existing) db.close();
    throw error;
  }

  g.__fitDb = db;
  g.__fitDbSchema = { database: db, revision: SCHEMA_REVISION, path: DB_PATH };
  return db;
}

export { DB_PATH };
