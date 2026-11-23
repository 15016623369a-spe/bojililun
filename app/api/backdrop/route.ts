import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { UPLOAD_DIR } from '@/lib/db';
import { BACKDROP_COOKIE, backdropUrl } from '@/lib/backdrop-preference';

export const runtime = 'nodejs';

const MAX_BYTES = 6 * 1024 * 1024;
const YEAR = 60 * 60 * 24 * 365;

/** 只留最新的一张背景，换图或移除时清掉旧文件 */
function clearOld(keep?: string) {
  if (!fs.existsSync(UPLOAD_DIR)) return;
  for (const file of fs.readdirSync(UPLOAD_DIR)) {
    if (/^bg-\d+-[a-f0-9]{6}\.jpg$/.test(file) && file !== keep) fs.rmSync(path.join(UPLOAD_DIR, file), { force: true });
  }
}

/** 上传背景：前端先缩到长边 1600、转成 JPEG，再以 data URL 发过来 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { image?: unknown } | null;
  const m = typeof body?.image === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null;
  if (!m) return NextResponse.json({ error: '只支持 JPEG 图片' }, { status: 400 });
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length || buf.length > MAX_BYTES) return NextResponse.json({ error: '图片太大了，换一张小一点的' }, { status: 413 });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `bg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  clearOld(name);
  (await cookies()).set(BACKDROP_COOKIE, name, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  return NextResponse.json({ name, url: backdropUrl(name) });
}

/** 移除背景：回到原来的冷银灰 */
export async function DELETE() {
  clearOld();
  (await cookies()).delete(BACKDROP_COOKIE);
  return NextResponse.json({ ok: true });
}
