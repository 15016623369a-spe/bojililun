'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LIMITS, equipmentFactor, estimateEnergy, muscleHeat, sanitizeSet } from '@/lib/energy';
import { imageUrl, TARGET_LABEL } from '@/lib/exercise-label';
import type { TrainingDetail } from '@/lib/log';
import BodyHeat from './BodyHeat';

interface Row {
  key: string;
  exerciseId: string;
  name: string;
  bodyPart: string;
  target: string;
  secondary: string[];
  equipment: string;
  equipmentLabel: string;
  image: string;
  sets: number;
  reps: number;
  weight: number;
}

function toRows(detail: TrainingDetail): Row[] {
  return detail.exercises.map((e) => ({
    key: e.key,
    exerciseId: e.exerciseId,
    name: e.name,
    bodyPart: e.bodyPart,
    target: e.target,
    secondary: e.secondary,
    equipment: e.equipment,
    equipmentLabel: e.equipmentLabel,
    image: e.image,
    sets: e.sets,
    reps: e.reps,
    weight: e.weight,
  }));
}

function signature(rows: Row[]): string {
  return rows.map((r) => `${r.key}|${r.sets}|${r.reps}|${r.weight}`).join(',');
}

/** 动作缩略图：先要动图，拉不到就回落静态图，再不行显示首字 */
function Thumb({ id, image, name }: { id: string; image: string; name: string }) {
  const [src, setSrc] = useState(`/api/gif/${id}`);
  const [step, setStep] = useState(0);
  return (
    <div className="fc-ex-thumb">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name}
        loading="lazy"
        onError={() => {
          if (step === 0 && image) {
            setStep(1);
            setSrc(imageUrl(image));
          } else {
            setStep(2);
          }
        }}
      />
      {step === 2 && <span className="fc-ex-fallback">{name.slice(0, 1)}</span>}
      {step === 0 && <i className="fc-ex-gif-tag">GIF</i>}
    </div>
  );
}

