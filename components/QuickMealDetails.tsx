'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { JOURNAL_MEAL_LABELS, MEAL_PHOTO_MAX_BYTES, MEAL_PHOTO_TYPES, type JournalEntry, type JournalMealItem } from '@/lib/journal';

function readPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取照片失败，请重新选择'));
    reader.readAsDataURL(file);
  });
}

export default function QuickMealDetails({ item, mealType, onSave, onClose }: {
  item: JournalMealItem;
  mealType?: string;
  onSave?: (entry: JournalEntry) => void;
  onClose?: () => void;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [photo, setPhoto] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const src = item.src;
  const close = onClose ?? (() => dialog.current?.close());

  useEffect(() => {
    if (!photo) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function open() {
    setPhoto(undefined);
    setRemovePhoto(false);
    setError('');
    dialog.current?.querySelector('form')?.reset();
    dialog.current?.showModal();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || src?.kind !== 'quick') return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    const amount = String(form.get('amount')).trim() || '未填写';
    const kcal = String(form.get('kcal')).trim();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/journal', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quickId: src.quickId,
          index: src.index,
          name,
          amount,
          meal: form.get('meal'),
          preparation: form.get('preparation'),
          manualKcal: kcal ? Number(kcal) : null,
          photoData: photo ? await readPhoto(photo) : undefined,
          removePhoto,
        }),
      });
      const result = await response.json() as { entry?: JournalEntry; error?: string };
      if (!response.ok || !result.entry) throw new Error(result.error || '保存失败，请重试');
      onSave?.(result.entry);
      close();
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const photoUrl = preview ?? (!removePhoto ? item.photoUrl : undefined);
  const originalMeal = item.meal ?? mealType;
  const meal = JOURNAL_MEAL_LABELS.find((label) => label === originalMeal) ?? '饮食';
  const form = <form className="meal-details" onSubmit={(event) => void save(event)}>
        <fieldset disabled={saving}>
          <label>食物名称<input name="name" defaultValue={item.name} maxLength={100} required autoFocus /></label>
          <div className="meal-details-pair">
            <label>分量<input name="amount" defaultValue={item.amount === '未填写' ? '' : item.amount}
              maxLength={30} placeholder="例如 150 克" /></label>
            <label>餐次<select name="meal" defaultValue={meal}>
              {JOURNAL_MEAL_LABELS.map((label) => <option key={label}>{label}</option>)}
            </select></label>
          </div>
          <label>做法或备注<input name="preparation" defaultValue={item.preparation} maxLength={120}
            placeholder="例如 清汤、少油、外卖" /></label>
          <label>热量（kcal）
            <input name="kcal" type="number" min={0} step={1} defaultValue={item.manualKcal}
              placeholder={item.nutrition ? `估算 ${item.nutrition.kcal}` : '选填'} />
            <small>留空时按食物和分量估算</small>
          </label>
          <div className="meal-details-photo">
            {photoUrl && <img src={photoUrl} alt={`${item.name}的照片`} />}
            <label>{photoUrl ? '更换照片' : '上传照片'}
              <input ref={fileInput} type="file" accept={MEAL_PHOTO_TYPES.join(',')} onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                const valid = MEAL_PHOTO_TYPES.includes(file.type) && file.size > 0 && file.size <= MEAL_PHOTO_MAX_BYTES;
                if (!valid) {
                  event.currentTarget.value = '';
                  setError('请选择 8 MB 以内的 JPG、PNG 或 WebP 图片');
                  return;
                }
                setError('');
                setPhoto(file);
                setRemovePhoto(false);
              }} />
            </label>
            {photoUrl && <button className="journal-quiet" type="button" onClick={() => {
              setPhoto(undefined);
              setRemovePhoto(true);
              setError('');
              if (fileInput.current) fileInput.current.value = '';
            }}>移除照片</button>}
          </div>
        </fieldset>
        {error && <p className="amount-error" role="alert">{error}</p>}
        <div className="queue-confirm-actions">
          <button className="journal-quiet" type="button" disabled={saving} onClick={close}>取消</button>
          <button className="journal-primary" type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        </div>
  </form>;
  if (onClose) return form;

  return <>
    <button className="entry-food-button" type="button" aria-haspopup="dialog"
      aria-label={`打开${item.name}的详情`} onClick={open}>{item.name}</button>
    {item.preparation && <small className="meal-item-note">{item.preparation}</small>}
    {item.photoUrl && <small className="meal-item-note">有照片</small>}
    <dialog className="journal-dialog meal-details" ref={dialog} aria-labelledby={titleId}
      onCancel={(event) => { if (saving) event.preventDefault(); }}>
      <div className="dialog-head"><h2 id={titleId}>食物详情</h2></div>
      {form}
    </dialog>
  </>;
}
