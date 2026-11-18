import { NextResponse } from 'next/server';
import { finishSession, getSession, getSessionSets, startSession } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { note?: string; firstPlanItemId?: number; guided?: boolean };
    const session = startSession(body.note, body.firstPlanItemId, body.guided === true || body.firstPlanItemId !== undefined);
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
