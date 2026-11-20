'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AddToPlanButton({
  exerciseId,
  variant = 'icon',
}: {
  exerciseId: string;
  variant?: 'icon' | 'full' | 'mini';
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');

  async function add(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (state === 'busy') return;
    setState('busy');
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exerciseId }),
      });
      if (!res.ok) throw new Error('failed');
      setState('done');
      router.refresh();
      setTimeout(() => setState('idle'), 1600);
    } catch {
      setState('err');
      setTimeout(() => setState('idle'), 1600);
    }
  }

  if (variant === 'full') {
    return (
      <button className={`btn primary full-add ${state}`} onClick={add}>
        {state === 'done' ? '✓ 已加入今日训练' : state === 'err' ? '加入失败，重试' : state === 'busy' ? '加入中…' : '+ 加入今日训练'}
      </button>
    );
  }

  if (variant === 'mini') {
    return (
      <button className={`mini-add ${state}`} onClick={add} aria-label="加入今日训练" title="加入今日训练">
        {state === 'done' ? '✓' : state === 'err' ? '!' : '+'}
      </button>
    );
  }

  return (
    <button className={`add-btn ${state}`} onClick={add} aria-label="加入今日训练" title="加入今日训练">
      {state === 'done' ? '✓' : state === 'err' ? '!' : '+'}
    </button>
  );
}
