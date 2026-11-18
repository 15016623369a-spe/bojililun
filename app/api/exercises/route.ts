import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listExercises } from '@/lib/exercise';
import { MUSCLES, muscleById } from '@/lib/muscles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const muscleId = sp.get('muscle') ?? '';
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 40));

  // 各肌肉的动作数量，给选肌肉时做提示
  const db = getDb();
  const rows = db.prepare('SELECT target, body_part FROM exercise').all() as unknown as Array<{
    target: string;
    body_part: string;
  }>;
  const byTarget = new Map<string, number>();
  const byBody = new Map<string, number>();
  for (const r of rows) {
    byTarget.set(r.target, (byTarget.get(r.target) ?? 0) + 1);
    byBody.set(r.body_part, (byBody.get(r.body_part) ?? 0) + 1);
  }
  const counts: Record<string, number> = {};
  for (const m of MUSCLES) {
    counts[m.id] = m.target ? byTarget.get(m.target) ?? 0 : byBody.get(m.bodyPart ?? '') ?? 0;
  }

  const def = muscleById(muscleId);
  if (!def) return NextResponse.json({ counts, items: [], total: 0 });

  const items = listExercises({
    target: def.target,
    bodyPart: def.target ? undefined : def.bodyPart,
    limit,
  });

  return NextResponse.json({
    counts,
    muscle: def.id,
    label: def.label,
    total: def.target ? byTarget.get(def.target) ?? 0 : byBody.get(def.bodyPart ?? '') ?? 0,
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
