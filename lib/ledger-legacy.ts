import type { DatabaseSync } from 'node:sqlite';
import type { QuickPayload } from './journal';
import dictionary from '../data/exercises-seed.json';
import { saveBatch, type Draft } from './ledger';
import type { FoodItem } from './types';
import type { Movement } from './calculations';
import { idsForTarget } from './energy';
import { primaryMuscle } from './training-log';

type SeedExercise = (typeof dictionary)[number];

/**
 * 旧训练表的动作 → 主要 / 次要肌群，存进手账给 calcMuscleHeatmap 用：
 * 词典有肌群就用词典；否则用统计页的 primaryMuscle 判定（动作库的 target / body_part，再退到动作名里提到的部位）。
 * 统计和回顾不读这里存的肌群，而是按 library_id 现查动作库，见 lib/training-log.ts。
 */
function legacyMuscles(
  db: DatabaseSync,
  row: { exercise_id?: unknown; exercise_name: string; target?: unknown; body_part?: unknown },
  dict: SeedExercise | undefined,
) {
  if (dict?.primary_muscles?.length)
    return { primary: [...dict.primary_muscles], secondary: [...(dict.secondary_muscles ?? [])] };
  const meta = row.exercise_id
    ? db.prepare('SELECT name,target,body_part,secondary_muscles FROM exercise WHERE id=?').get(String(row.exercise_id))
    : undefined;
  const ex = {
    name: String(meta?.name || row.exercise_name),
    target: String(meta?.target || row.target || ''),
    body_part: String(meta?.body_part || row.body_part || ''),
  };
  const primary = primaryMuscle(ex, row.exercise_name);
  let secondary: string[] = [];
  try {
    const listed = JSON.parse(String(meta?.secondary_muscles ?? '[]'));
    if (Array.isArray(listed)) secondary = listed.flatMap((target) => idsForTarget(String(target)));
  } catch { /* 没有次要肌群不影响主要肌群 */ }
  return {
    primary: primary ? [primary] : [],
    secondary: [...new Set(secondary)].filter((id) => id !== primary),
  };
}

