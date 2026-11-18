import { NextResponse } from 'next/server';
import { finishSession, getSession, getSessionSets, startSession } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { note?: string };
    const session = startSession(body.note);
    return NextResponse.json({ session });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as { id?: number };
    if (!body.id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    finishSession(body.id);
    const session = getSession(body.id);
    return NextResponse.json({ session, sets: getSessionSets(body.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
