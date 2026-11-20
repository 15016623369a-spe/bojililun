import { NextResponse } from 'next/server';
import { TrainingConflictError, undoQuickEntry, updateQuickMealAmount, writeQuickEntry } from '@/lib/core/journal';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { text, requestId, id, resolution, replacementExerciseId } = await request.json();
    if (typeof text !== 'string' || (id === undefined && (typeof requestId !== 'string' || requestId.length > 64 || !requestId))
      || (id !== undefined && (!Number.isSafeInteger(id) || id < 1))
      || (resolution !== undefined && resolution !== 'actual')
      || (replacementExerciseId !== undefined && typeof replacementExerciseId !== 'string')) throw new Error('记录格式无效');
    return NextResponse.json({ entry: writeQuickEntry(text, requestId, id, resolution, replacementExerciseId) });
  } catch (err) {
    if (err instanceof TrainingConflictError) {
      return NextResponse.json({ error: err.message, conflict: err.conflict }, { status: 409 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: '记录不存在' }, { status: 400 });
  undoQuickEntry(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  try {
    const { quickId, index, amount } = await request.json();
    if (!Number.isSafeInteger(quickId) || quickId < 1 || !Number.isSafeInteger(index) || index < 0
      || typeof amount !== 'string') throw new Error('记录格式无效');
    return NextResponse.json({ ok: true, amount: updateQuickMealAmount(quickId, index, amount) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
