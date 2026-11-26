/**
 * 确保本地 Root CA 与服务端证书存在：
 * - certificates/fitcheck-root-ca.pem / .key（持久根证书，iPhone 只需安装信任一次）
 * - certificates/localhost.pem / localhost-key.pem（由根证书签发，含当前全部局域网 IP）
 * 当局域网或热点 IP 变化时自动重签叶子证书，不换根证书，iPhone 无需重新信任。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'certificates');
const caCert = path.join(dir, 'fitcheck-root-ca.pem');
const caKey = path.join(dir, 'fitcheck-root-ca.key');
const cert = path.join(dir, 'localhost.pem');
const key = path.join(dir, 'localhost-key.pem');
const csr = path.join(dir, 'localhost.csr');
const extFile = path.join(dir, 'localhost.ext');

const ips = [...new Set(
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address),
)];

fs.mkdirSync(dir, { recursive: true });

// 1. 生成持久本地根证书（若不存在）
if (!fs.existsSync(caCert) || !fs.existsSync(caKey)) {
  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', caKey, '-out', caCert, '-days', '3650',
        '-subj', '/CN=FitCheck Local CA/O=FitCheck',
        '-addext', 'basicConstraints=critical,CA:TRUE',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
      ],
      { stdio: 'ignore' },
    );
    console.log('[ensure-cert] 已生成 FitCheck 本地根证书（certificates/fitcheck-root-ca.pem）');
  } catch {
    console.error('[ensure-cert] 生成根证书失败：需要 openssl。');
    process.exit(1);
  }
}

// 2. 检查现有叶子证书是否由根证书签发且覆盖全部当前 IP
if (fs.existsSync(cert) && fs.existsSync(key)) {
  try {
    execFileSync('openssl', ['verify', '-CAfile', caCert, cert], { stdio: 'ignore' });
    const ext = execFileSync('openssl', ['x509', '-in', cert, '-noout', '-ext', 'subjectAltName'], { encoding: 'utf8' });
    if (ips.every((ip) => ext.includes(`IP Address:${ip}`))) process.exit(0);
    console.log('[ensure-cert] 检测到局域网或热点 IP 变化，正在更新服务端证书…');
  } catch {
    console.log('[ensure-cert] 正在用本地根证书重新签发服务端证书…');
  }
}

// 3. 用本地根证书签发符合 Apple iOS TLS 规范的服务端证书
const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
fs.writeFileSync(
  extFile,
  [
    'authorityKeyIdentifier=keyid,issuer',
    'basicConstraints=CA:FALSE',
    'keyUsage=digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    `subjectAltName=${san}`,
  ].join('\n'),
);

try {
  execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', '/CN=FitCheck Local'], { stdio: 'ignore' });
  execFileSync('openssl', ['x509', '-req', '-in', csr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial', '-out', cert, '-days', '365', '-sha256', '-extfile', extFile], { stdio: 'ignore' });
  console.log(`[ensure-cert] 已签发服务端证书（SAN: ${san}）`);
} catch {
  console.error('[ensure-cert] 签发服务端证书失败：需要 openssl。');
  process.exit(1);
} finally {
  for (const tmp of [csr, extFile]) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}
