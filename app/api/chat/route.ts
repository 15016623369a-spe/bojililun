import { NextResponse } from 'next/server';
import { handleChat } from '@/lib/core/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { text?: string; image?: string };
  try {
    body = (await req.json()) as { text?: string; image?: string };
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const replies = await handleChat({ text: body.text, imageDataUrl: body.image });
  return NextResponse.json({ replies });
}
