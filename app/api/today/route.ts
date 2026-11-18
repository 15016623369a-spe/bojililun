import { NextResponse } from 'next/server';
import { todaySnapshot } from '@/lib/core/meals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(todaySnapshot());
}
