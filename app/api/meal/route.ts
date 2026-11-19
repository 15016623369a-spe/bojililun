import { NextResponse } from 'next/server';
import { updateMealGrams } from '@/lib/core/meals';

export const runtime = 'nodejs';

export async function PATCH(request: Request) {
  try {
    const { id, index, grams } = await request.json();
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(index) || index < 0
      || typeof grams !== 'number') throw new Error('记录格式无效');
    return NextResponse.json({ ok: true, ...updateMealGrams(id, index, grams) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}