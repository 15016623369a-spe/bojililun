'use client';

import { useId, useRef, useState } from 'react';
import HoldToEndTraining from './HoldToEndTraining';
import Icon from './ui/Icon';

export default function EndTrainingButton({ sessionId, completedSets, disabled, onEnded, resumeHref }: {
  sessionId: number;
  completedSets: number;
  disabled?: boolean;
  onEnded: () => void;
  resumeHref?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fromHold: boolean } | null>(null);

  async function finish(fromHold = false) {
    if (saving.current || disabled) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: sessionId }),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || '结束训练失败，请重试');
      }
      dialog.current?.close();
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
    <button type="button" className={resumeHref ? 'training-stop' : 'runner-quiet'}
      aria-label={resumeHref ? '结束训练' : undefined} title={resumeHref ? '结束训练' : undefined}
      aria-haspopup="dialog" disabled={disabled || busy}
      onClick={() => { setError(null); dialog.current?.showModal(); }}>
      {resumeHref ? <Icon name="stop" size={20} /> : '结束训练'}
    </button>
    <dialog ref={dialog} className="journal-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { if (saving.current) event.preventDefault(); }}>
      <div className="dialog-head"><h2 id={titleId}>结束本次训练？</h2></div>
      <p id={descriptionId} className="journal-muted">
        {completedSets > 0 ? `已记录的 ${completedSets} 组会保留，未保存的组会丢弃。` : '本次还没有记录任何组。'}
      </p>
      {error && !error.fromHold && <p className="form-err" role="alert">{error.message}</p>}
      <div className="queue-confirm-actions">
        <button type="button" className="journal-quiet" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>继续训练</button>
        <button type="button" className="journal-primary" disabled={busy} onClick={() => void finish()}>
          {busy ? '正在结束…' : '确认结束'}
        </button>
      </div>
    </dialog>
  </>;
}
