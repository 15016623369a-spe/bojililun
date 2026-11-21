import { NextResponse } from 'next/server';
import { saveTrainingProfile } from '@/lib/core/training-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    return NextResponse.json({ profile: saveTrainingProfile(body) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '资料保存失败' }, { status: 400 });
  }
}
