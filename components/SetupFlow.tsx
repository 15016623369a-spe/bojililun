'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { TRAINING_GOALS, type TrainingGoal } from '@/lib/training-goals';
import { imageUrl } from '@/lib/exercise-label';
import { MODEL_IMAGES } from './TrainingProfileForm';
import JournalIcon from './JournalIcon';
import Icon from './ui/Icon';
import TickRuler from './ui/TickRuler';

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
const STEPS = ['model', 'goal', 'weight', 'restriction', 'favorites'] as const;
type Step = typeof STEPS[number];
type Item = { id: string; name: string; zh_name: string; image: string; equipment: string };

const haptic = (ms = 5) => { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } };

/** 新用户建档：一屏一问。目标必选，其余可跳过；最后一步可以先挑几个常练动作放进「我的动作库」。 */
export default function SetupFlow() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [sex, setSex] = useState<'male' | 'female' | null>(null);
  const [goal, setGoal] = useState<TrainingGoal | null>(null);
  const [weight, setWeight] = useState<number | null>(null);
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
      await Promise.all([...favorites].map((exerciseId) => fetch('/api/exercise-preferences', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exerciseId, preference: 'liked' }),
      })));
      haptic(16);
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const canNext = step !== 'goal' || goal !== null;
  const title: Record<Step, React.ReactNode> = {
    model: <>先选一个<br />默认的人体模型</>,
    goal: <>这阵子，<br />你想练成什么样？</>,
    weight: <>现在的体重<br />大概是多少？</>,
    restriction: <>有没有需要<br />避开的动作？</>,
    favorites: <>挑几个<br />你常练的动作</>,
  };
  const note: Record<Step, string> = {
    model: '计划页和回顾页会用它来显示人体，可以随时在「我的」里换。',
    goal: '目标会影响推荐的组次和营养目标，随时可在「我的」修改。',
    weight: '保存为第一条体重记录，之后可以在「我的」里看到变化。',
    restriction: '比如旧伤或医生建议避开的动作，排计划时会提醒你。',
    favorites: '选中的动作会进「我的动作库」，排计划时排在前面。',
  };

  return <div className="setup">
    <header className="setup-head">
      <div className="journal-brand"><JournalIcon name="brand" />FitCheck</div>
      {step !== 'goal' && <button type="button" className="setup-skip" onClick={skip} disabled={saving}>跳过，稍后填写</button>}
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

      {step === 'weight' && <div className="setup-weight">
        <div className="weight-editor-num"><b className="big-num">{(weight ?? 70).toFixed(1).split('.')[0]}<span className="dim">.{(weight ?? 70).toFixed(1).split('.')[1]}</span></b><em>kg</em></div>
        <TickRuler value={weight ?? 70} min={30} max={180} step={0.1} major={10} label="体重刻度尺" unit="kg" onChange={setWeight} />
        {weight === null && <p className="setup-hint">左右滑动刻度尺；不想填可以跳过。</p>}
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
          {!items[part] && <li className="setup-hint">正在取动作…</li>}
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
      <button type="button" className="ink-btn" disabled={!canNext || saving} onClick={() => { if (step === 'weight' && weight === null) setWeight(70); if (last) void finish(); else move(1); }}>
        <span>{saving ? '正在保存…' : last ? (liked.size ? `完成 · 加入 ${liked.size} 个动作` : '完成，开始使用') : '下一步'}</span>
        <span className="ink-btn-meta">{step === 'goal' && !goal ? '选一项' : null}<Icon name={last ? 'check' : 'arrow-right'} size={20} stroke={2} /></span>
      </button>
    </footer>
  </div>;
}
