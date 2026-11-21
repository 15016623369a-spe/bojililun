import { NextResponse } from "next/server";
import atlasRegions from "@/lib/athlete-regions.json";
import { getDb } from "@/lib/db";
import { EXERCISE_ALIASES } from "@/lib/exercise-words";
import { MUSCLES, muscleById, muscleMatchesExercise } from "@/lib/muscles";
import { sculptureGroup, sculptureGroupMatches } from "@/lib/sculpture-groups";
import {
  getExercisePreferences,
  type ExercisePreference,
} from "@/lib/core/exercise-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row {
  id: string;
  name: string;
  zh_name: string;
  equipment: string;
  target: string;
  body_part: string;
  image: string;
  mechanic: string;
  movement_pattern: string;
  metabolic_demand: string;
  met_range: string;
  fatigue_level: string;
  recommended_rep_range: string;
  zh?: string;
  zh_steps?: string;
  gif_url?: string;
}

const equipmentRank: Record<string, number> = {
  barbell: 0,
  "olympic barbell": 0,
  "ez barbell": 1,
  dumbbell: 2,
  kettlebell: 3,
  cable: 4,
  "smith machine": 5,
  "leverage machine": 6,
  "sled machine": 6,
  "body weight": 7,
  band: 8,
};
const classicNames = [
  "高位下拉",
  "引体",
  "划船",
  "硬拉",
  "深蹲",
  "卧推",
  "推举",
  "飞鸟",
  "侧平举",
  "弯举",
  "腿举",
  "下拉",
];
const classicRank = (name: string) => {
  const rank = classicNames.findIndex((keyword) => name.includes(keyword));
  return rank < 0 ? classicNames.length : rank;
};
const preferenceRank = (preference?: ExercisePreference) =>
  preference === "liked" ? 0 : preference === "disliked" ? 2 : 1;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const muscleId = sp.get("muscle") ?? "";
  // 模型选择用「大类下所有细分肌群的并集」；muscle= / region= 保持原语义。
  const group = sculptureGroup(sp.get("group"));
  if (sp.has("group") && !group)
    return NextResponse.json({ error: "未知肌群" }, { status: 400 });
  const query = (sp.get("q") ?? "").trim().toLowerCase();
  const limit = Math.min(
    100,
    Math.max(1, Math.trunc(Number(sp.get("limit")) || 40)),
  );
  const offset = Math.max(0, Math.trunc(Number(sp.get("offset")) || 0));
  const planOrder = sp.get("order") === "plan";
  const equipment = sp.getAll("equipment");
  const parts = sp.getAll("part");
  const preferenceFilter = sp.get("preference");
  const showPreferences = planOrder || preferenceFilter !== null;
  // steps=1：字典页要动作要点（数据集里的中文分步说明）
  const withSteps = sp.get("steps") === "1";

  const db = getDb();
  const preferences = showPreferences ? getExercisePreferences() : undefined;
  const rows = db
    .prepare(
      `SELECT id, name, zh_name, equipment, target, body_part, image, mechanic, movement_pattern, metabolic_demand, met_range, fatigue_level, recommended_rep_range${withSteps ? ", zh, zh_steps, gif_url" : ""} FROM exercise`,
    )
    .all() as unknown as Row[];

  const counts: Record<string, number> = {};
  for (const g of MUSCLES) counts[g.id] = 0;

  const region = atlasRegions.find((entry) => entry.id === sp.get("region"));
  const def = muscleById(region?.group ?? muscleId);
  const regionalIds = region?.exerciseIds ? new Set(region.exerciseIds) : null;
  // 口语别名（蝴蝶机夹胸…）映射到动作库标准名，搜索别名也能命中真实动作
  const aliasTerms = Object.entries(EXERCISE_ALIASES)
    .filter(
      ([alias]) => query && (alias.includes(query) || query.includes(alias)),
    )
    .map(([, canonical]) => canonical.toLowerCase());
  const matches: Row[] = [];

  for (const r of rows) {
    for (const g of MUSCLES) {
      if (muscleMatchesExercise(g, r)) {
        counts[g.id] += 1;
      }
    }
    const matchesQuery =
      !query ||
      r.name.toLowerCase().includes(query) ||
      r.zh_name.toLowerCase().includes(query) ||
      r.target.toLowerCase().includes(query) ||
      aliasTerms.some((term) => r.zh_name.toLowerCase().includes(term));
    const matchesScope = group
      ? sculptureGroupMatches(group.id, r)
      : regionalIds
        ? regionalIds.has(r.id)
        : def
          ? muscleMatchesExercise(def, r)
          : !muscleId && !sp.get("region");
    if (!matchesQuery || !matchesScope) continue;
    if (
      planOrder &&
      preferences?.get(r.id) !== "liked" &&
      /stretch|mobility|yoga|foam roll/i.test(r.name)
    )
      continue;
    if (parts.length && !parts.includes(r.body_part)) continue;
    if (equipment.length && !equipment.includes(r.equipment)) continue;
    if (
      (preferenceFilter === "liked" || preferenceFilter === "disliked") &&
      preferences?.get(r.id) !== preferenceFilter
    )
      continue;
    matches.push(r);
  }
  if (planOrder) {
    matches.sort(
      (a, b) =>
        preferenceRank(preferences?.get(a.id)) -
          preferenceRank(preferences?.get(b.id)) ||
        classicRank(a.zh_name) - classicRank(b.zh_name) ||
        (equipmentRank[a.equipment] ?? 9) - (equipmentRank[b.equipment] ?? 9) ||
        (a.zh_name || a.name).localeCompare(b.zh_name || b.name, "zh-CN"),
    );
  }
  const items = matches.slice(offset, offset + limit);

  return NextResponse.json({
    counts,
    muscle: group?.id ?? def?.id ?? null,
    label: group?.label ?? region?.label ?? def?.label ?? null,
    total: matches.length,
    nextOffset:
      offset + items.length < matches.length ? offset + items.length : null,
    items: items.map((x) => {
      let steps: string[] = [];
      if (withSteps) {
        try {
          const parsed = JSON.parse(x.zh_steps || "[]");
          if (Array.isArray(parsed)) steps = parsed.map(String);
        } catch {
          steps = [];
        }
      }
      return {
        id: x.id,
        name: x.name,
        zh_name: x.zh_name,
        equipment: x.equipment,
        target: x.target,
        mechanic: x.mechanic,
        movement_pattern: x.movement_pattern,
        metabolic_demand: x.metabolic_demand,
        met_range: x.met_range,
        fatigue_level: x.fatigue_level,
        recommended_rep_range: x.recommended_rep_range,
        image: x.image,
        body_part: x.body_part,
        ...(showPreferences
          ? { preference: preferences?.get(x.id) ?? null }
          : {}),
        steps,
        desc: withSteps ? (x.zh ?? "") : "",
      };
    }),
  });
}
