'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { TRAINING_GOALS, type TrainingGoal } from '@/lib/training-goals';
import { ACTIVITY, type ActivityKey, type GoalKey } from '@/lib/nutrition';
import { imageUrl } from '@/lib/exercise-label';
import { MODEL_IMAGES } from './TrainingProfileForm';
import JournalIcon from './JournalIcon';
import Icon from './ui/Icon';
import TickRuler from './ui/TickRuler';
import Stepper from './ui/Stepper';

const GOAL_NOTE: Record<TrainingGoal, string> = {
  muscle: '多吃一点，重量慢慢往上加',
  strength: '冲击主项的极限重量',
  weight: '保留力量，控制热量缺口',
  habit: '每周稳定练几次就好',
  record: '先把训练和饮食记下来',
};
const PARTS = [
  { key: 'chest', label: '胸', values: ['chest'] },
  { key: 'back', label: '背', values: ['back'] },
  { key: 'shoulders', label: '肩', values: ['shoulders'] },
  { key: 'legs', label: '腿', values: ['upper legs', 'lower legs'] },
  { key: 'arms', label: '手臂', values: ['upper arms'] },
  { key: 'waist', label: '腹', values: ['waist'] },
];
const STEPS = ['model', 'goal', 'weight', 'body', 'activity', 'restriction', 'favorites'] as const;
/** 训练目标 → 营养目标（「我的」里的营养设置用同一套） */
const NUTRITION_GOAL: Record<TrainingGoal, GoalKey> = { muscle: 'bulk', weight: 'cut', strength: 'maintain', habit: 'maintain', record: 'maintain' };
type Step = typeof STEPS[number];
type Item = { id: string; name: string; zh_name: string; image: string; equipment: string };

const haptic = (ms = 5) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };

/**
 * 新用户建档：一屏一问。目标必选，其余可跳过；最后一步可以先挑几个常练动作放进「我的动作库」。
 * 性别、体重、身高、年龄都填了，就顺手建好「我的」里的营养资料，热量目标和代谢不用再去补；活动量没选按「轻度」。
 */
