'use client';

import { useEffect } from 'react';
import { flushOfflineOutbox, syncOfflineBootstrap } from '@/lib/offline-api';

/**
 * 全局离线运行时：注册 Service Worker、首次连网时静默下载离线动作库与训练快照，
 * 并在重新连网时自动把离线期间记录的组数同步回服务端。
 */
export default function OfflineRuntime() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    const boot = async () => {
      if ('serviceWorker' in navigator) {
        try {
          await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        } catch { /* 非信任证书环境下会拒绝注册，设置页会引导安装信任证书 */ }
      }
      if (cancelled || !navigator.onLine) return;
      try {
        await syncOfflineBootstrap();
      } catch { /* 离线时忽略 */ }
    };

    const timer = window.setTimeout(() => void boot(), 1200);
    const onOnline = () => {
      void flushOfflineOutbox().then(() => syncOfflineBootstrap()).catch(() => {});
    };
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return null;
}
