import { NextResponse } from 'next/server';
import { classifyIntent } from '@/lib/intent';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { raw_text: rawText } = await request.json() as { raw_text?: unknown };
    if (typeof rawText !== 'string' || !rawText.trim() || rawText.length > 1000) {
      return NextResponse.json({ error: '语音内容需要 1 至 1000 个字' }, { status: 400 });
    }
    const { intent, confidence } = await classifyIntent(rawText);
    return NextResponse.json({ intent, confidence });
  } catch {
    return NextResponse.json({ error: '意图识别失败，请重试' }, { status: 400 });
  }
}