// Legacy screens continue writing their own tables. A durable dirty queue bridges those writes.
export function installBridge(db: DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS ledger_dirty(kind TEXT,legacy_id TEXT,PRIMARY KEY(kind,legacy_id))');
  for (const [table, kind, key] of [
    ['meal_log', 'meal', 'id'],
    ['session', 'workout', 'id'],
    ['session_set', 'workout', 'session_id'],
    ['weight_entry', 'body_metrics', 'date'],
    ['journal_entry', 'journal', 'id'],
  ]) {
    for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = event === 'DELETE' ? 'OLD' : 'NEW';
      db.exec(
        `CREATE TRIGGER IF NOT EXISTS ledger_${table}_${event} AFTER ${event} ON ${table} BEGIN INSERT OR REPLACE INTO ledger_dirty VALUES('${kind}',${row}.${key}); END`,
      );
    }
    db.exec(
      `INSERT OR IGNORE INTO ledger_dirty SELECT '${kind}',${key} FROM ${table} WHERE NOT EXISTS(SELECT 1 FROM ledger_requests WHERE user_id='local' AND request_id='legacy/${kind}/'||${table}.${key})`,
    );
  }
  // 一次性补齐：早先同步过来的旧训练没有写肌群，重新同步一次（id 和删除状态保持不变）
  db.exec('CREATE TABLE IF NOT EXISTS ledger_backfill(name TEXT PRIMARY KEY)');
  if (!db.prepare("SELECT 1 FROM ledger_backfill WHERE name='legacy-workout-muscles'").get()) {
    for (const kind of ['workout', 'journal'])
      db.exec(
        `INSERT OR IGNORE INTO ledger_dirty SELECT '${kind}',substr(request_key,16,length(request_key)-17) FROM entries WHERE user_id='local' AND entry_type='workout' AND request_key LIKE 'legacy/${kind}/%/0' AND actions LIKE '%"primary_muscles":[]%'`,
      );
    db.exec("INSERT INTO ledger_backfill VALUES('legacy-workout-muscles')");
  }
  // 一次性补齐：训练页的训练重新同步一次，给每个动作带上训练页动作库的 id（library_id），统计按它判定肌群、找图片
  if (!db.prepare("SELECT 1 FROM ledger_backfill WHERE name='legacy-workout-library-ids'").get()) {
    db.exec(
      "INSERT OR IGNORE INTO ledger_dirty SELECT 'workout',substr(request_key,16,length(request_key)-17) FROM entries WHERE user_id='local' AND entry_type='workout' AND request_key LIKE 'legacy/workout/%/0'",
    );
    db.exec("INSERT INTO ledger_backfill VALUES('legacy-workout-library-ids')");
  }
}
export function flushLegacy(db: DatabaseSync) {
  for (const pending of db.prepare('SELECT kind,legacy_id FROM ledger_dirty').all()) {
    const kind = String(pending.kind) as string,
      id = String(pending.legacy_id),
      key = 'legacy/' + kind + '/' + id;
    db.exec('SAVEPOINT migrate_legacy');
    try {
      let record: Draft | null = null;
      const base = {
        summary_title: '',
        note: null,
        confidence: 'estimated' as const,
        feeling_tags: [],
        raw_text: null,
      };
      if (kind === 'meal') {
        const m = db.prepare('SELECT * FROM meal_log WHERE id=?').get(id);
        if (m) {
          const items = (JSON.parse(String(m.items_json)) as FoodItem[]).map((i) => {
            const val = (v: number, round = false) =>
              Number.isFinite(v) && Number.isFinite(i.grams)
                ? Math.round(((i.grams * v) / 100) * (round ? 1 : 1000)) / (round ? 1 : 1000)
                : null;
            return {
              food_name: i.name,
              portion_text: null,
              estimated_grams: i.grams,
              kcal: val(i.kcal_100g, true),
              protein_g: val(i.protein_100g),
              carbs_g: val(i.carb_100g),
              fat_g: val(i.fat_100g),
              confidence: 'estimated' as const,
            };
          });
          if (items.length)
            record = {
              ...base,
              entry_type: 'meal',
              logged_at: String(m.created_at),
              summary_title: items.map((i) => i.food_name).join('、'),
              items,
            };
        }
      } else if (kind === 'workout') {
        const s = db.prepare('SELECT * FROM session WHERE id=?').get(id);
        if (s) {
          const moves = new Map<string, Movement>();
          for (const row of db.prepare('SELECT * FROM session_set WHERE session_id=? ORDER BY id').all(id)) {
            const name = String(row.exercise_name),
              dict = dictionary.find((e) => e.legacy_id === row.exercise_id || e.name_zh === name);
            const muscles = moves.has(name) ? null : legacyMuscles(db, { ...row, exercise_name: name }, dict);
            const m = moves.get(name) ?? {
              exercise_id: dict?.id ?? null,
              library_id: String(row.exercise_id),
              exercise_name: name,
              primary_muscles: muscles?.primary ?? [],
              secondary_muscles: muscles?.secondary ?? [],
              sets: [],
            };
            m.sets.push({
              weight_kg: Number(row.weight) || null,
              reps: Number(row.reps) || null,
              duration_sec: Number(row.duration_sec) || null,
            });
            moves.set(name, m);
          }
          if (moves.size)
            record = {
              ...base,
              entry_type: 'workout',
              logged_at: String(s.started_at),
              note: s.note as string | null,
              summary_title: [...moves.keys()].join('、'),
              exercises: [...moves.values()],
            };
        }
      } else if (kind === 'journal') {
        const r = db
          .prepare(
            "SELECT * FROM journal_entry WHERE id=? AND merged_session_id IS NULL AND kind IN ('meal','training')",
          )
          .get(id);
        if (r) {
          const payload: QuickPayload = r.payload_json ? JSON.parse(String(r.payload_json)) : {};
          const common = {
            ...base,
            logged_at: String(r.created_at),
            raw_text: String(r.source_text),
            note: String(r.detail) || null,
            summary_title: String(r.title),
          };
          if (payload.planned) record = { ...common, entry_type: 'plan_draft' };
          else if (r.kind === 'meal') {
            const items = (
              payload.items?.length
                ? payload.items
                : [{ name: String(r.detail) || String(r.title), amount: '' }]
            ).map((i) => ({
              food_name: i.name,
              portion_text: i.amount || null,
              estimated_grams: i.grams ?? i.estimatedGrams ?? null,
              kcal: i.manualKcal ?? (i.nutrition ? Math.round(i.nutrition.kcal) : null),
              protein_g: i.nutrition?.protein ?? null,
              carbs_g: i.nutrition?.carb ?? null,
              fat_g: i.nutrition?.fat ?? null,
              confidence: 'estimated' as const,
            }));
            record = { ...common, entry_type: 'meal', items };
          } else {
            const exercises = (
              payload.exercises?.length ? payload.exercises : [{ name: String(r.detail) || String(r.title) }]
            ).map((m) => {
              const num = (v?: string) =>
                v && /^\d+(?:\.\d+)?(?:kg|公斤|次|秒)?$/i.test(v.trim()) ? parseFloat(v) : null;
              const dict = dictionary.find((e) => e.name_zh === m.name || e.aliases?.includes(m.name));
              const muscles = legacyMuscles(db, { exercise_name: m.name }, dict);
              return {
                exercise_name: m.name,
                exercise_id: dict?.id ?? null,
                primary_muscles: muscles.primary,
                secondary_muscles: muscles.secondary,
                sets: Array.from({ length: m.sets ?? 0 }, () => ({
                  weight_kg: num(m.weight),
                  reps: num(m.reps),
                  duration_sec: num(m.duration),
                })),
              };
            });
            record = { ...common, entry_type: 'workout', exercises };
          }
        }
      } else {
        const m = db.prepare('SELECT * FROM weight_entry WHERE date=?').get(id);
        if (m)
          record = {
            ...base,
            entry_type: 'body_metrics',
            summary_title: '体重',
            logged_at: id + 'T00:00:00+08:00',
            weight_kg: Number(m.weight),
          };
      }
      const oldMetric = db
        .prepare("SELECT id FROM body_metrics WHERE user_id='local' AND request_key=?")
        .get(key + '/0');
      const old = db
        .prepare("SELECT id,is_deleted FROM entries WHERE user_id='local' AND request_key=?")
        .get(key + '/0');
      if (old) {
        for (const table of ['meal_items', 'workout_sets'])
          db.prepare('DELETE FROM ' + table + ' WHERE entry_id=?').run(old.id);
        db.prepare('DELETE FROM entries WHERE id=?').run(old.id);
      }
      db.prepare("DELETE FROM body_metrics WHERE user_id='local' AND request_key=?").run(key + '/0');
      db.prepare("DELETE FROM ledger_requests WHERE user_id='local' AND request_id=?").run(key);
      if (record) {
        saveBatch(db, 'local', key, null, [record]);
        if (oldMetric)
          db.prepare("UPDATE body_metrics SET id=? WHERE user_id='local' AND request_key=?").run(
            oldMetric.id,
            key + '/0',
          );
        if (old) {
          const current = db
            .prepare("SELECT id FROM entries WHERE user_id='local' AND request_key=?")
            .get(key + '/0')!;
          if (current.id !== old.id) {
            db.exec('PRAGMA defer_foreign_keys=ON');
            for (const table of ['meal_items', 'workout_sets'])
              db.prepare('UPDATE ' + table + ' SET entry_id=? WHERE entry_id=?').run(old.id, current.id);
          }
          db.prepare('UPDATE entries SET id=?,is_deleted=? WHERE id=?').run(
            old.id,
            old.is_deleted,
            current.id,
          );
        }
      }
      db.prepare('DELETE FROM ledger_dirty WHERE kind=? AND legacy_id=?').run(kind, id);
      db.exec('RELEASE migrate_legacy');
    } catch (e) {
      db.exec('ROLLBACK TO migrate_legacy; RELEASE migrate_legacy');
      throw e;
    }
  }
}
