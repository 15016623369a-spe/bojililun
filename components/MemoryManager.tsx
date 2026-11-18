'use client';

import { useState } from 'react';
import { MEMORY_KIND_LABEL, type Memory, type MemoryKind } from '@/lib/types';

const KINDS: MemoryKind[] = ['constraint', 'preference', 'fact', 'goal', 'equipment'];

export default function MemoryManager({ initial }: { initial: Memory[] }) {
  const [items, setItems] = useState<Memory[]>(initial);
  const [kind, setKind] = useState<MemoryKind>('constraint');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  async function remove(id: number) {
    setItems((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/memory?id=${id}`, { method: 'DELETE' });
  }

  async function add() {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          candidate: { kind, key: `${kind}:${text.slice(0, 24)}`, content: text, importance: kind === 'constraint' ? 5 : 3 },
        }),
      });
      const data = (await res.json()) as { memories?: Memory[] };
      if (data.memories) setItems(data.memories);
      setContent('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mem-manager">
      <div className="mem-add">
        <select value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {MEMORY_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input
          value={content}
          placeholder="例如：左肩有伤，避免过顶推举"
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void add();
          }}
        />
        <button className="btn" onClick={add} disabled={busy || !content.trim()}>
          添加
        </button>
      </div>

      {items.length === 0 ? (
        <p className="hint">还没有记忆。约束类记忆会永远参与训练计划与饮食建议。</p>
      ) : (
        <div className="mem-list">
          {items.map((m) => (
            <div className="mem-item" key={m.id}>
              <span className={`mem-kind ${m.kind}`}>{MEMORY_KIND_LABEL[m.kind]}</span>
              <div>
                <p>{m.content}</p>
                <small>
                  来源 {m.source} · 重要度 {m.importance}
                </small>
              </div>
              <button className="row-del" onClick={() => remove(m.id)} aria-label="删除">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
