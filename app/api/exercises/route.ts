import { NextResponse } from "next/server";
import atlasRegions from "@/lib/athlete-regions.json";
import { getDb } from "@/lib/db";
import { EXERCISE_ALIASES } from "@/lib/exercise-words";
import { MUSCLES, muscleById, muscleMatchesExercise } from "@/lib/muscles";
import { sculptureGroup, sculptureGroupMatches } from "@/lib/sculpture-groups";
import { getExercisePreferences } from "@/lib/core/exercise-preferences";
import { sortForPlan } from "@/lib/exercise";
import { sculptureMediaUrls } from "@/lib/exercise-anim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row {
  id: string;
  name: string;
  zh_name: string;
  equipment: string;
  target: string;
  body_part: string;
  secondary_muscles?: string;
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

interface IndexedRow extends Row {
  _name: string;
  _zh: string;
  _target: string;
  _stretch: boolean;
}

let catalogCache: { key: string; rows: IndexedRow[]; counts: Record<string, number> } | null = null;

function getExerciseCatalog(withSteps: boolean) {
  const db = getDb();
  const dbKey = `${process.env.FITCHECK_DB_PATH || 'default'}:${withSteps ? 1 : 0}`;
  if (catalogCache && catalogCache.key === dbKey) return catalogCache;
  const raw = db
    .prepare(
      `SELECT id, name, zh_name, equipment, target, body_part, image, mechanic, movement_pattern, metabolic_demand, met_range, fatigue_level, recommended_rep_range${withSteps ? ", secondary_muscles, zh, zh_steps, gif_url" : ""} FROM exercise`,
    )
    .all() as unknown as Row[];
  const counts: Record<string, number> = {};
  for (const g of MUSCLES) counts[g.id] = 0;
  const rows: IndexedRow[] = raw.map((r) => {
    for (const g of MUSCLES) {
      if (muscleMatchesExercise(g, r)) counts[g.id] += 1;
    }
    return {
      ...r,
      _name: r.name.toLowerCase(),
      _zh: r.zh_name.toLowerCase(),
      _target: r.target.toLowerCase(),
      _stretch: /stretch|mobility|yoga|foam roll/i.test(r.name),
    };
  });
  catalogCache = { key: dbKey, rows, counts };
  return catalogCache;
}

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

  const preferences = showPreferences ? getExercisePreferences() : undefined;
  const { rows, counts } = getExerciseCatalog(withSteps);

  const region = atlasRegions.find((entry) => entry.id === sp.get("region"));
  const def = muscleById(region?.group ?? muscleId);
  const regionalIds = region?.exerciseIds ? new Set(region.exerciseIds) : null;
  // 口语别名（蝴蝶机夹胸…）映射到动作库标准名，搜索别名也能命中真实动作
  const aliasTerms = query
    ? Object.entries(EXERCISE_ALIASES)
        .filter(([alias]) => alias.includes(query) || query.includes(alias))
        .map(([, canonical]) => canonical.toLowerCase())
    : [];
  const matches: IndexedRow[] = [];

  for (const r of rows) {
    const matchesQuery =
      !query ||
      r._name.includes(query) ||
      r._zh.includes(query) ||
      r._target.includes(query) ||
      aliasTerms.some((term) => r._zh.includes(term));
    const matchesScope = group
      ? sculptureGroupMatches(group.id, r)
      : regionalIds
        ? regionalIds.has(r.id)
        : def
          ? muscleMatchesExercise(def, r)
          : !muscleId && !sp.get("region");
    if (!matchesQuery || !matchesScope) continue;
    if (planOrder && preferences?.get(r.id) !== "liked" && r._stretch) continue;
    if (parts.length && !parts.includes(r.body_part)) continue;
    if (equipment.length && !equipment.includes(r.equipment)) continue;
    if (
      (preferenceFilter === "liked" || preferenceFilter === "disliked") &&
      preferences?.get(r.id) !== preferenceFilter
    )
      continue;
    matches.push(r);
  }
  const ordered = planOrder ? sortForPlan(matches, preferences) : matches;
  const items = ordered.slice(offset, offset + limit);

  return NextResponse.json({
    counts,
    muscle: group?.id ?? def?.id ?? null,
    label: group?.label ?? region?.label ?? def?.label ?? null,
    total: matches.length,
    nextOffset:
      offset + items.length < ordered.length ? offset + items.length : null,
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
        secondary_muscles: x.secondary_muscles,
        mechanic: x.mechanic,
        movement_pattern: x.movement_pattern,
        metabolic_demand: x.metabolic_demand,
        met_range: x.met_range,
        fatigue_level: x.fatigue_level,
        recommended_rep_range: x.recommended_rep_range,
        image: x.image,
        body_part: x.body_part,
        hasAnimation: Boolean(x.gif_url),
        ...sculptureMediaUrls(x.id),
        ...(showPreferences
          ? { preference: preferences?.get(x.id) ?? null }
          : {}),
        steps,
        desc: withSteps ? (x.zh ?? "") : "",
      };
    }),
  });
}
