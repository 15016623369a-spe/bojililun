import { NextResponse } from 'next/server';
import atlasRegions from '@/lib/athlete-regions.json';
import { getDb } from '@/lib/db';
import { EXERCISE_ALIASES } from '@/lib/exercise-words';
import { MUSCLES, muscleById, muscleMatchesExercise } from '@/lib/muscles';
import { sculptureGroup, sculptureGroupMatches } from '@/lib/sculpture-groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  name: string;
  zh_name: string;
  equipment: string;
  target: string;
  body_part: string;
  image: string;
  zh?: string;
  zh_steps?: string;
  gif_url?: string;
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const muscleId = sp.get('muscle') ?? '';
  // 模型选择用「大类下所有细分肌群的并集」；muscle= / region= 保持原语义。
  const group = sculptureGroup(sp.get('group'));
  if (sp.has('group') && !group) return NextResponse.json({ error: '未知肌群' }, { status: 400 });
  const query = (sp.get('q') ?? '').trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 40));
  // steps=1：字典页要动作要点（数据集里的中文分步说明）
  const withSteps = sp.get('steps') === '1';

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, zh_name, equipment, target, body_part, image${withSteps ? ', zh, zh_steps, gif_url' : ''} FROM exercise`,
    )
    .all() as unknown as Row[];

  const counts: Record<string, number> = {};
  for (const g of MUSCLES) counts[g.id] = 0;

  const region = atlasRegions.find((entry) => entry.id === sp.get('region'));
  const def = muscleById(region?.group ?? muscleId);
  const regionalIds = region?.exerciseIds ? new Set(region.exerciseIds) : null;
  // 口语别名（蝴蝶机夹胸…）映射到动作库标准名，搜索别名也能命中真实动作
  const aliasTerms = Object.entries(EXERCISE_ALIASES)
    .filter(([alias]) => query && (alias.includes(query) || query.includes(alias)))
    .map(([, canonical]) => canonical.toLowerCase());
  let total = 0;
  const items: Row[] = [];

  for (const r of rows) {
    for (const g of MUSCLES) {
      if (muscleMatchesExercise(g, r)) {
        counts[g.id] += 1;

      }
    }
    const matchesQuery = !query || r.name.toLowerCase().includes(query) || r.zh_name.toLowerCase().includes(query) || r.target.toLowerCase().includes(query)
      || aliasTerms.some((term) => r.zh_name.toLowerCase().includes(term));
    const matchesScope = group
      ? sculptureGroupMatches(group.id, r)
      : regionalIds ? regionalIds.has(r.id) : def ? muscleMatchesExercise(def, r) : !muscleId && !sp.get('region');
    if (matchesQuery && matchesScope) {
      total++;
      if (items.length < limit) items.push(r);
    }
  }

  return NextResponse.json({
    counts,
    muscle: group?.id ?? def?.id ?? null,
    label: group?.label ?? region?.label ?? def?.label ?? null,
    total,
    items: items.map((x) => {
      let steps: string[] = [];
      if (withSteps) {
        try {
          const parsed = JSON.parse(x.zh_steps || '[]');
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
        image: x.image,
        steps,
        desc: withSteps ? (x.zh ?? '') : '',
      };
    }),
  });
}
