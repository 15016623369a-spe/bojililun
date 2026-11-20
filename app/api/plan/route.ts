import { NextResponse } from 'next/server';
import { getExercise } from '@/lib/exercise';
import { addPlanExercises, addPlanItem, deletePlanItem, getPlan, updatePlanItem } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ items: getPlan() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      exerciseId?: string;
      exerciseIds?: string[];
      date?: string;
      sets?: number;
      reps?: number;
      weight?: number;
      restSec?: number;
    };
    if (body.exerciseIds !== undefined) {
      if (!body.date || !Array.isArray(body.exerciseIds) || body.exerciseIds.length === 0) {
        return NextResponse.json({ error: '请选择要加入计划的动作' }, { status: 400 });
      }
      const exercises = [...new Set(body.exerciseIds)].map((id) => {
        if (typeof id !== 'string') throw new Error('动作不存在');
        const exercise = getExercise(id);
        if (!exercise) throw new Error('动作不存在');
        return exercise;
      });
      return NextResponse.json({ items: addPlanExercises(body.date, exercises) });
    }
    if (!body.exerciseId) return NextResponse.json({ error: '缺少 exerciseId' }, { status: 400 });
    const ex = getExercise(body.exerciseId);
    if (!ex) return NextResponse.json({ error: '动作不存在' }, { status: 404 });

    const item = addPlanItem(ex, {
      sets: body.sets,
      reps: body.reps,
      weight: body.weight,
      restSec: body.restSec,
    });
    return NextResponse.json({ item, items: getPlan() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: number;
      sets?: number;
      reps?: number;
      weight?: number;
      restSec?: number;
      done?: number;
    };
    if (!body.id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    updatePlanItem(body.id, body);
    return NextResponse.json({ ok: true, items: getPlan() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
  deletePlanItem(id);
  return NextResponse.json({ ok: true, items: getPlan() });
}
