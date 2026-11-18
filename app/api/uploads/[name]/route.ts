import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from '@/lib/db';

export const runtime = 'nodejs';

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const safe = path.basename(name);
  if (!/^[A-Za-z0-9._-]+$/.test(safe)) {
    return new Response('bad name', { status: 400 });
  }
  const file = path.join(UPLOAD_DIR, safe);
  if (!fs.existsSync(file)) {
    return new Response('not found', { status: 404 });
  }
  const ext = safe.split('.').pop()?.toLowerCase() ?? '';
  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
