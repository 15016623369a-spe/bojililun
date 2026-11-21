'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { getTrainingProfile } from '@/lib/core/training-profile';
import { TRAINING_GOALS } from '@/lib/training-goals';
import type { Memory } from '@/lib/types';
import { humanDate } from '@/lib/date';
import Onboarding, { type OnboardingInitial } from './Onboarding';
import JournalIcon from './JournalIcon';
import TrainingProfileForm, { MODEL_IMAGES, type ProfileFormMode } from './TrainingProfileForm';

type Nutrition = OnboardingInitial & { target_kcal: number; target_protein: number };
type Editor = Exclude<ProfileFormMode, 'setup'>;

export default function TrainingProfileDashboard({ profile, restrictions, nutrition, today }: {
  profile: ReturnType<typeof getTrainingProfile>;
  restrictions: Memory[];
  nutrition: Nutrition | null;
  today: string;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<Editor>();
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const [updating, setUpdating] = useState<number>();
  const [restrictionError, setRestrictionError] = useState('');
  const weight = profile.weights[0];
  const model = profile.sex ?? 'male';
  const active = restrictions.filter((item) => item.status === 'active');
  const archived = restrictions.filter((item) => item.status !== 'active');
  const chronological = [...profile.weights].reverse();
  const low = weight ? Math.min(...profile.weights.map((entry) => entry.weight)) : 0;
  const range = weight ? Math.max(1, Math.max(...profile.weights.map((entry) => entry.weight)) - low) : 1;

  function edit(mode: Editor, label: string) {
    return <button type="button" className="training-profile-edit" aria-expanded={editor === mode}
      onClick={() => setEditor(editor === mode ? undefined : mode)}>{label}</button>;
  }

  function form(mode: Editor) {
    return editor === mode && <TrainingProfileForm key={mode} mode={mode} today={today} initial={profile} onClose={() => setEditor(undefined)} />;
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

  return <div className="training-profile-dashboard">
    <section className="training-profile-card training-profile-identity">
      <div className="training-profile-header">
        <div className="training-profile-person">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MODEL_IMAGES[model]} alt="" />
          <div><h2>{profile.name}</h2><p className="training-profile-hint">
            {profile.sex ? `${profile.sex === 'female' ? '女' : '男'} · 默认使用${profile.sex === 'female' ? '女性' : '男性'}模型` : '性别未填写 · 默认使用男性模型'}
          </p></div>
        </div>
        {edit('identity', '编辑资料')}
      </div>
      {form('identity')}
    </section>
    <section className="training-profile-card">
      <div className="training-profile-header"><h2>训练目标</h2>{edit('goal', '修改')}</div>
      <strong className="training-profile-metric">{profile.goal ? TRAINING_GOALS[profile.goal] : '尚未设置'}</strong>
      {form('goal')}
    </section>
    <section className="training-profile-card">
      <div className="training-profile-header"><h2>体重记录</h2>{edit('weight', weight ? '更新体重' : '记录体重')}</div>
      {weight ? <>
        <strong className="training-profile-metric">{weight.weight.toFixed(1)} <small>kg</small></strong>
        <p className="training-profile-hint">{humanDate(weight.date)}{profile.weights.length === 1 ? ' · 首条记录' : ' · 最近记录'}</p>
        <details className="training-profile-details">
          <summary>查看体重趋势</summary>
          {chronological.length > 1 && <svg className="training-weight-plot" viewBox="0 0 300 85" role="img" aria-label="按日期排列的体重趋势">
            <polyline fill="none" stroke="currentColor" strokeWidth="2"
              points={chronological.map(({ weight }, i) => `${8 + i * 284 / (chronological.length - 1)},${75 - (weight - low) / range * 65}`).join(' ')} />
          </svg>}
          <ul className="training-profile-history">
            {profile.weights.map(({ date, weight }) => <li key={date}><span>{date}</span><strong>{weight.toFixed(1)} kg</strong></li>)}
          </ul>
        </details>
      </> : <p className="training-profile-hint">还没有体重记录</p>}
      {form('weight')}
    </section>
    <section className="training-profile-card">
      <div className="training-profile-header"><h2>伤病与限制</h2>{edit('restriction', '添加限制')}</div>
      {active.length ? <ul className="training-profile-history">
        {active.map(({ id, content }) => <li key={id}><span>{content}</span>
          <button type="button" className="training-profile-edit" disabled={updating !== undefined} onClick={() => void archive(id)}>结束限制</button>
        </li>)}
      </ul> : <p className="training-profile-hint">还未添加当前训练限制</p>}
      {restrictionError && <p className="journal-error" role="alert">{restrictionError}</p>}
      {form('restriction')}
      {archived.length > 0 && <details className="training-profile-details">
        <summary>查看过往限制</summary>
        <ul className="training-profile-history">{archived.map(({ id, content }) => <li key={id}>{content}</li>)}</ul>
      </details>}
    </section>
    <Link className="training-profile-card training-profile-link" href="/me/exercises">
      <JournalIcon name="training" /><strong>动作偏好</strong><span>我的动作库</span><b aria-hidden="true">›</b>
    </Link>
    <button type="button" className="training-profile-card training-profile-link" onClick={() => setNutritionOpen(true)}>
      <JournalIcon name="meal" /><strong>每日营养目标</strong>
      <span>{nutrition ? `${nutrition.target_kcal.toLocaleString('zh-CN')} kcal · ${nutrition.target_protein} g` : '按需设置'}</span><b aria-hidden="true">›</b>
    </button>
    {nutritionOpen && <Onboarding purpose="nutrition" initial={{
      ...nutrition, name: profile.name, sex: nutrition?.sex ?? profile.sex ?? undefined,
      weight_kg: nutrition?.weight_kg ?? weight?.weight,
    }} onCancel={() => setNutritionOpen(false)} onDone={() => { setNutritionOpen(false); router.refresh(); }} />}
  </div>;
}
