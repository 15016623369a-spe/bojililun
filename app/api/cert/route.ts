import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 下载本地根证书，供 iPhone 安装信任后启用完整离线缓存能力 */
export async function GET() {
  const caPath = path.join(process.cwd(), 'certificates', 'fitcheck-root-ca.pem');
  if (!fs.existsSync(caPath)) {
    return NextResponse.json({ error: '本机尚未生成根证书，请先使用加密模式启动服务' }, { status: 404 });
  }
  const pem = fs.readFileSync(caPath);
  return new NextResponse(pem, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="FitCheck-CA.cer"',
      'Cache-Control': 'no-store',
    },
  });
}
