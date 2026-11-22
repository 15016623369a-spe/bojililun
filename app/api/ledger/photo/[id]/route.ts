import { getDb } from '@/lib/db';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return new Response(null, { status: 404 });
  const row = getDb().prepare(`SELECT p.image FROM ledger_photos p
    JOIN entries e ON e.id = p.entry_id WHERE p.entry_id = ? AND e.user_id = 'local' AND e.is_deleted = 0`).get(id);
  const image = String(row?.image ?? '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!image) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(image[2], 'base64')), {
    headers: { 'Content-Type': image[1], 'Cache-Control': 'private, no-store' },
  });
}
