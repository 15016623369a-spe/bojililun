/**
 * 开发服务入口：同一端口同时兼容 HTTP 与 HTTPS。
 * - 内部起 next dev（HTTPS，端口 INTERNAL_PORT）
 * - 对外端口嗅探首字节：TLS 握手(0x16) → 透传给内部 HTTPS；
 *   明文 HTTP → 301 跳转到 https://同主机:对外端口（旧 http 书签/链接也能打开）
 * 这样手机/电脑无论输 http 还是 https 都能进页面，且最终落在 HTTPS 上，麦克风可用。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3001);
const INTERNAL_PORT = Number(process.env.INTERNAL_PORT || 3002);

const child = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules/next/dist/bin/next'),
    'dev', '--turbopack', '-p', String(INTERNAL_PORT),
    '--experimental-https',
    '--experimental-https-key', 'certificates/localhost-key.pem',
    '--experimental-https-cert', 'certificates/localhost.pem',
  ],
  { cwd: root, stdio: 'inherit', env: process.env },
);
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));

// 等内部服务就绪后再开放对外端口
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(INTERNAL_PORT, '127.0.0.1', () => { s.end(); resolve(true); });
      s.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error('[dev-server] 内部 next dev 迟迟未就绪');
  process.exit(1);
}
await waitReady();

const server = net.createServer((socket) => {
  socket.once('data', (head) => {
    if (head[0] === 0x16) {
      // TLS ClientHello → 透传到内部 HTTPS 服务
      const upstream = net.connect(INTERNAL_PORT, '127.0.0.1', () => {
        upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    } else {
      // 明文 HTTP → 跳 HTTPS（保留主机名，局域网 IP / localhost 都适用）
      const text = head.toString('latin1');
      const host = /host:\s*([^\r\n]+)/i.exec(text)?.[1]?.split(':')[0] || '127.0.0.1';
      const url = /^GET\s+(\S+)/.exec(text)?.[1] || '/';
      socket.end(
        `HTTP/1.1 301 Moved Permanently\r\nLocation: https://${host}:${PORT}${url}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n`,
      );
    }
  });
  socket.on('error', () => socket.destroy());
});
server.listen(PORT, () => {
  console.log(`[dev-server] http/https 兼容入口已就绪：https://localhost:${PORT} （http 会自动跳转 https）`);
});