import { NextResponse } from 'next/server';
import { addSet, getSession, getSessionSets, markPlanDone, saveGuidedSet, updateSessionSet } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as {
      sessionId?: number;
      planItemId?: number | null;
      exerciseId?: string;
      exerciseName?: string;
      bodyPart?: string;
      target?: string;
      setIndex?: number;
      weight?: number;
      reps?: number;
      durationSec?: number;
      restSec?: number;
      previousSetId?: number;
      previousRestSec?: number;
    };
    if (b.sessionId && getSession(b.sessionId)?.plan_json) {
      if (!b.planItemId || !b.setIndex) {
        return NextResponse.json({ error: '缺少动作或组号' }, { status: 400 });
      }
      const number = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
      return NextResponse.json(saveGuidedSet(b.sessionId, {
        planItemId: b.planItemId,
        setIndex: b.setIndex,
        weight: number(b.weight),
        reps: number(b.reps),
        durationSec: number(b.durationSec),
        restSec: Math.min(600, number(b.restSec)),
        previousSetId: b.previousSetId,
        previousRestSec: b.previousRestSec === undefined ? undefined : Math.min(86400, number(b.previousRestSec)),
      }));
    }
    if (!b.sessionId || !b.exerciseId) {
      return NextResponse.json({ error: '缺少 sessionId / exerciseId' }, { status: 400 });
    }
    addSet(b.sessionId, {
      planItemId: b.planItemId ?? null,
      exerciseId: b.exerciseId,
      exerciseName: b.exerciseName ?? '',
      bodyPart: b.bodyPart,
      target: b.target,
      setIndex: b.setIndex ?? 1,
      weight: Number(b.weight) || 0,
      reps: Number(b.reps) || 0,
      durationSec: Number(b.durationSec) || 0,
      restSec: Number(b.restSec) || 0,
    });
    if (b.planItemId) markPlanDone(b.planItemId);
    return NextResponse.json({ ok: true, sets: getSessionSets(b.sessionId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as { id?: number; weight?: number; reps?: number };
    if (!Number.isInteger(body.id) || Number(body.id) <= 0) {
      return NextResponse.json({ error: '缺少训练组 id' }, { status: 400 });
    }
    if (body.weight !== undefined && (!Number.isFinite(body.weight) || Number(body.weight) < 0 || Number(body.weight) > 1000)) {
      return NextResponse.json({ error: '重量需要在 0 至 1000 kg 之间' }, { status: 400 });
    }
    if (body.reps !== undefined && (!Number.isFinite(body.reps) || Number(body.reps) < 1 || Number(body.reps) > 1000)) {
      return NextResponse.json({ error: '次数需要在 1 至 1000 次之间' }, { status: 400 });
    }
    const set = updateSessionSet(Number(body.id), { weight: body.weight, reps: body.reps });
    return NextResponse.json({ set });
  } catch (e) {
    const error = e as Error;
    return NextResponse.json({ error: error.message }, { status: error.message === '训练组不存在' ? 404 : 400 });
  }
}
