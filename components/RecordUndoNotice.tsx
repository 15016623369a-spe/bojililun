'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Removal = { label: string; href?: string } & ({ token: string } | { cardId: number });
const EVENT = 'fitcheck-record-removal';
const STORAGE = 'fitcheck-last-removal';

export function offerRecordUndo(removal: Removal) {
  try { sessionStorage.setItem(STORAGE, JSON.stringify(removal)); } catch { /* 当前页面仍可撤销 */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: removal }));
}

export default function RecordUndoNotice() {
  const router = useRouter();
  const [latest, setLatest] = useState<Removal | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [href, setHref] = useState('');

  useEffect(() => {
    try { setLatest(JSON.parse(sessionStorage.getItem(STORAGE) ?? 'null')); } catch { /* 无可恢复的回执 */ }
    const offer = (event: Event) => {
      setLatest((event as CustomEvent<Removal>).detail);
      setStatus('');
      setError('');
      setHref('');
    };
    window.addEventListener(EVENT, offer);
    return () => window.removeEventListener(EVENT, offer);
  }, []);

  function dismiss() {
    try { sessionStorage.removeItem(STORAGE); } catch { /* 回执仍可关闭 */ }
    setLatest(null);
    setStatus('');
    setError('');
    setHref('');
  }

  async function undo() {
    if (!latest || busy) return;
    setBusy(true);
    setError('');
    try {
      const ledger = 'cardId' in latest;
      const response = await fetch(ledger ? '/api/ledger' : '/api/record-undo', {
        method: ledger ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify('cardId' in latest ? { id: latest.cardId, deleted: false } : { token: latest.token }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '恢复失败，请重试');
      const destination = latest.href;
      dismiss();
      setStatus('记录已恢复');
      setHref(destination ?? '');
      router.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!latest && !status) return null;
  return <aside className="record-undo-notice" aria-label="记录回执">
    <p role="status">{latest?.label || status}</p>
    {latest && <button type="button" disabled={busy} onClick={() => void undo()}>{busy ? '恢复中…' : '撤销'}</button>}
    {href && <Link href={href}>查看</Link>}
    <button type="button" disabled={busy} aria-label="关闭回执" onClick={dismiss}>×</button>
    {error && <small role="alert">{error}</small>}
  </aside>;
}
