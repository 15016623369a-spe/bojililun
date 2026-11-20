import { NextResponse } from 'next/server';
import { finishSession, getSession, getSessionSets, startSession } from '@/lib/core/workout';
import { getExercise } from '@/lib/exercise';
import type { SupplementalExercise } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      note?: string;
      firstPlanItemId?: number;
      guided?: boolean;
      usePlanProgress?: boolean;
      supplementalExercises?: SupplementalExercise[];
    };
    const requested = body.supplementalExercises;
    if (requested !== undefined && (!Array.isArray(requested) || requested.length === 0)) {
      throw new Error('请至少添加一个加练动作');
    }
    const supplemental = requested?.map((item) => {
      if (!item || typeof item.exerciseId !== 'string') throw new Error('请选择加练动作');
      const exercise = getExercise(item.exerciseId);
      if (!exercise) throw new Error('加练动作不存在');
      if (!Number.isInteger(item.sets) || item.sets < 1 || item.sets > 20) throw new Error('组数需要在 1 至 20 之间');
      if (!Number.isInteger(item.reps) || item.reps < 1 || item.reps > 100) throw new Error('次数需要在 1 至 100 之间');
      if (!Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1000) throw new Error('重量需要在 0 至 1000 kg 之间');
      if (!Number.isInteger(item.restSec) || item.restSec < 0 || item.restSec > 600) throw new Error('休息时间需要在 0 至 600 秒之间');
      return { exercise, sets: item.sets, reps: item.reps, weight: item.weight, restSec: item.restSec };
    });
    const guided = body.guided === true || body.firstPlanItemId !== undefined;
    const session = startSession({ note: body.note, firstPlanItemId: body.firstPlanItemId, guided, usePlanProgress: body.usePlanProgress === true, supplemental });
    return NextResponse.json({ session });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as { id?: number };
    if (!body.id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    if (!getSession(body.id)) return NextResponse.json({ error: '训练不存在' }, { status: 404 });
    finishSession(body.id);
    const session = getSession(body.id);
    return NextResponse.json({ session, sets: getSessionSets(body.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
