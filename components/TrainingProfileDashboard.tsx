'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { getTrainingProfile } from '@/lib/core/training-profile';
import { TRAINING_GOALS } from '@/lib/training-goals';
import type { Memory } from '@/lib/types';
import Onboarding, { type OnboardingInitial } from './Onboarding';
import TrainingProfileForm, { MODEL_IMAGES } from './TrainingProfileForm';
import Icon from './ui/Icon';
import TickRuler from './ui/TickRuler';

type Nutrition = OnboardingInitial & { target_kcal: number; target_protein: number };
type Row = 'identity' | 'goal' | 'restriction' | null;

const short = (date: string) => `${date.slice(5, 7)}.${date.slice(8)}`;

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 更新体重：大号读数 + 刻度尺，日期默认今天 */
function WeightEditor({ initial, today, onClose }: { initial: number; today: string; onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [int, dec] = value.toFixed(1).split('.');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/training-profile', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weight: value, date }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败，请重试');
      try { navigator.vibrate?.(12); } catch { /* 无振动 */ }
      onClose();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return <form className="weight-editor" onSubmit={save}>
    <div className="weight-editor-num" aria-live="polite"><b className="big-num">{int}<span className="dim">.{dec}</span></b><em>kg</em></div>
    <TickRuler value={value} min={30} max={180} step={0.1} major={10} label="体重刻度尺" unit="kg" onChange={setValue} />
    <label className="weight-editor-date">记录日期<input type="date" value={date} max={today} required onChange={(event) => setDate(event.target.value)} /></label>
    {error && <p className="form-err" role="alert">{error}</p>}
    <div className="me-actions">
      <button type="button" className="chip" onClick={onClose} disabled={saving}>取消</button>
      <button type="submit" className="ink-pill" disabled={saving}>{saving ? '保存中…' : '记下体重'}<Icon name="check" size={18} stroke={2.2} /></button>
    </div>
  </form>;
}

