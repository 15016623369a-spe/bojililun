import { NextResponse } from 'next/server';
import { undoQuickEntry, writeQuickEntry } from '@/lib/core/journal';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { text, requestId, id } = await request.json();
    if (typeof text !== 'string' || (id === undefined && (typeof requestId !== 'string' || requestId.length > 64 || !requestId))
      || (id !== undefined && (!Number.isSafeInteger(id) || id < 1))) throw new Error('记录格式无效');
    return NextResponse.json({ entry: writeQuickEntry(text, requestId, id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: '记录不存在' }, { status: 400 });
  undoQuickEntry(id);
  return NextResponse.json({ ok: true });
}
