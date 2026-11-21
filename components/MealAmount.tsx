'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { JournalEntry, MealItemSource } from '@/lib/journal';

/** 饮食分量单元格：与训练每组编辑一致的内联输入＋保存；语音记录改 payload，拍照餐改克数并重算热量 */
export default function MealAmount({ name, amount, grams, src, estimatedGrams, onQuickSave }: {
  name: string;
  amount: string;
  grams?: number;
  src?: MealItemSource;
  estimatedGrams?: number;
  onQuickSave?: (entry: JournalEntry) => void;
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
  // 服务端刷新后（如整合卡合并/撤销）同步最新值。只跟 props 变化走：
  // 若把 editing 放进依赖，保存时 setEditing(false) 会先用上一帧的旧 props 覆盖刚刚写入的新值，
  // 于是 ✓ 会短暂闪在旧数字上，慢网络下会一直停在旧值直到刷新落地。
  useEffect(() => {
    setValue(numeric ? `${grams} g` : amount);
  }, [amount, grams, numeric]);

  const source = src;
  if (!source) return <>{value}</>;

  const open = () => {
    setDraft(numeric ? String(grams) : value === '未填写' ? '' : value);
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
      const result = await response.json() as { ok?: boolean; amount?: string; grams?: number; error?: string; entry?: JournalEntry };
      if (!response.ok || !result.ok) throw new Error(result.error || '保存失败，请重试');
      setValue(source.kind === 'quick' ? result.amount! : `${result.grams} g`);
      setEditing(false);
      setSaved(true);
      clearTimeout(flash.current);
      flash.current = setTimeout(() => setSaved(false), 1800);
      if (result.entry) onQuickSave?.(result.entry);
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
          placeholder={numeric ? undefined : '如 100 克'}
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
    <>
      <button type="button" className={`amount-cell${saved ? ' saved' : ''}`} title="点击修改分量"
        aria-label={`修改${name}的分量，当前${value}`} onClick={open}>
        {saved && <span aria-hidden="true">✓ </span>}{value}{estimatedGrams !== undefined && `（约 ${Math.round(estimatedGrams)} g）`}
      </button>
      <span className="amount-status" aria-live="polite">{saved ? '已保存' : ''}</span>
    </>
  );
}
