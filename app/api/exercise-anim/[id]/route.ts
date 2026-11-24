import fs from 'node:fs';
import path from 'node:path';
import { isValidExerciseId } from '@/lib/exercise-anim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function localAnimRoot(): string {
  return path.resolve(process.env.SCULPTURE_SRC_DIR || path.join(process.cwd(), '..', 'output', 'exercise-anims'));
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidExerciseId(id)) return new Response('bad id', { status: 400 });

  const kind = new URL(req.url).searchParams.get('kind');
  const root = localAnimRoot();

  if (kind === 'kf') {
    const pubKf = path.join(process.cwd(), 'public', 'sculpture-exercises', 'kf', `${id}.jpg`);
    if (fs.existsSync(pubKf)) {
      return new Response(new Uint8Array(fs.readFileSync(pubKf)), {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600' },
      });
    }
    const localSheet = path.join(root, 'sheets', `${id}.png`);
    if (fs.existsSync(localSheet)) {
      return new Response(new Uint8Array(fs.readFileSync(localSheet)), {
        headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
      });
    }
    return new Response('not found', { status: 404 });
  }

  const pubMp4 = path.join(process.cwd(), 'public', 'sculpture-exercises', 'mp4', `${id}.mp4`);
  const mp4File = fs.existsSync(pubMp4) ? pubMp4 : path.join(root, 'mp4', `${id}.mp4`);
  if (!fs.existsSync(mp4File)) return new Response('not found', { status: 404 });

  const stat = fs.statSync(mp4File);
  const total = stat.size;
  const range = req.headers.get('range');

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
      if (start <= end && start < total) {
        const len = end - start + 1;
        const buf = Buffer.allocUnsafe(len);
        const fd = fs.openSync(mp4File, 'r');
        try {
          fs.readSync(fd, buf, 0, len, start);
        } finally {
          fs.closeSync(fd);
        }
        return new Response(new Uint8Array(buf), {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-range': `bytes ${start}-${end}/${total}`,
            'accept-ranges': 'bytes',
            'content-length': String(len),
            'cache-control': 'no-store',
          },
        });
      }
    }
  }

  return new Response(new Uint8Array(fs.readFileSync(mp4File)), {
    headers: {
      'content-type': 'video/mp4',
      'accept-ranges': 'bytes',
      'content-length': String(total),
      'cache-control': 'no-store',
    },
  });
}
