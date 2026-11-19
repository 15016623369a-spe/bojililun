'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MealItemSource } from '@/lib/journal';

/** 饮食分量单元格：与训练每组编辑一致的内联输入＋保存；语音记录改 payload，拍照餐改克数并重算热量 */
export default function MealAmount({ name, amount, grams, src }: {
  name: string;
  amount: string;
  grams?: number;
  src?: MealItemSource;
}) {
  const router = useRouter();
  const numeric = grams !== undefined;
  const [value, setValue] = useState(numeric ? `${grams} g` : amount);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(numeric ? String(grams) : amount);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const flash = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(flash.current), []);
  // 服务端刷新后（如整合卡合并/撤销）同步最新值
  useEffect(() => {
    if (!editing) setValue(numeric ? `${grams} g` : amount);
  }, [amount, grams, numeric, editing]);

  const source = src;
  if (!source) return <>{value}</>;

  const open = () => {
    setDraft(numeric ? String(grams) : value);
    setError('');
    setEditing(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(source.kind === 'quick' ? '/api/journal' : '/api/meal', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(source.kind === 'quick'
          ? { quickId: source.quickId, index: source.index, amount: draft }
          : { id: source.mealId, index: source.index, grams: Number(draft) }),
      });
      const result = await response.json() as { ok?: boolean; amount?: string; grams?: number; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || '保存失败，请重试');
      setValue(source.kind === 'quick' ? result.amount! : `${result.grams} g`);
      setEditing(false);
      setSaved(true);
      clearTimeout(flash.current);
      flash.current = setTimeout(() => setSaved(false), 1800);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (editing) return (
    <form className="amount-edit" onSubmit={(event) => void save(event)}>
      <span className="set-input">
        <input
          aria-label={`修改${name}的分量${numeric ? '（g）' : ''}`}
          type={numeric ? 'number' : 'text'}
          min={numeric ? 1 : undefined}
          max={numeric ? 2000 : undefined}
          step={numeric ? 1 : undefined}
          inputMode={numeric ? 'numeric' : 'text'}
          maxLength={numeric ? undefined : 30}
          required
          autoFocus
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setError(''); }}
        />
        {numeric && <small>g</small>}
      </span>
      <button className="set-save" type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
      <button className="journal-quiet" type="button" disabled={saving}
        onClick={() => { setEditing(false); setError(''); }}>取消</button>
      {error && <small className="amount-error" role="alert">{error}</small>}
    </form>
  );

  return (
    <button type="button" className={`amount-cell${saved ? ' saved' : ''}`} title="点击修改分量"
      aria-label={`修改${name}的分量，当前${value}`} onClick={open}>
      {saved && <span aria-hidden="true">✓ </span>}{value}
      <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none">
        <path d="M11.3 2.3l2.4 2.4L5.4 13H3v-2.4l8.3-8.3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </button>
  );
}