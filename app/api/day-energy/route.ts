import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setDayEnergy } from '@/lib/day-energy';
import { localDay } from '@/lib/ledger';
import { validDate } from '@/lib/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 设置某天（今天或过去）的精力 1–5；level 为 null 清除 */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null) as { date?: string; level?: number | null } | null;
  const today = localDay(new Date().toISOString());
  const date = body?.date ?? today;
  if (!validDate(date) || date > today) return NextResponse.json({ error: '日期无效' }, { status: 400 });
  const level = body?.level ?? null;
  try {
    setDayEnergy(getDb(), 'local', date, level);
    return NextResponse.json({ date, level });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
