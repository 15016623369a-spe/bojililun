import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = path.resolve(process.env.FITCHECK_DB_PATH || "data/fitness.db");
const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS exercise (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', zh_name TEXT NOT NULL DEFAULT '', body_part TEXT NOT NULL DEFAULT '',
  equipment TEXT NOT NULL DEFAULT '', target TEXT NOT NULL DEFAULT '', muscle_group TEXT NOT NULL DEFAULT '',
  secondary_muscles TEXT NOT NULL DEFAULT '[]', zh TEXT NOT NULL DEFAULT '', zh_steps TEXT NOT NULL DEFAULT '[]',
  image TEXT NOT NULL DEFAULT '', gif_url TEXT NOT NULL DEFAULT '', media_id TEXT NOT NULL DEFAULT '', attribution TEXT NOT NULL DEFAULT ''
)`);
const sourceExercises = JSON.parse(
  fs.readFileSync("data/exercises.json", "utf8"),
);
const seed = db.prepare(
  `INSERT OR IGNORE INTO exercise(id,name,body_part,equipment,target,muscle_group,secondary_muscles,zh,zh_steps,image,gif_url,media_id,attribution) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);
for (const ex of sourceExercises)
  seed.run(
    ex.id,
    ex.name,
    ex.body_part,
    ex.equipment,
    ex.target,
    ex.muscle_group,
    JSON.stringify(ex.secondary_muscles || []),
    ex.zh || "",
    JSON.stringify(ex.zh_steps || []),
    ex.image || "",
    ex.gif_url || "",
    ex.media_id || "",
    ex.attribution || "",
  );
const columns = new Set(
  db
    .prepare("PRAGMA table_info(exercise)")
    .all()
    .map((c) => c.name),
);
const fields = {
  mechanic: "TEXT NOT NULL DEFAULT 'compound'",
  movement_pattern: "TEXT NOT NULL DEFAULT 'other'",
  metabolic_demand: "TEXT NOT NULL DEFAULT 'moderate'",
  met_range: "TEXT NOT NULL DEFAULT '3.5–6.0'",
  fatigue_level: "TEXT NOT NULL DEFAULT 'moderate'",
  recommended_rep_range: "TEXT NOT NULL DEFAULT '8–12'",
};
for (const [name, definition] of Object.entries(fields))
  if (!columns.has(name))
    db.exec(`ALTER TABLE exercise ADD COLUMN ${name} ${definition}`);

const all = sourceExercises;
const labels = {
  low: ["低", "2.0–3.0"],
  moderate: ["中", "3.0–5.0"],
  high: ["高", "5.0–7.0"],
};
function classify(ex) {
  const n = ex.name.toLowerCase();
  const muscles = [ex.target, ex.muscle_group, ...(ex.secondary_muscles || [])]
    .join(" ")
    .toLowerCase();
  let pattern = "其他";
  if (/squat|lunge|step up|leg press/.test(n)) pattern = "蹲／弓步";
  else if (/deadlift|good morning|hip hinge|romanian/.test(n))
    pattern = "髋铰链";
  else if (/standing twist|russian twist|wood chop|rotation|rotational/.test(n))
    pattern = "核心旋转";
  else if (/row|pulldown|pull.?up|chin.?up/.test(n))
    pattern = /row/.test(n) ? "水平拉" : "垂直拉";
  else if (
    /bench press|push.?up|chest press|dip|fly|press/.test(n) &&
    /chest|pector|triceps|shoulder/.test(muscles)
  )
    pattern = /overhead|shoulder|military/.test(n) ? "垂直推" : "水平推";
  else if (
    /plank|crunch|sit.?up|leg raise|russian twist|ab wheel|rollout/.test(n) ||
    /abs|obliques|core/.test(muscles)
  )
    pattern = /twist|rotation/.test(n)
      ? "核心旋转"
      : /crunch|sit.?up|leg raise/.test(n)
        ? "核心屈曲"
        : "核心稳定";
  else if (/curl|extension|fly|raise|kickback|shrug|wrist/.test(n))
    pattern = /raise|fly/.test(n) ? "单关节外展／飞鸟" : "单关节屈伸";
  const isolation =
    /curl|extension|kickback|fly|lateral raise|front raise|wrist|calf raise/.test(
      n,
    );
  const stretch = /stretch|mobility|circles/.test(n);
  const cardio =
    ex.body_part === "cardio" ||
    /run|sprint|jump rope|burpee|mountain climber/.test(n);
  const demand = stretch
    ? "low"
    : cardio
      ? "high"
      : /squat|deadlift|lunge|burpee|jump|clean|snatch/.test(n)
        ? "high"
        : isolation
          ? "low"
          : "moderate";
  const fatigue =
    stretch || isolation
      ? "low"
      : demand === "high" || /deadlift|squat|burpee/.test(n)
        ? "high"
        : "moderate";
  const coreOverrides = {
    "dead bug": [
      "core_anti_extension",
      "多关节",
      "低",
      "2.0–3.0",
      "低",
      "8–15",
    ],
    "front plank": [
      "core_anti_extension",
      "多关节",
      "低",
      "2.0–3.0",
      "低",
      "按时间",
    ],
    "front plank with twist": [
      "core_anti_rotation",
      "多关节",
      "中",
      "3.0–5.0",
      "中",
      "按时间",
    ],
    "side plank": [
      "core_lateral_stability",
      "多关节",
      "低",
      "2.0–3.0",
      "低",
      "按时间",
    ],
    "band horizontal pallof press": [
      "core_anti_rotation",
      "多关节",
      "低",
      "2.0–3.0",
      "低",
      "8–15",
    ],
    "crunch floor": ["core_flexion", "单关节", "低", "2.0–3.0", "低", "8–15"],
    "hanging leg raise": [
      "core_flexion",
      "多关节",
      "中",
      "3.0–5.0",
      "中",
      "8–15",
    ],
  };
  const override = coreOverrides[n.replace(/\s*\([^)]*\)/g, "")];
  if (override)
    return {
      mechanic: override[1],
      movement_pattern: override[0],
      metabolic_demand: override[2],
      met_range: override[3],
      fatigue_level: override[4],
      recommended_rep_range: override[5],
    };
  return {
    mechanic: isolation ? "单关节" : "多关节",
    movement_pattern: pattern,
    metabolic_demand: { low: "低", moderate: "中", high: "高" }[demand],
    met_range: labels[demand][1],
    fatigue_level: { low: "低", moderate: "中", high: "高" }[fatigue],
    recommended_rep_range: stretch
      ? "按时长"
      : cardio
        ? "按时长／距离"
        : isolation
          ? "10–15"
          : "6–12",
  };
}
const stmt = db.prepare(
  `UPDATE exercise SET mechanic=?,movement_pattern=?,metabolic_demand=?,met_range=?,fatigue_level=?,recommended_rep_range=? WHERE id=?`,
);
let updated = 0;
db.exec("BEGIN IMMEDIATE");
try {
  for (const ex of all) {
    if (!db.prepare("SELECT 1 FROM exercise WHERE id=?").get(ex.id)) continue;
    const x = classify(ex);
    stmt.run(
      x.mechanic,
      x.movement_pattern,
      x.metabolic_demand,
      x.met_range,
      x.fatigue_level,
      x.recommended_rep_range,
      ex.id,
    );
    updated++;
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}
console.log(`Backfilled exercise metrics for ${updated} rows in ${dbPath}`);
db.close();
