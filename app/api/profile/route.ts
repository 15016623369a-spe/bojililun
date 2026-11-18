import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { calcTargets, ACTIVITY, GOAL, type ActivityKey, type GoalKey, type Sex } from '@/lib/nutrition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const row = getDb().prepare('SELECT * FROM profile WHERE id = 1').get();
  return NextResponse.json({ profile: row ?? null });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;

  const num = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };

  const sex: Sex = body.sex === 'female' ? 'female' : 'male';
  const activity = (typeof body.activity === 'string' && body.activity in ACTIVITY ? body.activity : 'light') as ActivityKey;
  const goal = (typeof body.goal === 'string' && body.goal in GOAL ? body.goal : 'maintain') as GoalKey;

  const input = {
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 20) : '我',
    sex,
    age: Math.round(num(body.age, 12, 90, 25)),
    height_cm: num(body.height_cm, 120, 230, 175),
    weight_kg: num(body.weight_kg, 30, 250, 70),
    activity,
    goal,
    protein_per_kg: num(body.protein_per_kg, 1, 3, GOAL[goal].protein),
  };

  const targets = calcTargets(input);

  getDb()
    .prepare(
      `INSERT INTO profile (id, name, sex, age, height_cm, weight_kg, activity, goal, protein_per_kg, target_kcal, target_protein, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, sex = excluded.sex, age = excluded.age,
         height_cm = excluded.height_cm, weight_kg = excluded.weight_kg,
         activity = excluded.activity, goal = excluded.goal,
         protein_per_kg = excluded.protein_per_kg,
         target_kcal = excluded.target_kcal, target_protein = excluded.target_protein,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.name,
      input.sex,
      input.age,
      input.height_cm,
      input.weight_kg,
      input.activity,
      input.goal,
      input.protein_per_kg,
      targets.target_kcal,
      targets.target_protein,
      new Date().toISOString(),
    );

  const profile = getDb().prepare('SELECT * FROM profile WHERE id = 1').get();
  return NextResponse.json({ profile, targets });
}
