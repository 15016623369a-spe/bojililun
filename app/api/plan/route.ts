import { NextResponse } from 'next/server';
import { getExercise } from '@/lib/exercise';
import { imageUrl } from '@/lib/exercise-label';
import { sculptureMediaUrls } from '@/lib/exercise-anim';
import { activeTraining, addPlanExercises, addPlanItem, completePlannedExercise, deletePlanItem, getPlan, reorderPlanItems, todayStr, updatePlanItem } from '@/lib/core/workout';

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
      supplemental?: boolean;
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
      return NextResponse.json(addPlanExercises(body.date, exercises, body.supplemental === true));
    }
    if (!body.exerciseId) return NextResponse.json({ error: '请先选择动作' }, { status: 400 });
    const ex = getExercise(body.exerciseId);
    if (!ex) return NextResponse.json({ error: '动作不存在' }, { status: 404 });

    const today = todayStr();
    const active = activeTraining();
    const targetDate = (!body.date || body.date === today) && active ? active.date : body.date;
    const item = addPlanItem(ex, {
      sets: body.sets,
      reps: body.reps,
      weight: body.weight,
      restSec: body.restSec,
      date: targetDate,
    });
    const demonstration = {
      image: ex.image ? imageUrl(ex.image) : undefined,
      hasAnimation: Boolean(ex.gif_url),
      ...sculptureMediaUrls(ex.id),
    };
    return NextResponse.json({ item, demonstration, items: getPlan(targetDate) });
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
      complete?: boolean;
      reorder?: number[];
      date?: string;
    };
    if (Array.isArray(body.reorder)) {
      reorderPlanItems(body.reorder);
      return NextResponse.json({ ok: true, items: getPlan(body.date) });
    }
    if (!body.id) return NextResponse.json({ error: '未找到对应的计划动作，请刷新重试' }, { status: 400 });
    if (body.complete === true) {
      if (!Number.isSafeInteger(body.id) || body.id < 1) throw new Error('计划动作无效');
      completePlannedExercise(body.id);
      return NextResponse.json({ ok: true });
    }
    const date = updatePlanItem(body.id, body);
    return NextResponse.json({ ok: true, items: getPlan(date) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: '未找到对应的计划动作，请刷新重试' }, { status: 400 });
  const date = deletePlanItem(id);
  return NextResponse.json({ ok: true, items: getPlan(date) });
}
