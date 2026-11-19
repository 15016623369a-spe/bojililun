/**
 * 解析可用的 chrome-headless-shell 可执行文件。
 * 优先级：CHROMIUM_SHELL 环境变量 → 项目 ../.playwright → 系统 Playwright 缓存。
 * 都找不到时给出安装提示，而不是写死某台机器的路径。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function innerDirs() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64'
      ? ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell']
      : ['chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell'];
  }
  if (process.platform === 'win32') return ['chrome-headless-shell-win64/chrome-headless-shell.exe'];
  return ['chrome-headless-shell-linux64/chrome-headless-shell'];
}

export function resolveChromiumShell() {
  if (process.env.CHROMIUM_SHELL) {
    if (fs.existsSync(process.env.CHROMIUM_SHELL)) return process.env.CHROMIUM_SHELL;
    throw new Error(`CHROMIUM_SHELL 指向的文件不存在：${process.env.CHROMIUM_SHELL}`);
  }

  const roots = [
    path.resolve(projectRoot, '../.playwright'),
    path.join(os.homedir(), 'Library/Caches/ms-playwright'),
    path.join(os.homedir(), '.cache/ms-playwright'),
  ];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const versions = fs
      .readdirSync(root)
      .filter((d) => /^chromium_headless_shell-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const v of versions) {
      for (const inner of innerDirs()) {
        const p = path.join(root, v, inner);
        if (fs.existsSync(p)) return p;
      }
    }
  }

  throw new Error(
    '找不到 chrome-headless-shell。先运行 npx playwright install chromium，' +
      '或用 CHROMIUM_SHELL=/path/to/chrome-headless-shell 指定。',
  );
}