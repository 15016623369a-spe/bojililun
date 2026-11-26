'use client';

import { useRef, useState } from 'react';
import { offlineFetch } from '@/lib/offline-api';
import HoldToEndTraining from './HoldToEndTraining';
import Icon from './ui/Icon';

export default function EndTrainingButton({ sessionId, completedSets, disabled, onEnded, resumeHref }: {
  sessionId: number;
  completedSets: number;
  disabled?: boolean;
  onEnded: () => void;
  resumeHref?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fromHold: boolean } | null>(null);

  async function finish(fromHold = false) {
    if (saving.current || disabled) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await offlineFetch('/api/session', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: sessionId }),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || '结束训练失败，请重试');
      }
      setConfirming(false);
      onEnded();
    } catch (err) {
      setError({ message: (err as Error).message, fromHold });
      saving.current = false;
      setBusy(false);
    }
  }

  return <>
    {resumeHref && <>
      <HoldToEndTraining href={resumeHref} ending={busy} onEnd={() => void finish(true)} />
      {error?.fromHold && <p className="form-err training-hold-error" role="alert">{error.message}</p>}
    </>}
    {!confirming && <button ref={trigger} type="button" className={resumeHref ? 'training-stop' : 'runner-quiet'}
      aria-label="结束训练" title="结束训练" aria-expanded={false}
      disabled={disabled || busy} onClick={() => { setError(null); setConfirming(true); }}>
      {resumeHref ? <Icon name="stop" size={20} /> : '结束训练'}
    </button>}
    {confirming && <div className="finish-inline" aria-label="结束本次训练">
      <p>{completedSets > 0 ? `已记录的 ${completedSets} 组会保留。` : '本次还没有记录训练组。'}</p>
      {error && !error.fromHold && <p className="form-err" role="alert">{error.message}</p>}
      <div>
        <button type="button" className="ghost-pill" autoFocus disabled={busy} onClick={() => {
          setConfirming(false);
          requestAnimationFrame(() => trigger.current?.focus());
        }}>取消</button>
        <button type="button" className="ink-pill" disabled={busy || disabled} onClick={() => void finish()}>
          {busy ? '正在结束…' : '确认结束训练'}
        </button>
      </div>
    </div>}
  </>;
}
