import { NextResponse } from 'next/server';
import { addSet, getSession, getSessionSets, markPlanDone, saveGuidedSet } from '@/lib/core/workout';

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
