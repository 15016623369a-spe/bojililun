'use client';

import { useState } from 'react';
import { ACTIVITY, GOAL, type ActivityKey, type GoalKey, type Sex } from '@/lib/nutrition';

export interface OnboardingInitial {
  sex?: string;
  age?: number;
  height_cm?: number;
  weight_kg?: number;
  activity?: string;
  goal?: string;
}

export default function Onboarding({ onDone, initial }: { onDone: () => void; initial?: OnboardingInitial }) {
  const [sex, setSex] = useState<Sex>(initial?.sex === 'female' ? 'female' : 'male');
  const [age, setAge] = useState(initial?.age ?? 25);
  const [height, setHeight] = useState(initial?.height_cm ?? 175);
  const [weight, setWeight] = useState(initial?.weight_kg ?? 70);
  const [activity, setActivity] = useState<ActivityKey>((initial?.activity as ActivityKey) ?? 'light');
  const [goal, setGoal] = useState<GoalKey>((initial?.goal as GoalKey) ?? 'maintain');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: '我',
          sex,
          age,
          height_cm: height,
          weight_kg: weight,
          activity,
          goal,
        }),
      });
      if (!res.ok) throw new Error('保存失败，稍后再试');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay">
      <div className="sheet">
        <h1>{initial ? "更新资料" : "先认识你一下"}</h1>
        <p className="sub">这些数字只用来算热量和蛋白质目标，之后随时可以在记忆里改。</p>

        <div className="field">
          <label>性别</label>
          <div className="seg">
            <button className={sex === 'male' ? 'on' : ''} onClick={() => setSex('male')}>
              男
            </button>
            <button className={sex === 'female' ? 'on' : ''} onClick={() => setSex('female')}>
              女
            </button>
          </div>
        </div>

        <div className="row2 field">
          <div>
            <label>年龄</label>
            <input type="number" value={age} onChange={(e) => setAge(Number(e.target.value))} />
          </div>
          <div>
            <label>身高（cm）</label>
            <input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
          </div>
        </div>

        <div className="field">
          <label>体重（kg）</label>
          <input type="number" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
        </div>

        <div className="field">
          <label>活动量</label>
          <select value={activity} onChange={(e) => setActivity(e.target.value as ActivityKey)}>
            {(Object.keys(ACTIVITY) as ActivityKey[]).map((k) => (
              <option key={k} value={k}>
                {ACTIVITY[k].label} · {ACTIVITY[k].desc}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>目标</label>
          <div className="goal-list">
            {(Object.keys(GOAL) as GoalKey[]).map((k) => (
              <button key={k} className={goal === k ? 'on' : ''} onClick={() => setGoal(k)}>
                <b>{GOAL[k].label}</b>
                <span>{GOAL[k].desc}</span>
              </button>
            ))}
          </div>
        </div>

        {err && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p>}

        <button className="btn primary" style={{ width: '100%', marginTop: 6 }} disabled={busy} onClick={submit}>
          {busy ? '计算中…' : '开始使用'}
        </button>
      </div>
    </div>
  );
}
