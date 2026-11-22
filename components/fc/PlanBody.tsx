'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ExerciseSheet from './ExerciseSheet';
import SculptureBody, { type SculptureAnchor } from './SculptureBody';
import PlanDetail from './PlanDetail';
import PlanModelSwitch from './PlanModelSwitch';
import PlanMusclePicker from './PlanMusclePicker';
import { BODY_MODEL_COOKIE, parseBodyModel } from '@/lib/body-model-preference';
import type { MuscleId } from '@/lib/muscles';
import type { PlanItem } from '@/lib/types';
import { canonicalMuscle, sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';
import { PLAN_POSES, planPoseFor } from '@/lib/plan-poses';

/** 首屏提示锚点：参考图里只亮胸部一个柠檬黄点。 */
const HINT: SculptureAnchor = { muscle: 'chest_mid', label: '胸部' };

function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* iOS Safari 没有振动接口 */ }
}

type PlanExercise = Pick<PlanItem, 'exercise_id' | 'done'>;
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

export default function PlanBody({ profileModel, modelPreference, todayPlan, activeSession = null }: {
  profileModel: SculptureVariant;
  modelPreference: SculptureVariant | null;
  todayPlan: { date: string; items: PlanExercise[] };
  activeSession?: number | null;
}) {
  const router = useRouter();
  const query = useSearchParams();
  const picked = canonicalMuscle(query.get('muscle'));
  const group = sculptureGroup(picked);
  const library = query.get('library');
  const sheet = picked && (library === 'all' || library === 'liked') ? library : null;
  const [localPreference, setLocalPreference] = useState<SculptureVariant | null>();
  const choice = localPreference === undefined
    ? parseBodyModel(query.get('body')) ?? modelPreference
    : localPreference;
  const variant = choice ?? profileModel;
  const [side, setSide] = useState<'front' | 'back'>(group?.side === 'back' ? 'back' : 'front');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<{ source: PlanExercise[]; items: PlanExercise[] }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const lock = useRef(false);
  const lastLayer = useRef<PlanLayer | null>(null);
  const items = saved?.source === todayPlan.items ? saved.items : todayPlan.items;
  const planned = new Set(items.map((item) => item.exercise_id));
  const pendingCount = items.filter((item) => !item.done).length;

  useEffect(() => {
    setSelected(new Set());
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

  function changeModel(model: SculptureVariant | null) {
    const url = new URL(window.location.href);
    if (model === choice && !url.searchParams.has('body')) return;
    document.cookie = `${BODY_MODEL_COOKIE}=${model ?? ''}; Path=/; SameSite=Lax; Max-Age=${model ? 31536000 : 0}`;
    setLocalPreference(model);
    if (url.searchParams.has('body')) {
      url.searchParams.delete('body');
      const layer = window.history.state?.fitcheckPlanLayer;
      window.history.replaceState(layer ? { fitcheckPlanLayer: layer } : null, '', url);
    }
    router.refresh();
  }

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

  function toggle(exerciseId: string) {
    if (lock.current || planned.has(exerciseId)) return;
    setError('');
    haptic(5);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(exerciseId)) next.delete(exerciseId);
      else next.add(exerciseId);
      return next;
    });
  }

  async function complete() {
    if (lock.current || selected.size === 0) return false;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: todayPlan.date, exerciseIds: [...selected] }),
      });
      const result = await response.json() as { items?: PlanExercise[]; error?: string };
      if (!response.ok || !result.items) throw new Error(result.error || '保存失败，请重试');
      setSaved({ source: todayPlan.items, items: result.items });
      setSelected(new Set());
      haptic(12);
      router.refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  const pose = picked ? planPoseFor(picked) : null;
  const anchor: SculptureAnchor = picked && group ? { muscle: picked, label: group.label } : HINT;

  return (
    <div ref={root} className="plan-root fc">
      <div inert={Boolean(picked)} aria-hidden={picked ? true : undefined}>
        <div className="plan-overview-controls">
          <PlanModelSwitch choice={choice} onChange={changeModel} />
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
          modelChoice={choice}
          onModelChange={changeModel}
          pendingCount={pendingCount}
          activeSession={activeSession}
          onOpenLibrary={openLibrary}
          onClose={() => closeLayer('muscle')}
        />
      )}

      <ExerciseSheet
        muscle={sheet ? picked : null}
        grouped
        preference={sheet === 'liked' ? 'liked' : undefined}
        onClose={() => closeLayer('library')}
        selection={{ planned, selected, toggle, saving, error, complete }}
      />
    </div>
  );
}
