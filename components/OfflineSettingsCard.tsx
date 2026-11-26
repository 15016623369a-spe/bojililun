'use client';

import { useEffect, useRef, useState } from 'react';
import { flushOfflineOutbox, syncOfflineBootstrap } from '@/lib/offline-api';
import {
  exportOfflineBackupJson,
  importOfflineBackupJson,
  readOfflineExercises,
  readOfflineSnapshot,
  readOutbox,
} from '@/lib/offline-store';

/** 「我的」页里的离线模式与数据备份卡片：一键更新离线包、下载信任证书、导出/恢复备份 */
export default function OfflineSettingsCard() {
  const [swReady, setSwReady] = useState(false);
  const [exCount, setExCount] = useState(0);
  const [syncedAt, setSyncedAt] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function refreshStatus() {
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    const [snap, exs, outbox] = await Promise.all([readOfflineSnapshot(), readOfflineExercises(), readOutbox()]);
    setExCount(exs?.length ?? 0);
    setSyncedAt(snap?.syncedAt ?? '');
    setPendingCount(outbox.length);
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration('/').catch(() => undefined);
      setSwReady(Boolean(reg?.active || navigator.serviceWorker.controller));
    }
  }

  useEffect(() => {
    void refreshStatus();
    const onChange = () => void refreshStatus();
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    return () => {
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    };
  }, []);

  async function handleSync() {
    setBusy(true);
    setMsg('');
    try {
      const flushed = await flushOfflineOutbox();
      const res = await syncOfflineBootstrap();
      await refreshStatus();
      if (res) setMsg(`离线包已更新（${res.exercises} 个动作${flushed > 0 ? `，已同步 ${flushed} 条离线记录` : ''}）`);
      else setMsg('暂时连不上电脑服务，当前继续使用本地数据');
    } catch {
      setMsg('更新失败，请确认连着同一网络后重试');
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    setMsg('');
    try {
      const json = await exportOfflineBackupJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fitcheck-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg('备份文件已导出，建议存到手机「文件」或 iCloud');
    } catch {
      setMsg('导出失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg('');
    try {
      const text = await file.text();
      const res = await importOfflineBackupJson(text);
      await refreshStatus();
      setMsg(`已恢复本地备份（${res.planCount} 项计划，${res.setsCount} 组记录）`);
    } catch (e) {
      setMsg((e as Error).message || '恢复失败');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const stateText = !online
    ? '当前断网 · 手机本地运行中'
    : swReady && exCount > 0
      ? `已就绪 · 断网可用（已缓存 ${exCount} 个动作）`
      : exCount > 0
        ? '已存本地数据 · 安装下方信任证书后即可彻底断网打开'
        : '尚未下载离线包';

  return (
    <section className="me-card" aria-label="手机离线与数据安全" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <b style={{ fontSize: 15 }}>手机离线与数据备份</b>
        <span style={{ fontSize: 12, opacity: 0.72 }}>{pendingCount > 0 ? `${pendingCount} 条待同步` : syncedAt ? '已同步' : '本地'}</span>
      </div>
      <p style={{ margin: '6px 0 12px', fontSize: 13, opacity: 0.8, lineHeight: 1.5 }}>{stateText}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="ghost-pill" disabled={busy || !online} onClick={() => void handleSync()}>
          {busy ? '处理中…' : '更新离线包'}
        </button>
        <button type="button" className="ghost-pill" disabled={busy} onClick={() => void handleExport()}>
          导出备份文件
        </button>
        <button type="button" className="ghost-pill" disabled={busy} onClick={() => fileRef.current?.click()}>
          从备份恢复
        </button>
        {!swReady && (
          <a className="ghost-pill" href="/api/cert">
            安装手机信任证书
          </a>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => void handleImport(e.target.files?.[0])}
      />
      {msg && <p style={{ margin: '10px 0 0', fontSize: 12, opacity: 0.85 }}>{msg}</p>}
    </section>
  );
}
