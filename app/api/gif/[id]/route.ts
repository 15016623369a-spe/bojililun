import fs from 'node:fs';
import path from 'node:path';
import { getExercise } from '@/lib/exercise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GIF_DIR = path.join(process.cwd(), 'data', 'gifs');
const RAW_BASE = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/';

/**
 * 动作 GIF 采用「首次访问时拉取并落盘」的方式：
 * 仓库里不打包 130MB 媒体，但点进详情仍然能看到动图；
 * 拉取失败（离线 / 网络不通）就返回 404，前端自动回落到静态缩略图。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return new Response('bad id', { status: 400 });

  const file = path.join(GIF_DIR, `${id}.gif`);
  if (!fs.existsSync(file)) {
    const ex = getExercise(id);
    if (!ex?.gif_url) return new Response('not found', { status: 404 });
    try {
      const res = await fetch(RAW_BASE + ex.gif_url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return new Response('upstream error', { status: 404 });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) return new Response('empty', { status: 404 });
      fs.mkdirSync(GIF_DIR, { recursive: true });
      fs.writeFileSync(file, buf);
    } catch {
      return new Response('fetch failed', { status: 404 });
    }
  }

  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