export default function RecordDetail({ detail }: { detail: TrainingDetail }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => toRows(detail));
  const [baseline, setBaseline] = useState(() => signature(toRows(detail)));
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const dirty = signature(rows) !== baseline;

  const energy = useMemo(
    () => estimateEnergy(rows, detail.minutes, detail.bodyWeightKg),
    [rows, detail.minutes, detail.bodyWeightKg],
  );
  const heat = useMemo(() => muscleHeat(rows, detail.bodyWeightKg), [rows, detail.bodyWeightKg]);

  const perExercise = useMemo(() => {
    const totalSets = rows.reduce((a, r) => a + sanitizeSet(r.sets, 'sets'), 0) || 1;
    return rows.map((r) => {
      const sets = sanitizeSet(r.sets, 'sets');
      const reps = sanitizeSet(r.reps, 'reps');
      const weight = sanitizeSet(r.weight, 'weight');
      const share = sets / totalSets;
      const e = estimateEnergy([r], Math.max(1, detail.minutes * share), detail.bodyWeightKg);
      return { kcal: e.kcal, volume: sets * reps * weight, factor: equipmentFactor(r.equipment) };
    });
  }, [rows, detail.minutes, detail.bodyWeightKg]);

  const patch = (patchRow: Partial<Row> & { key: string }) => {
    setRows((prev) => prev.map((r) => (r.key === patchRow.key ? { ...r, ...patchRow } : r)));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/log', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'training',
          id: detail.id,
          items: rows.map((r) => ({
            exerciseId: r.exerciseId.startsWith('quick-') ? undefined : r.exerciseId,
            name: r.name,
            bodyPart: r.bodyPart,
            target: r.target,
            sets: r.sets,
            reps: r.reps,
            weight: r.weight,
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || '保存失败');
      setBaseline(signature(rows));
      setToast('已保存，热量和热区都按新数据重算了');
      router.refresh();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (saving) return;
    if (!window.confirm('删除这次训练记录？会自动回到记录页。')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/log?kind=training&id=${detail.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除失败');
      router.replace('/log');
      router.refresh();
    } catch (e) {
      setToast((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fc-detail">
      <div className="fc-detail-top">
        <Link href="/log" className="fc-back" aria-label="返回记录">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <span className="fc-detail-tag">
          {detail.label} · {detail.time}
        </span>
      </div>

      <h1 className="fc-detail-h1">{detail.region}训练</h1>
      <p className="fc-detail-sub">
        {detail.minutes} 分钟 · {rows.length} 个动作 · {rows.reduce((a, r) => a + Math.max(1, r.sets), 0)} 组
      </p>

      {detail.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="fc-detail-photo" src={detail.photo} alt="这次训练的照片" />
      )}

      <BodyHeat heat={heat} />

      <div className="fc-legend">
        {heat.filter((h) => h.level >= 0.05).slice(0, 5).map((h) => (
          <div className="fc-legend-row" key={h.id}>
            <span className="fc-legend-name">{h.label}</span>
            <span className="fc-legend-bar">
              <i style={{ width: `${Math.max(6, Math.round(h.level * 100))}%` }} />
            </span>
            <span className="fc-legend-pct">{Math.round(h.level * 100)}%</span>
          </div>
        ))}
        {heat.length === 0 && <p className="fc-note">还没有动作数据，热区出不来。</p>}
      </div>

      <div style={{ textAlign: 'right' }}>
        <a className="fc-dict-link" href="/body">
          按部位查标准动作 →
        </a>
      </div>

      <div className="fc-energy">
        <div className="fc-energy-label">这次大概消耗</div>
        <div className="fc-energy-num">
          {energy.kcal}
          <small>kcal</small>
        </div>
        <div className="fc-energy-grid">
          <div>
            <b>{energy.sets}</b>组 · {energy.reps} 次
          </div>
          <div>
            <b>{energy.volume.toLocaleString('zh-CN')}</b>kg 容量
          </div>
          <div>
            <b>{detail.minutes}</b>分钟
          </div>
          <div>
            <b>{detail.bodyWeightKg}</b>kg 体重{detail.profileMissing ? '（默认）' : ''}
          </div>
        </div>
        <p className="fc-note">
          按「MET {energy.met} × 强度 {energy.intensity} × 器械 {energy.equipmentFactor} × {detail.minutes} 分钟 ×{' '}
          {detail.bodyWeightKg}kg」粗算，量级参考，误差约 ±20%。
          {energy.intensityCapped && ' 强度已到上限 1.5（再多容量也不加），所以数字不会跟着容量线性涨。'}
          {detail.profileMissing && ' 去「我的」填了体重会更准。'}
        </p>
        {!energy.plausible && (
          <p className="fc-warn">
            这组数字偏大：容量密度 {energy.density}（超过 8）。热量已按上限估，建议核对一下组数 / 次数 / 重量。
          </p>
        )}
      </div>

      <h2 className="fc-sec-title">动作 / 组数 / 重量</h2>
      <p className="fc-note" style={{ marginTop: -6, marginBottom: 10 }}>
        填上组数、次数、重量，热量和热区会立刻重算。组数 {LIMITS.sets.min}–{LIMITS.sets.max} · 次数{' '}
        {LIMITS.reps.min}–{LIMITS.reps.max} · 重量 {LIMITS.weight.min}–{LIMITS.weight.max}kg，超出的部分会自动夹住。
      </p>

      <div className="fc-exs">
        {rows.map((r, i) => (
          <div className="fc-ex" key={r.key}>
            <Thumb id={r.exerciseId} image={r.image} name={r.name} />
            <div className="fc-ex-body">
              <div className="fc-ex-name">{r.name}</div>
              <div className="fc-ex-eq">
                {r.equipmentLabel}
                {r.target ? ` · ${TARGET_LABEL[r.target] ?? r.target}` : ''}
              </div>
              <div className="fc-ex-fields">
                <label className="fc-ex-field">
                  <span>组数</span>
                  <input
                    inputMode="numeric"
                    value={r.sets}
                    onChange={(e) => patch({ key: r.key, sets: sanitizeSet(e.target.value.replace(/[^\d]/g, ''), 'sets') })}
                  />
                </label>
                <label className="fc-ex-field">
                  <span>次数</span>
                  <input
                    inputMode="numeric"
                    value={r.reps}
                    onChange={(e) => patch({ key: r.key, reps: sanitizeSet(e.target.value.replace(/[^\d]/g, ''), 'reps') })}
                  />
                </label>
                <label className="fc-ex-field">
                  <span>重量 kg</span>
                  <input
                    inputMode="decimal"
                    value={r.weight}
                    onChange={(e) => patch({ key: r.key, weight: sanitizeSet(e.target.value.replace(/[^\d.]/g, ''), 'weight') })}
                  />
                </label>
              </div>
              <div className="fc-ex-kcal">
                约 {perExercise[i]?.kcal ?? 0} kcal · 容量 {perExercise[i]?.volume.toLocaleString('zh-CN') ?? 0} kg · 器械 ×
                {perExercise[i]?.factor ?? 1}
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="fc-note">这次训练没有动作明细，可以在「记录」里重说一遍。</p>}
      </div>

      {dirty && (
        <div className="fc-save-bar">
          <button type="button" className="fc-btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存组数 / 重量'}
          </button>
        </div>
      )}

      <button
        type="button"
        className="fc-delete"
        onClick={() => void remove()}
        disabled={saving}
      >
        删除这次记录
      </button>

      {toast && <div className="fc-toast">{toast}</div>}
    </div>
  );
}
