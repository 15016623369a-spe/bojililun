import { NextResponse } from 'next/server';
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
  zh?: string;
  zh_steps?: string;
  gif_url?: string;
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const muscleId = sp.get('muscle') ?? '';
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

  const def = muscleById(muscleId);
  const items: Row[] = [];

  for (const r of rows) {
    for (const g of MUSCLES) {
      if (muscleMatchesExercise(g, r)) {
        counts[g.id] += 1;
        if (def && g.id === def.id && items.length < limit) items.push(r);
      }
    }
  }

  return NextResponse.json({
    counts,
    muscle: def?.id ?? null,
    label: def?.label ?? null,
    total: def ? (counts[def.id] ?? 0) : 0,
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
