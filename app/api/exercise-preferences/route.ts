import { NextResponse } from 'next/server';
import { setExercisePreference } from '@/lib/core/exercise-preferences';

export const runtime = 'nodejs';

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const exerciseId = body?.exerciseId;
  const preference = body?.preference;
  if (typeof exerciseId !== 'string' || !exerciseId ||
      (preference !== null && preference !== 'liked' && preference !== 'disliked')) {
    return NextResponse.json({ error: '动作或偏好无效' }, { status: 400 });
  }
  if (!setExercisePreference(exerciseId, preference)) {
    return NextResponse.json({ error: '找不到该动作' }, { status: 404 });
  }
  return NextResponse.json({ exerciseId, preference });
}
