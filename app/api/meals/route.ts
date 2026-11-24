import { NextResponse } from 'next/server';
import { confirmDraft, deleteMeal } from '@/lib/core/meals';
import type { FoodItem } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { draftId?: string; items?: FoodItem[] };
    if (!body.draftId) return NextResponse.json({ error: '这份饮食草稿已经过期了，重新识别一次就行' }, { status: 400 });
    const result = confirmDraft(body.draftId, body.items ?? []);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: '未找到这条饮食记录，请刷新重试' }, { status: 400 });
  }
  deleteMeal(id);
  return NextResponse.json({ ok: true });
}