export default function TrainingProfileDashboard({ profile, restrictions, nutrition, today, preferences }: {
  profile: ReturnType<typeof getTrainingProfile>;
  restrictions: Memory[];
  nutrition: Nutrition | null;
  today: string;
  preferences: { liked: number; disliked: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Row>(null);
  const [weighing, setWeighing] = useState(false);
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const [updating, setUpdating] = useState<number>();
  const [restrictionError, setRestrictionError] = useState('');
  const latest = profile.weights[0];
  const model = profile.sex ?? 'male';
  const active = restrictions.filter((item) => item.status === 'active');
  const archived = restrictions.filter((item) => item.status !== 'active');
  // 30 天变化：取 30 天前（含）最近的一条作为基准
  const base = latest ? profile.weights.find((entry) => daysBetween(entry.date, latest.date) >= 30) ?? profile.weights.at(-1) : undefined;
  const change = latest && base && base !== latest ? latest.weight - base.weight : null;
  const span = latest && base ? Math.max(1, daysBetween(base.date, latest.date)) : 0;
  const trend = [...profile.weights].slice(0, 16).reverse();
  const lo = Math.min(...trend.map((e) => e.weight)), hi = Math.max(...trend.map((e) => e.weight));
  const [int, dec] = (latest?.weight ?? 0).toFixed(1).split('.');

  function toggle(row: Row) {
    try { navigator.vibrate?.(4); } catch { /* 无振动 */ }
    setOpen(open === row ? null : row);
  }

  async function archive(id: number) {
    if (updating !== undefined) return;
    setUpdating(id);
    setRestrictionError('');
    try {
      const response = await fetch(`/api/memory?id=${id}&soft=1`, { method: 'DELETE' });
      if (!response.ok) throw new Error('保存失败，请重试');
      router.refresh();
    } catch {
      setRestrictionError('保存失败，请重试');
    } finally {
      setUpdating(undefined);
    }
  }

  const rows: { key: Exclude<Row, null> | 'prefs' | 'nutrition'; label: string; value: string }[] = [
    { key: 'goal', label: '训练目标', value: profile.goal ? TRAINING_GOALS[profile.goal] : '尚未设置' },
    { key: 'restriction', label: '伤病与限制', value: active.length ? (active.length === 1 ? active[0].content : `${active.length} 项`) : '暂无' },
    { key: 'prefs', label: '动作偏好', value: `常练 ${preferences.liked} · 不喜欢 ${preferences.disliked}` },
    { key: 'nutrition', label: '营养目标', value: nutrition ? `${nutrition.target_kcal.toLocaleString('en-US')} kcal · 蛋白 ${nutrition.target_protein} g` : '按需设置' },
  ];

  return <div className="me">
    <section className="me-identity">
      <span className="me-avatar" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MODEL_IMAGES[model]} alt="" />
      </span>
      <div className="me-identity-main">
        <h2>{profile.name}</h2>
        <p>{profile.sex ? `${profile.sex === 'female' ? '女' : '男'} · 默认${profile.sex === 'female' ? '女性' : '男性'}模型` : '性别未填 · 默认男性模型'}</p>
        <div className="me-tags">
          {profile.goal && <span className="tag ink">{TRAINING_GOALS[profile.goal]}</span>}
          {active.length > 0 && <span className="tag">{active.length} 项限制</span>}
          {preferences.liked > 0 && <span className="tag">常练 {preferences.liked}</span>}
        </div>
      </div>
      <button type="button" className="chip" aria-expanded={open === 'identity'} onClick={() => toggle('identity')}>编辑</button>
    </section>
    <div className="me-expand" data-open={open === 'identity' || undefined}><div>
      {open === 'identity' && <TrainingProfileForm mode="identity" today={today} initial={profile} onClose={() => setOpen(null)} />}
    </div></div>

    <section className="me-weight">
      <div className="me-weight-head"><span>体重</span><span>{latest ? `${short(latest.date)} 更新` : '还没有记录'}</span></div>
      {!weighing ? <>
        <div className="me-weight-row">
          {latest ? <div className="me-weight-num"><b className="big-num">{int}<span className="dim">.{dec}</span></b><em>kg</em></div>
            : <div className="me-weight-num empty"><b className="big-num">--.-</b><em>kg</em></div>}
          {change !== null && <span className="me-weight-change">{span} 天 {change > 0 ? '+' : change < 0 ? '−' : '±'}{Math.abs(change).toFixed(1)}</span>}
        </div>
        {trend.length > 1 && <div className="me-weight-dots" role="img" aria-label={`最近 ${trend.length} 次体重，从 ${trend[0].weight} 到 ${trend.at(-1)!.weight} kg`}>
          {trend.map((entry, i) => {
            const n = Math.max(1, Math.round(1 + (entry.weight - lo) / Math.max(.5, hi - lo) * 7));
            return <span key={entry.date} title={`${entry.date} ${entry.weight} kg`}>
              {Array.from({ length: n }, (_, k) => <i key={k} data-last={i === trend.length - 1 || undefined} />)}
            </span>;
          })}
        </div>}
        <button type="button" className="me-weight-btn" onClick={() => setWeighing(true)}>
          <Icon name="plus" size={16} stroke={2.2} />{latest ? '更新体重' : '记录体重'}
        </button>
      </> : <WeightEditor initial={latest?.weight ?? 70} today={today} onClose={() => setWeighing(false)} />}
    </section>

    <ul className="me-rows">
      {rows.map((row) => {
        const expandable = row.key === 'goal' || row.key === 'restriction';
        const inner = <>
          <span className="me-row-label">{row.label}</span>
          <span className="me-row-value">{row.value}</span>
          <Icon name={expandable && open === row.key ? 'chevron-down' : 'chevron-right'} size={18} className="row-chev" />
        </>;
        return <li key={row.key}>
          {row.key === 'prefs' ? <Link className="me-row" href="/me/exercises">{inner}</Link>
            : row.key === 'nutrition' ? <button type="button" className="me-row" onClick={() => setNutritionOpen(true)}>{inner}</button>
              : <button type="button" className="me-row" aria-expanded={open === row.key} onClick={() => toggle(row.key as Row)}>{inner}</button>}
          {expandable && <div className="me-expand" data-open={open === row.key || undefined}><div>
            {open === 'goal' && row.key === 'goal' && <TrainingProfileForm mode="goal" today={today} initial={profile} onClose={() => setOpen(null)} />}
            {open === 'restriction' && row.key === 'restriction' && <>
              {active.length > 0 && <ul className="me-restrictions">
                {active.map(({ id, content }) => <li key={id}><span>{content}</span>
                  <button type="button" className="chip" disabled={updating !== undefined} onClick={() => void archive(id)}>结束限制</button>
                </li>)}
              </ul>}
              {restrictionError && <p className="form-err" role="alert">{restrictionError}</p>}
              <TrainingProfileForm mode="restriction" today={today} initial={profile} onClose={() => setOpen(null)} />
              {archived.length > 0 && <details className="me-archived"><summary>过往限制 {archived.length} 项</summary>
                <ul>{archived.map(({ id, content }) => <li key={id}>{content}</li>)}</ul></details>}
            </>}
          </div></div>}
        </li>;
      })}
    </ul>

    {nutritionOpen && <Onboarding purpose="nutrition" initial={{
      ...nutrition, name: profile.name, sex: nutrition?.sex ?? profile.sex ?? undefined,
      weight_kg: nutrition?.weight_kg ?? latest?.weight,
    }} onCancel={() => setNutritionOpen(false)} onDone={() => { setNutritionOpen(false); router.refresh(); }} />}
  </div>;
}
