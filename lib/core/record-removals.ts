import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

type Table = 'session' | 'session_set' | 'journal_entry';
type Snapshot = { table: Table; rows: Record<string, SQLInputValue>[] }[];

function prepareArchive(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS record_removal (
    token TEXT PRIMARY KEY, snapshot TEXT NOT NULL, expires_at INTEGER NOT NULL
  )`);
  db.prepare('DELETE FROM record_removal WHERE expires_at < ?').run(Date.now());
}

export function archiveRemoval(db: DatabaseSync, snapshot: Snapshot) {
  prepareArchive(db);
  const token = randomUUID();
  db.prepare('INSERT INTO record_removal VALUES (?, ?, ?)').run(token, JSON.stringify(snapshot), Date.now() + 86400000);
  return token;
}

export function syncRemovedPlanItems(db: DatabaseSync, rows: Record<string, SQLInputValue>[]) {
  const update = db.prepare(`UPDATE plan_item SET done = (
    SELECT COUNT(*) >= plan_item.sets FROM session_set WHERE plan_item_id = plan_item.id
  ) WHERE id = ?`);
  for (const id of new Set(rows.map((row) => row.plan_item_id))) if (id != null) update.run(id);
}

export function renumberTrainingSets(db: DatabaseSync, sessionId: SQLInputValue, exerciseId: SQLInputValue) {
  const rows = db.prepare('SELECT id FROM session_set WHERE session_id = ? AND exercise_id = ? ORDER BY id').all(sessionId, exerciseId);
  const update = db.prepare('UPDATE session_set SET set_index = ? WHERE id = ?');
  rows.forEach((row, index) => update.run(index + 1, row.id));
}

export function restoreRemoval(db: DatabaseSync, token: string) {
  prepareArchive(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    const stored = db.prepare('SELECT snapshot FROM record_removal WHERE token = ?').get(token);
    if (!stored) throw new Error('这条撤销已失效');
    const snapshot = JSON.parse(String(stored.snapshot)) as Snapshot;
    for (const { table, rows } of snapshot) {
      for (const row of rows) {
        if (table === 'session_set' && !db.prepare('SELECT 1 FROM session WHERE id = ?').get(row.session_id))
          throw new Error('所属训练已移除，请先恢复整次训练');
        const columns = Object.keys(row).map((key) => `"${key.replaceAll('"', '""')}"`).join(', ');
        const values = Object.values(row);
        db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${values.map(() => '?').join(', ')})`).run(...values);
      }
    }
    const sets = snapshot.find(({ table }) => table === 'session_set')?.rows ?? [];
    if (!snapshot.some(({ table }) => table === 'session')) {
      for (const row of sets) renumberTrainingSets(db, row.session_id, row.exercise_id);
    }
    syncRemovedPlanItems(db, sets);
    db.prepare('DELETE FROM record_removal WHERE token = ?').run(token);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
