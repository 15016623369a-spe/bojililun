import type { DatabaseSync } from 'node:sqlite';

/**
 * 今日精力：每天一格 1–5（记录页的点阵电池）。单独一张小表，不改手账已有的表。
 * 表在第一次读写时建立。
 */
function ensure(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS day_energy(
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, date)
  )`);
}

export function getDayEnergy(db: DatabaseSync, user: string, date: string): number | null {
  ensure(db);
  const row = db.prepare('SELECT level FROM day_energy WHERE user_id=? AND date=?').get(user, date) as { level: number } | undefined;
  return row?.level ?? null;
}

export function dayEnergyRange(db: DatabaseSync, user: string, start: string, end: string): Map<string, number> {
  ensure(db);
  const rows = db.prepare('SELECT date, level FROM day_energy WHERE user_id=? AND date BETWEEN ? AND ?').all(user, start, end) as { date: string; level: number }[];
  return new Map(rows.map((r) => [r.date, r.level]));
}

/** level 为 null 时清除当天的记录 */
export function setDayEnergy(db: DatabaseSync, user: string, date: string, level: number | null) {
  ensure(db);
  if (level === null) {
    db.prepare('DELETE FROM day_energy WHERE user_id=? AND date=?').run(user, date);
    return;
  }
  if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error('精力只能是 1–5');
  db.prepare(`INSERT INTO day_energy(user_id, date, level, updated_at) VALUES(?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET level=excluded.level, updated_at=excluded.updated_at`)
    .run(user, date, level, new Date().toISOString());
}
