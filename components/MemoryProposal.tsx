'use client';

import { useState } from 'react';
import { MEMORY_KIND_LABEL, type CandidateMemory } from '@/lib/types';

export default function MemoryProposal({
  candidates,
  status,
  onSave,
  onDismiss,
}: {
  candidates: CandidateMemory[];
  status: 'open' | 'saved' | 'dismissed';
  onSave: (candidates: CandidateMemory[]) => Promise<void>;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="card">
      <div className="card-head">
        <b>🧠 要不要记住这些？</b>
        <span>{status === 'open' ? '记忆' : status === 'saved' ? '已记住' : '已忽略'}</span>
      </div>

      {candidates.map((c) => (
        <div className="mem-row" key={c.key}>
          <span className={`mem-kind ${c.kind}`}>{MEMORY_KIND_LABEL[c.kind]}</span>
          <div className="mem-text">{c.content}</div>
        </div>
      ))}

      {status === 'open' ? (
        <div className="factions">
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(candidates);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '保存中…' : '记住'}
          </button>
          <button className="btn" onClick={onDismiss}>
            忽略
          </button>
        </div>
      ) : (
        <p className="note" style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--muted)' }}>
          {status === 'saved' ? '以后算计划和热量时都会带上这些。' : '没有保存，之后也不会再问。'}
        </p>
      )}
    </div>
  );
}
