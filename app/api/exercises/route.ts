import { NextResponse } from 'next/server';
import atlasRegions from '@/lib/athlete-regions.json';
import { getDb } from '@/lib/db';
import { MUSCLES, muscleById, muscleMatchesExercise } from '@/lib/muscles';

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
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const muscleId = sp.get('muscle') ?? '';
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 40));

  const db = getDb();
  const rows = db
    .prepare('SELECT id, name, zh_name, equipment, target, body_part, image FROM exercise')
    .all() as unknown as Row[];

  const counts: Record<string, number> = {};
  for (const g of MUSCLES) counts[g.id] = 0;

  const region = atlasRegions.find((entry) => entry.id === sp.get('region'));
  const def = muscleById(region?.group ?? muscleId);
  const regionalIds = region?.exerciseIds ? new Set(region.exerciseIds) : null;
  let total = 0;
  const items: Row[] = [];

  for (const r of rows) {
    for (const g of MUSCLES) {
      if (muscleMatchesExercise(g, r)) {
        counts[g.id] += 1;

      }
    }
    if (regionalIds ? regionalIds.has(r.id) : def && muscleMatchesExercise(def, r)) {
      total++;
      if (items.length < limit) items.push(r);
    }
  }

  return NextResponse.json({
    counts,
    muscle: def?.id ?? null,
    label: region?.label ?? def?.label ?? null,
    total,
    items: items.map((x) => ({
      id: x.id,
      name: x.name,
      zh_name: x.zh_name,
      equipment: x.equipment,
      target: x.target,
      image: x.image,
    })),
  });
}
