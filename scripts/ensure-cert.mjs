/**
 * 确保证书存在：certificates/localhost.pem + localhost-key.pem。
 * 缺失时用 openssl 生成自签证书，SAN 覆盖 localhost / 127.0.0.1 / 当前局域网 IP，
 * 让手机通过 https://<局域网IP>:3001 访问时麦克风等能力可用。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'certificates');
const cert = path.join(dir, 'localhost.pem');
const key = path.join(dir, 'localhost-key.pem');

if (fs.existsSync(cert) && fs.existsSync(key)) process.exit(0);

const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);
const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');

fs.mkdirSync(dir, { recursive: true });
try {
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
      '-days', '365', '-subj', '/CN=FitCheck Dev', '-addext', `subjectAltName=${san}`],
    { stdio: 'ignore' },
  );
  console.log(`[ensure-cert] 已生成自签证书（SAN: ${san}）`);
} catch {
  console.error('[ensure-cert] 生成证书失败：需要 openssl。也可以手动放置 certificates/localhost.pem 与 localhost-key.pem。');
  process.exit(1);
}