export default function SetupFlow() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [sex, setSex] = useState<'male' | 'female' | null>(null);
  const [goal, setGoal] = useState<TrainingGoal | null>(null);
  const [weight, setWeight] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [age, setAge] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityKey | null>(null);
  const [hasRestriction, setHasRestriction] = useState(false);
  const [restriction, setRestriction] = useState('');
  const [part, setPart] = useState('chest');
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const step: Step = STEPS[index];
  const last = index === STEPS.length - 1;

  useEffect(() => {
    if (step !== 'favorites' || items[part]) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: '8', order: 'plan' });
    for (const value of PARTS.find((p) => p.key === part)?.values ?? []) query.append('part', value);
    fetch(`/api/exercises?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { items?: Item[] }) => setItems((current) => ({ ...current, [part]: data.items ?? [] })))
      .catch(() => { /* 列表只是推荐，失败时显示空 */ });
    return () => controller.abort();
  }, [step, part, items]);

  function move(delta: number) {
    haptic(6);
    setError('');
    setDir(delta);
    setIndex((i) => Math.min(STEPS.length - 1, Math.max(0, i + delta)));
  }

  function skip() {
    if (step === 'model') setSex(null);
    if (step === 'weight') setWeight(null);
    if (step === 'body') { setHeight(null); setAge(null); }
    if (step === 'activity') setActivity(null);
    if (step === 'restriction') { setHasRestriction(false); setRestriction(''); }
    if (step === 'favorites') { void finish(new Set()); return; }
    move(1);
  }

  async function finish(favorites = liked) {
    if (saving || !goal) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/training-profile', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          setup: true, sex, goal,
          ...(weight ? { weight } : {}),
          ...(hasRestriction && restriction.trim() ? { restriction: restriction.trim() } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败，请重试');
      if (sex && weight && height && age) {
        const nutrition = await fetch('/api/profile', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sex, weight_kg: weight, height_cm: height, age, activity: activity ?? 'light', goal: NUTRITION_GOAL[goal] }),
        });
        if (!nutrition.ok) throw new Error('营养资料没保存上，请重试');
      }
      await Promise.all([...favorites].map((exerciseId) => fetch('/api/exercise-preferences', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exerciseId, preference: 'liked' }),
      })));
      haptic(16);
      router.replace('/log');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  // 身高和年龄要么都填、要么都不填：只填一个时，另一个的默认值不能当成填过
  const missing = step === 'body' && (height === null) !== (age === null) ? (height === null ? '身高' : '年龄') : null;
  const canNext = (step !== 'goal' || goal !== null) && !missing;
  // 体重、身高年龄、活动量没动过就是跳过：按钮写「暂不填写」，不让默认值看起来像已经填好
  const unset = (step === 'weight' && weight === null) || (step === 'body' && height === null && age === null) || (step === 'activity' && activity === null);
  const title: Record<Step, React.ReactNode> = {
    model: <>选一个默认的<br />人体模型</>,
    goal: <>这一阶段，<br />你的主要目标是？</>,
    weight: <>目前的体重<br />是多少？</>,
    body: <>填一下你的<br />身高和年龄</>,
    activity: <>日常活动量<br />在哪一档？</>,
    restriction: <>有没有需要<br />避开的动作？</>,
    favorites: <>挑几个<br />你常练的动作</>,
  };
  const note: Record<Step, string> = {
    model: '用于「训练」和「回顾」页的肌群展示，之后随时可以在「我的」里换。',
    goal: '用来决定推荐组次和每日营养目标，随时可以在「我的」里改。',
    weight: '记作你的第一次体重，方便后面看趋势变化。',
    body: sex && weight
      ? '用来计算你的基础代谢和每日热量目标。'
      : '配合性别和体重，用来计算你的基础代谢和每日热量目标。',
    activity: '每日总代谢 = 基础代谢 × 活动系数，日常训练已经算在里面了。没选默认按「轻度」。',
    restriction: '比如旧伤或医生建议避开的动作，排计划时会优先避开。',
    favorites: '选中的动作会收进「我的动作库」，挑动作时排在前面。',
  };

  return <div className="setup">
    <header className="setup-head">
      <div className="journal-brand"><JournalIcon name="brand" />FitCheck</div>
      {step !== 'goal' && <button type="button" className="setup-skip" onClick={skip} disabled={saving}>先跳过</button>}
    </header>
    <div className="setup-progress" aria-hidden="true">{STEPS.map((s, i) => <i key={s} data-state={i < index ? 'done' : i === index ? 'now' : undefined} />)}</div>
    <div className="setup-count">
      {index > 0 && <button type="button" className="setup-back" onClick={() => move(-1)} aria-label="上一步"><Icon name="chevron-left" size={18} stroke={2} /></button>}
      <span className="big-num">{String(index + 1).padStart(2, '0')}<span className="dim"> / {String(STEPS.length).padStart(2, '0')}</span></span>
    </div>

    <main key={step} className="setup-step" style={{ '--dir': dir } as CSSProperties}>
      <h1>{title[step]}</h1>

      {step === 'model' && <div className="setup-models">
        {(['male', 'female'] as const).map((variant) => <button key={variant} type="button" aria-pressed={sex === variant}
          onClick={() => { haptic(); setSex(sex === variant ? null : variant); }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MODEL_IMAGES[variant]} alt="" />
          <span>{variant === 'male' ? '男' : '女'}{sex === variant && <Icon name="check" size={16} stroke={2.6} />}</span>
        </button>)}
      </div>}

      {step === 'goal' && <div className="setup-options">
        {(Object.keys(TRAINING_GOALS) as TrainingGoal[]).map((key) => <button key={key} type="button" aria-pressed={goal === key}
          onClick={() => { haptic(); setGoal(key); }}>
          <span><b>{TRAINING_GOALS[key]}</b><small>{GOAL_NOTE[key]}</small></span>
          <i className="setup-radio" aria-hidden="true">{goal === key && <Icon name="check" size={14} stroke={2.8} />}</i>
        </button>)}
      </div>}

      {step === 'weight' && <div className="setup-weight" data-unset={weight === null || undefined}>
        <Stepper readout label="体重" value={weight ?? 70} unit="kg" step={0.1} min={20} max={400} onChange={setWeight} />
        <TickRuler value={weight ?? 70} min={20} max={400} step={0.1} major={10} label="体重刻度尺" unit="kg" onChange={setWeight} />
      </div>}

      {step === 'body' && <div className="setup-body">
        <div data-unset={height === null || undefined}>
          <Stepper label="身高" value={height ?? (sex === 'female' ? 160 : 172)} unit="cm" step={1} min={120} max={230} onChange={setHeight} />
        </div>
        <div data-unset={age === null || undefined}>
          <Stepper label="年龄" value={age ?? 30} unit="岁" step={1} min={12} max={90} onChange={setAge} />
        </div>
      </div>}

      {step === 'activity' && <div className="setup-options">
        {(Object.keys(ACTIVITY) as ActivityKey[]).map((key) => <button key={key} type="button" aria-pressed={activity === key}
          onClick={() => { haptic(); setActivity(activity === key ? null : key); }}>
          <span><b>{ACTIVITY[key].label}</b><small>{ACTIVITY[key].desc}</small></span>
          <i className="setup-radio" aria-hidden="true">{activity === key && <Icon name="check" size={14} stroke={2.8} />}</i>
        </button>)}
      </div>}

      {step === 'restriction' && <div className="setup-options">
        <button type="button" aria-pressed={!hasRestriction} onClick={() => { haptic(); setHasRestriction(false); }}>
          <span><b>暂无</b><small>没有需要特别避开的动作</small></span>
          <i className="setup-radio" aria-hidden="true">{!hasRestriction && <Icon name="check" size={14} stroke={2.8} />}</i>
        </button>
        <button type="button" aria-pressed={hasRestriction} onClick={() => { haptic(); setHasRestriction(true); }}>
          <span><b>有，写一下</b><small>例如：左肩有旧伤，避免过顶推举</small></span>
          <i className="setup-radio" aria-hidden="true">{hasRestriction && <Icon name="check" size={14} stroke={2.8} />}</i>
        </button>
        {hasRestriction && <textarea className="setup-textarea" autoFocus maxLength={200} value={restriction}
          placeholder="写下需要避开的动作或部位" onChange={(event) => setRestriction(event.target.value)} />}
      </div>}

      {step === 'favorites' && <div className="setup-favorites">
        <div className="vseg small" role="tablist" aria-label="部位">
          {PARTS.map((p) => <button key={p.key} type="button" role="tab" aria-selected={part === p.key} className={part === p.key ? 'on' : ''}
            onClick={() => { haptic(4); setPart(p.key); }}>{p.label}</button>)}
        </div>
        <ul className="setup-ex">
          {!items[part] && <li className="setup-hint">正在加载动作…</li>}
          {(items[part] ?? []).map((item) => {
            const on = liked.has(item.id);
            return <li key={item.id}>
              <button type="button" aria-pressed={on} onClick={() => {
                haptic(5);
                setLiked((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
              }}>
                <span className="thumb small">{/* eslint-disable-next-line @next/next/no-img-element */}{item.image && <img src={imageUrl(item.image)} alt="" loading="lazy" />}</span>
                <strong>{item.zh_name || item.name}</strong>
                <i className="setup-radio" aria-hidden="true">{on && <Icon name="check" size={14} stroke={2.8} />}</i>
              </button>
            </li>;
          })}
        </ul>
      </div>}

      <p className="setup-note">{note[step]}</p>
    </main>

    <footer className="setup-foot">
      {error && <p className="form-err" role="alert">{error}</p>}
      <button type="button" className="ink-btn" disabled={!canNext || saving} onClick={() => { if (last) void finish(); else move(1); }}>
        <span>{saving ? '正在保存…' : last ? (liked.size ? `完成 · 加入 ${liked.size} 个动作` : '完成，开始使用') : missing ? `再填一下${missing}` : unset ? '暂不填写' : '下一步'}</span>
        <span className="ink-btn-meta">{step === 'goal' && !goal ? '选一项' : null}<Icon name={last ? 'check' : 'arrow-right'} size={20} stroke={2} /></span>
      </button>
    </footer>
  </div>;
}
