'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ExerciseSheet, { type ExerciseChoice } from './ExerciseSheet';
import SculptureBody, { type SculptureAnchor } from './SculptureBody';
import PlanDetail from './PlanDetail';
import PlanMusclePicker from './PlanMusclePicker';
import type { MuscleId } from '@/lib/muscles';
import { canonicalMuscle, sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';
import { PLAN_POSES, planPoseFor } from '@/lib/plan-poses';

/** 首屏提示锚点：参考图里只亮胸部一个柠檬黄点。 */
const HINT: SculptureAnchor = { muscle: 'chest_mid', label: '胸部' };

function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* iOS Safari 没有振动接口 */ }
}

type Library = 'all' | 'liked';
type PlanLayer = 'muscle' | 'library';

function pushLayer(layer: PlanLayer, value: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(layer) === value) return;
  url.searchParams.set(layer, value);
  if (layer === 'muscle') url.searchParams.delete('library');
  window.history.pushState({ fitcheckPlanLayer: layer }, '', url);
}

function closeLayer(layer: PlanLayer) {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(layer)) return;
  if (window.history.state?.fitcheckPlanLayer === layer) {
    window.history.back();
    return;
  }
  url.searchParams.delete(layer);
  if (layer === 'muscle') url.searchParams.delete('library');
  window.history.replaceState(null, '', url);
}

export default function PlanBody({ variant, todayPlan }: {
  variant: SculptureVariant;
  todayPlan: { date: string; label?: string; exerciseIds: string[] };
}) {
  const router = useRouter();
  const query = useSearchParams();
  const picked = canonicalMuscle(query.get('muscle'));
  const group = sculptureGroup(picked);
  const library = query.get('library');
  const sheet = picked && (library === 'all' || library === 'liked') ? library : null;
  const [side, setSide] = useState<'front' | 'back'>(group?.side === 'back' ? 'back' : 'front');
  const [selected, setSelected] = useState<ReadonlyMap<string, ExerciseChoice>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const lock = useRef(false);
  const lastLayer = useRef<PlanLayer | null>(null);
  const planned = new Set(todayPlan.exerciseIds);

  useEffect(() => {
    setSelected(new Map());
    setError('');
  }, [picked]);

  useEffect(() => {
    const layer = sheet ? 'library' : picked ? 'muscle' : null;
    if (layer === lastLayer.current) return;
    lastLayer.current = layer;
    if (layer === null) detailTrigger.current?.focus({ preventScroll: true });
    if (layer === 'muscle') root.current?.querySelector<HTMLButtonElement>('.plan-detail-close')?.focus();
    if (layer === 'library') root.current?.querySelector<HTMLDivElement>('.fc-dict-sheet')?.focus();
  }, [picked, sheet]);

  function onPick(id: MuscleId, trigger: HTMLElement | null = null) {
    const muscle = canonicalMuscle(id);
    if (!muscle || canonicalMuscle(new URLSearchParams(window.location.search).get('muscle'))) return;
    detailTrigger.current = trigger;
    haptic();
    pushLayer('muscle', muscle);
  }

  function openLibrary(which: Library) {
    pushLayer('library', which);
  }

  function toggle(exercise: ExerciseChoice) {
    if (lock.current || planned.has(exercise.id)) return;
    setError('');
    haptic(5);
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(exercise.id)) next.delete(exercise.id);
      else next.set(exercise.id, exercise);
      return next;
    });
  }

  async function complete() {
    if (lock.current || selected.size === 0) return null;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: todayPlan.date, exerciseIds: [...selected.keys()] }),
      });
      const result = await response.json() as { addedItemIds?: number[]; error?: string };
      if (!response.ok) throw new Error(result.error || '保存失败，请重试');
      haptic(12);
      return result.addedItemIds ?? [];
    } catch (err) {
      setError((err as Error).message);
      lock.current = false;
      setSaving(false);
      return null;
    }
  }

  const pose = picked ? planPoseFor(picked) : null;
  const anchor: SculptureAnchor = picked && group ? { muscle: picked, label: group.label } : HINT;

  return (
    <div ref={root} className="plan-root fc">
      <div inert={Boolean(picked)} aria-hidden={picked ? true : undefined}>
        <div className="plan-overview-controls">
          <button type="button" className="plan-rotate" onClick={() => setSide((current) => current === 'front' ? 'back' : 'front')}>
            {side === 'front' ? '看背面' : '看正面'}
          </button>
        </div>
        <div className="plan-stage" data-detail={picked ? 'open' : undefined}>
          <div className="plan-dots" aria-hidden="true" />
          <SculptureBody look="halftone" key={variant} variant={variant} side={side} selected={picked}
            onPick={onPick} anchor={anchor} />
        </div>
        <PlanMusclePicker onPick={(id, trigger) => {
          setSide(sculptureGroup(id)?.side === 'back' ? 'back' : 'front');
          onPick(id, trigger);
        }} />
      </div>

      {picked && pose && (
        <PlanDetail
          libraryOpen={sheet !== null}
          muscle={picked}
          muscleLabel={group?.label ?? ''}
          region={PLAN_POSES[pose].label}
          pose={pose}
          variant={variant}
          onOpenLibrary={openLibrary}
          onClose={() => closeLayer('muscle')}
        />
      )}

      <ExerciseSheet
        muscle={sheet ? picked : null}
        grouped
        preference={sheet === 'liked' ? 'liked' : undefined}
        onClose={() => { if (!lock.current) closeLayer('library'); }}
        selection={{ label: todayPlan.label, planned, selected, toggle, saving, error, complete }}
        onSelectionComplete={(addedItemIds) => {
          const query = new URLSearchParams(addedItemIds.map((id) => ['added', String(id)]));
          if (todayPlan.label) query.set('date', todayPlan.date);
          router.replace(query.size ? `/train?${query}` : '/train');
          router.refresh();
        }}
      />
    </div>
  );
}
