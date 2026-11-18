'use client';

import { useEffect, useState } from 'react';
import AthleteViewer from './AthleteViewer';
import atlasRegions from '@/lib/athlete-regions.json';
import { muscleById, REGIONS, type MuscleId } from '@/lib/muscles';
import { EQUIPMENT_LABEL, TARGET_LABEL, imageUrl } from '@/lib/exercise-label';
import PlanExercise from './PlanExercise';

interface ExerciseLite {
  id: string;
  name: string;
  zh_name: string;
  equipment: string;
  target: string;
  image: string;
}

interface ApiResult {
  counts: Record<string, number>;
  label?: string | null;
  total?: number;
  items: ExerciseLite[];
}

export default function BodyAtlas({ highlighted, onInspect }: {
  highlighted?: MuscleId[];
  onInspect?: (muscle: MuscleId | null) => void;
} = {}) {
  const review = highlighted !== undefined;
  const [added, setAdded] = useState('');
  const [config, setConfig] = useState<ExerciseLite | null>(null);
  function closeSelection() {
    setConfig(null);
    setSelected(null);
    setAdded('');
  }
  const [selected, setSelected] = useState<string | null>(null);
  const region = atlasRegions.find((entry) => entry.id === selected);
  const [data, setData] = useState<ApiResult | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    if (!selected) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoadingList(true);
    fetch(`/api/exercises?${region ? "region" : "muscle"}=${encodeURIComponent(selected)}&limit=50`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: ApiResult) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData({ counts: {}, items: [] });
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, region]);

  // 支持 /body?muscle=chest_upper 直接打开某块肌肉
  useEffect(() => {
    if (review) return;
    const m = new URLSearchParams(window.location.search).get('muscle');
    if (m && (muscleById(m) || atlasRegions.some((entry) => entry.id === m))) setSelected(m as MuscleId);
  }, [review]);

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConfig(null);
        setSelected(null);
        setAdded('');
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selected]);

  const selectedDef = selected ? muscleById(region?.group ?? selected) : null;

  return (
    <>
      <div className={`body-explorer ${review ? 'review-atlas' : ''}`}>
        <AthleteViewer selected={selected} highlighted={highlighted} onPick={(id) => {
          const group = atlasRegions.find((entry) => entry.id === id)?.group;
          if (review && group) onInspect?.(group as MuscleId);
          else setSelected(id);
        }} />
        {!review && <details className="muscle-fallback">
          <summary>按部位选择</summary>
          {REGIONS.map((region) => <div className="muscle-options" key={region}>
            <span>{region}</span>
            {[...atlasRegions, { id: 'neck', label: '颈部', group: 'neck' }].filter((muscle) => muscleById(muscle.group)?.region === region).map((muscle) =>
              <button key={muscle.id} className="journal-chip" onClick={() => setSelected(muscle.id)}>{muscle.label}</button>,
            )}
          </div>)}
        </details>}
      </div>

      {selected && (
        <div className="ms-backdrop" onClick={closeSelection}>
          <div className="ms-sheet" role="dialog" aria-modal="true" aria-label="选择动作" onClick={(e) => e.stopPropagation()}>
            <div className="ms-head">
              <div>
                <b>{selectedDef ? `${selectedDef.region}·${region?.label ?? selectedDef.label}` : ''}</b>
                <span>{loadingList ? '加载中…' : `${data?.total ?? 0} 个动作`}</span>
              </div>
              <button className="ms-close" onClick={closeSelection} aria-label="关闭">
                ×
              </button>
            </div>
            {added && !config && <p className="journal-status" role="status">已加入今日计划 · {added}</p>}
            {config ? <PlanExercise key={config.id} id={config.id} name={config.zh_name || config.name}
              onDone={() => setConfig(null)} onAdded={() => {
                setAdded(config.zh_name || config.name);
                setConfig(null);
              }} /> : <div className="ms-list">
              {(loadingList ? [] : (data?.items ?? [])).map((x) => (
                <div className="ms-row" key={x.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(x.image)} alt={x.zh_name} loading="lazy" />
                  <div className="ms-info">
                    <b>{x.zh_name || x.name}</b>
                    <span>
                      {TARGET_LABEL[x.target] ?? x.target} · {EQUIPMENT_LABEL[x.equipment] ?? x.equipment}
                    </span>
                  </div>
                  <button className="journal-chip" aria-label={`设置 ${x.zh_name || x.name}`} onClick={() => setConfig(x)}>选择</button>
                </div>
              ))}
              {!loadingList && (data?.items?.length ?? 0) === 0 && <p className="hint">这块肌肉暂时没有动作数据。</p>}
            </div>}
            {!config && <a className="ms-more" href="/exercises">
              去动作库看全部 1,324 个动作 →
            </a>}
          </div>
        </div>
      )}
    </>
  );
}
