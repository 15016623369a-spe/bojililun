import { NextResponse } from 'next/server';
import { answerQuestion } from '@/lib/ask';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 提问 → 流式短答（SSE）：先给结构，再逐段吐字 */
export async function POST(req: Request) {
  let body: { question?: string };
  try {
    body = (await req.json()) as { question?: string };
  } catch {
    return NextResponse.json({ error: '请求出了点问题，刷新页面再试一下' }, { status: 400 });
  }
  const question = String(body.question ?? '').trim();
  if (!question || question.length > 1000) return NextResponse.json({ error: '问题需要 1 至 1000 个字' }, { status: 400 });

  const answer = answerQuestion(question);
  const { text, ...meta } = answer;
  const encoder = new TextEncoder();

  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      send({ type: 'meta', answer: meta });
      await sleep(140);

      const chars = Array.from(text);
      for (let i = 0; i < chars.length; i += 3) {
        if (cancelled) return;
        send({ type: 'chunk', text: chars.slice(i, i + 3).join('') });
        await sleep(16);
      }
      if (cancelled) return;
      send({ type: 'done' });
      controller.close();
    },
    cancel() { cancelled = true; },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
