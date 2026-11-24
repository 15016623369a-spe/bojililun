import { NextResponse } from 'next/server';
import { archiveMemory, deleteMemory, listMemories, upsertMemory } from '@/lib/memory';
import type { CandidateMemory, MemoryKind } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: MemoryKind[] = ['constraint', 'preference', 'fact', 'goal', 'equipment'];

export async function GET() {
  return NextResponse.json({ memories: listMemories() });
}

function sanitize(c: Partial<CandidateMemory>): CandidateMemory | null {
  const kind = KINDS.includes(c.kind as MemoryKind) ? (c.kind as MemoryKind) : null;
  const content = typeof c.content === 'string' ? c.content.trim().slice(0, 200) : '';
  if (!kind || !content) return null;
  const key = typeof c.key === 'string' && c.key.trim() ? c.key.trim().slice(0, 80) : `${kind}:${content.slice(0, 20)}`;
  const importance = Number(c.importance);
  return {
    kind,
    key,
    content,
    importance: Number.isFinite(importance) ? Math.min(5, Math.max(1, Math.round(importance))) : 3,
  };
}

export async function POST(req: Request) {
  const body = (await req.json()) as { candidates?: Partial<CandidateMemory>[]; candidate?: Partial<CandidateMemory> };
  const incoming = body.candidates ?? (body.candidate ? [body.candidate] : []);
  const results = incoming
    .map(sanitize)
    .filter((x): x is CandidateMemory => x !== null)
    .map((c) => upsertMemory({ ...c, source: 'chat' }));

  return NextResponse.json({ results, memories: listMemories() });
}

export async function DELETE(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = Number(params.get('id'));
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: '未找到这条偏好，请刷新重试' }, { status: 400 });
  if (params.get('soft') === '1') archiveMemory(id);
  else deleteMemory(id);
  return NextResponse.json({ ok: true, memories: listMemories() });
}
