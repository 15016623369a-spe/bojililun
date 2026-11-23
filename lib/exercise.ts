import { getDb } from "./db";
import dictionary from "../data/exercises-seed.json";
import type { ExercisePreference } from "./core/exercise-preferences";

function plainAll<T extends object>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r }));
}

/* ---------------------------- 排计划时动作的先后 ---------------------------- */

/** 词典里的 30 个常见动作（杠铃卧推、哑铃卧推、俯卧撑……），按词典顺序排在同部位其他动作前面 */
const COMMON = new Map(
  dictionary.flatMap((e, i) => (e.legacy_id ? [[e.legacy_id, i] as const] : [])),
);
const CLASSIC = ["高位下拉", "引体", "划船", "硬拉", "深蹲", "卧推", "推举", "飞鸟", "侧平举", "弯举", "腿举", "下拉"];
const PLAN_EQUIPMENT: Record<string, number> = {
  barbell: 0, "olympic barbell": 0, "ez barbell": 1, dumbbell: 2, kettlebell: 3, cable: 4,
  "smith machine": 5, "leverage machine": 6, "sled machine": 6, "body weight": 7, band: 8,
};
/** 只看括号前的名字：「双杠臂屈伸（臂屈伸引体向上架）」不算引体 */
const baseName = (name: string) => name.split(/[（(]/)[0];
const classicRank = (name: string) => {
  const rank = CLASSIC.findIndex((keyword) => baseName(name).includes(keyword));
  return rank < 0 ? CLASSIC.length : rank;
};
const preferenceRank = (preference?: ExercisePreference) =>
  preference === "liked" ? 0 : preference === "disliked" ? 2 : 1;

/**
 * 计划、动作库和建档里动作的先后：常练 → 词典里的常见动作 → 经典动作 → 器械 → 名字短的（多是标准名）→ 拼音。
 * 不喜欢的动作排到最后。
 */
export function sortForPlan<T extends { id: string; name: string; zh_name: string; equipment: string }>(
  rows: T[],
  preferences?: Map<string, ExercisePreference>,
): T[] {
  const common = (id: string) => COMMON.get(id) ?? COMMON.size;
  return [...rows].sort(
    (a, b) =>
      preferenceRank(preferences?.get(a.id)) - preferenceRank(preferences?.get(b.id)) ||
      common(a.id) - common(b.id) ||
      classicRank(a.zh_name) - classicRank(b.zh_name) ||
      (PLAN_EQUIPMENT[a.equipment] ?? 9) - (PLAN_EQUIPMENT[b.equipment] ?? 9) ||
      baseName(a.zh_name || a.name).length - baseName(b.zh_name || b.name).length ||
      (a.zh_name || a.name).localeCompare(b.zh_name || b.name, "zh-CN"),
  );
}

export interface ExerciseRow {
  id: string;
  name: string;
  zh_name: string;
  body_part: string;
  equipment: string;
  target: string;
  mechanic: string;
  movement_pattern: string;
  metabolic_demand: string;
  met_range: string;
  fatigue_level: string;
  recommended_rep_range: string;
  muscle_group: string;
  secondary_muscles: string;
  zh: string;
  zh_steps: string;
  image: string;
  gif_url: string;
}

/** 训练计划里优先用“能做组”的器械，而不是拉伸/辅助类动作 */
const EQUIPMENT_PRIORITY: Record<string, number> = {
  barbell: 0,
  dumbbell: 1,
  cable: 2,
  "leverage machine": 3,
  "smith machine": 4,
  "body weight": 5,
};

export function findExercises(opts: {
  bodyPart?: string;
  equipments?: string[];
  limit?: number;
  /** 训练计划里默认排除拉伸/瑜伽类条目 */
  excludeStretch?: boolean;
}): ExerciseRow[] {
  const db = getDb();
  const where: string[] = [];
  const args: Array<string | number> = [];

  if (opts.bodyPart) {
    where.push("body_part = ?");
    args.push(opts.bodyPart);
  }

  if (opts.equipments && opts.equipments.length) {
    where.push(`equipment IN (${opts.equipments.map(() => "?").join(",")})`);
    args.push(...opts.equipments);
  }

  if (opts.excludeStretch !== false) {
    where.push(
      "name NOT LIKE '%stretch%' AND name NOT LIKE '%mobility%' AND name NOT LIKE '%yoga%'",
    );
  }

  const priority = `CASE equipment ${Object.entries(EQUIPMENT_PRIORITY)
    .map(([eq, n]) => `WHEN '${eq}' THEN ${n}`)
    .join(" ")} ELSE 9 END`;

  const sql = `SELECT * FROM exercise ${
    where.length ? "WHERE " + where.join(" AND ") : ""
  } ORDER BY ${priority}, RANDOM() LIMIT ?`;

  return plainAll(
    db.prepare(sql).all(...args, opts.limit ?? 4) as unknown as ExerciseRow[],
  );
}

export function exerciseCount(): number {
  return (
    getDb().prepare("SELECT COUNT(*) AS c FROM exercise").get() as { c: number }
  ).c;
}

/* ------------------------------------------------------------------ */
/* 动作库浏览用的查询                                                   */
/* ------------------------------------------------------------------ */

export interface ListOpts {
  bodyPart?: string;
  equipment?: string;
  target?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

function buildWhere(o: {
  bodyPart?: string;
  equipment?: string;
  target?: string;
  q?: string;
}) {
  const where: string[] = [];
  const args: string[] = [];
  if (o.bodyPart) {
    where.push("body_part = ?");
    args.push(o.bodyPart);
  }
  if (o.equipment) {
    where.push("equipment = ?");
    args.push(o.equipment);
  }
  if (o.target) {
    where.push("target = ?");
    args.push(o.target);
  }
  if (o.q) {
    where.push("(name LIKE ? OR zh_name LIKE ? OR target LIKE ?)");
    args.push(`%${o.q}%`, `%${o.q}%`, `%${o.q}%`);
  }
  return { where, args };
}

export function listExercises(o: ListOpts): ExerciseRow[] {
  const { where, args } = buildWhere(o);
  const priority = `CASE equipment ${Object.entries(EQUIPMENT_PRIORITY)
    .map(([eq, n]) => `WHEN '${eq}' THEN ${n}`)
    .join(" ")} ELSE 9 END`;
  const sql = `SELECT * FROM exercise ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY ${priority}, name ASC
               LIMIT ? OFFSET ?`;
  return plainAll(dbAll(sql, [...args, o.limit ?? 120, o.offset ?? 0]));
}

function dbAll(sql: string, args: Array<string | number>): ExerciseRow[] {
  return getDb()
    .prepare(sql)
    .all(...args) as unknown as ExerciseRow[];
}

export function countExercises(o: {
  bodyPart?: string;
  equipment?: string;
  target?: string;
  q?: string;
}): number {
  const { where, args } = buildWhere(o);
  const sql = `SELECT COUNT(*) AS c FROM exercise ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  return (
    getDb()
      .prepare(sql)
      .get(...args) as { c: number }
  ).c;
}

/** 当前部位/搜索条件下，各器械分别有多少个（给筛选 chips 和分组标题用） */
export function equipmentCountsFor(o: {
  bodyPart?: string;
  q?: string;
}): Array<{ key: string; c: number }> {
  const { where, args } = buildWhere(o);
  const sql = `SELECT equipment AS key, COUNT(*) AS c FROM exercise
               ${where.length ? "WHERE " + where.join(" AND ") : ""}
               GROUP BY equipment`;
  return getDb()
    .prepare(sql)
    .all(...args) as unknown as Array<{ key: string; c: number }>;
}

export function groupCount(
  column: "body_part" | "equipment",
): Array<{ key: string; c: number }> {
  const rows = getDb()
    .prepare(
      `SELECT ${column} AS key, COUNT(*) AS c FROM exercise GROUP BY ${column}`,
    )
    .all() as unknown as Array<{ key: string; c: number }>;
  return rows;
}

export function getExercise(id: string): ExerciseRow | null {
  const row = getDb().prepare("SELECT * FROM exercise WHERE id = ?").get(id) as
    ExerciseRow | undefined;
  return row ? { ...row } : null;
}

export function relatedExercises(ex: ExerciseRow, limit = 4): ExerciseRow[] {
  return plainAll(
    dbAll(
      `SELECT * FROM exercise WHERE target = ? AND id != ? ORDER BY RANDOM() LIMIT ?`,
      [ex.target, ex.id, limit],
    ),
  );
}
