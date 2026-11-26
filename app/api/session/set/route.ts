import { NextResponse } from 'next/server';
import { addSet, appendSessionSet, deleteSessionSet, getSession, getSessionSets, markPlanDone, saveGuidedSet, updateSessionSet } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clampNumber = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback);

function assertWeight(value: unknown) {
  if (value === undefined) return;
  if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1000) {
    throw new Error('重量需要在 0 至 1000 kg 之间');
  }
}

function assertReps(value: unknown) {
  if (value === undefined) return;
  if (!Number.isFinite(Number(value)) || Number(value) < 1 || Number(value) > 1000) {
    throw new Error('次数需要在 1 至 1000 次之间');
  }
}

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
      chooseExercise?: boolean;
      previousRestSec?: number;
      freeMode?: boolean;
      /** 回顾页追加一组：只追加，不走引导式训练进度校验 */
      append?: boolean;
    };
    if (b.append === true) {
      if (!Number.isSafeInteger(b.sessionId) || Number(b.sessionId) < 1) throw new Error('未找到当前训练，请刷新重试');
      if (typeof b.exerciseId !== 'string' || !b.exerciseId) throw new Error('请先选择动作');
      assertWeight(b.weight);
      assertReps(b.reps);
      const sets = appendSessionSet(Number(b.sessionId), b.exerciseId, { weight: b.weight, reps: b.reps });
      return NextResponse.json({ ok: true, sets });
    }
    if (b.sessionId && getSession(b.sessionId)?.plan_json) {
      if (!b.planItemId || !b.setIndex) {
        return NextResponse.json({ error: '缺少动作或组号' }, { status: 400 });
      }
      return NextResponse.json(saveGuidedSet(b.sessionId, {
        planItemId: b.planItemId,
        setIndex: b.setIndex,
        weight: clampNumber(b.weight),
        reps: clampNumber(b.reps),
        durationSec: clampNumber(b.durationSec),
        restSec: Math.min(600, clampNumber(b.restSec)),
        previousSetId: b.previousSetId,
        chooseExercise: b.chooseExercise === true,
        freeMode: b.freeMode === true,
        previousRestSec: b.previousRestSec === undefined ? undefined : Math.min(86400, clampNumber(b.previousRestSec)),
      }));
    }
    if (!b.sessionId || !b.exerciseId) {
      return NextResponse.json({ error: '未找到当前训练或动作，请刷新重试' }, { status: 400 });
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
      return NextResponse.json({ error: '未找到这一组记录，请刷新重试' }, { status: 400 });
    }
    assertWeight(body.weight);
    assertReps(body.reps);
    const set = updateSessionSet(Number(body.id), { weight: body.weight, reps: body.reps });
    return NextResponse.json({ set });
  } catch (e) {
    const error = e as Error;
    return NextResponse.json({ error: error.message }, { status: error.message === '训练组不存在' ? 404 : 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    const live = url.searchParams.get('live') === '1';
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('未找到这一组记录，请刷新重试');
    return NextResponse.json({ ok: true, ...deleteSessionSet(id, { allowActive: live }) });
  } catch (e) {
    const error = e as Error;
    return NextResponse.json({ error: error.message }, { status: error.message === '训练组不存在' ? 404 : 400 });
  }
}
