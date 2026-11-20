'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TRAINING_GOALS, type TrainingGoal } from '@/lib/training-goals';

export type ProfileFormMode = 'setup' | 'identity' | 'goal' | 'weight' | 'restriction';

export const MODEL_IMAGES = {
  male: '/models/sculpture/stats-front.png',
  female: '/models/sculpture/female/stats-front.png',
} as const;

export default function TrainingProfileForm({ mode, today, initial, onClose }: {
  mode: ProfileFormMode;
  today: string;
  initial?: { name: string; sex: 'male' | 'female' | null; goal: TrainingGoal | null };
  onClose?: () => void;
}) {
  const router = useRouter();
  const setup = mode === 'setup';
  const [name, setName] = useState(initial?.name ?? '我');
  const [sex, setSex] = useState(initial?.sex ?? null);
  const [goal, setGoal] = useState(initial?.goal ?? null);
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState(today);
  const [showRestriction, setShowRestriction] = useState(false);
  const [restriction, setRestriction] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const fields = mode === 'identity' ? { name, sex }
        : mode === 'goal' ? { goal }
        : mode === 'weight' ? { weight: Number(weight), date }
        : mode === 'restriction' ? { restriction }
        : { setup: true, sex, goal, ...(weight ? { weight: Number(weight) } : {}), ...(showRestriction && restriction.trim() ? { restriction } : {}) };
      const response = await fetch('/api/training-profile', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败，请重试');
      if (setup) router.replace('/');
      onClose?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  return <form className={setup ? 'training-profile-setup' : 'training-profile-form'} onSubmit={save}>
    {(setup || mode === 'identity') && <fieldset className={setup ? 'training-profile-card' : undefined}>
      <legend>性别 <small>可暂不填写</small></legend>
      {mode === 'identity' && <label className="training-profile-input">昵称<input value={name} maxLength={20} onChange={(event) => setName(event.target.value)} /></label>}
      <div className="training-profile-models">
        {(['male', 'female'] as const).map((variant) => <button type="button" key={variant} aria-pressed={sex === variant} onClick={() => setSex(sex === variant ? null : variant)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MODEL_IMAGES[variant]} alt="" />{variant === 'male' ? '男' : '女'}
        </button>)}
      </div>
      <p className="training-profile-hint">用于选择计划页的默认人体模型。</p>
    </fieldset>}
    {(setup || mode === 'goal') && <fieldset className={setup ? 'training-profile-card' : undefined}>
      <legend>主要训练目标 <small>选一项</small></legend>
      <div className="training-profile-options">
        {(Object.keys(TRAINING_GOALS) as TrainingGoal[]).map((key) =>
          <button type="button" key={key} aria-pressed={goal === key} onClick={() => setGoal(key)}>{TRAINING_GOALS[key]}</button>)}
      </div>
    </fieldset>}
    {(setup || mode === 'weight') && <fieldset className={setup ? 'training-profile-card' : undefined}>
      <legend>{setup ? '当前体重' : '更新体重'} {setup && <small>选填</small>}</legend>
      <label className="training-profile-input">体重（kg）
        <input type="number" inputMode="decimal" min="20" max="400" step=".1" value={weight} required={!setup}
          placeholder="例如 70.0" onChange={(event) => setWeight(event.target.value)} />
      </label>
      {setup ? <p className="training-profile-hint">填写后保存为第一条体重记录。</p>
        : <label className="training-profile-input">记录日期<input type="date" value={date} max={today} required onChange={(event) => setDate(event.target.value)} /></label>}
    </fieldset>}
    {(setup || mode === 'restriction') && <fieldset className={setup ? 'training-profile-card' : undefined}>
      <legend>{setup ? '目前有没有需要避开的动作？' : '添加训练限制'} {setup && <small>选填</small>}</legend>
      {setup && <div className="training-profile-options restriction-options">
        <button type="button" aria-pressed={!showRestriction} onClick={() => setShowRestriction(false)}>暂无</button>
        <button type="button" aria-pressed={showRestriction} onClick={() => setShowRestriction(true)}>有，添加限制</button>
      </div>}
      {(!setup || showRestriction) && <label className="training-profile-input">训练限制
        <textarea maxLength={200} value={restriction} required placeholder="例如：左肩有旧伤，避免过顶推举" onChange={(event) => setRestriction(event.target.value)} />
      </label>}
    </fieldset>}
    {error && <p className="journal-error" role="alert">{error}</p>}
    <div className="training-profile-actions">
      {onClose && <button type="button" className="journal-quiet" onClick={onClose} disabled={saving}>取消</button>}
      <button type="submit" className="journal-primary" disabled={saving || ((setup || mode === 'goal') && !goal)}>
        {saving ? '保存中…' : setup ? '保存并进入' : '保存'}
      </button>
    </div>
  </form>;
}
