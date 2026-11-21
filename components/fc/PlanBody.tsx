'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ExerciseSheet from './ExerciseSheet';
import SculptureBody, { type SculptureAnchor } from './SculptureBody';
import PlanDetail from './PlanDetail';
import type { MuscleId } from '@/lib/muscles';
import { canonicalMuscle, sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';
import { PLAN_POSES, planPoseFor } from '@/lib/plan-poses';

/** 首屏提示锚点：参考图里只亮胸部一个柠檬黄点。 */
const HINT: SculptureAnchor = { muscle: 'chest_mid', label: '胸部' };

function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* iOS Safari 没有振动接口 */ }
}

export default function PlanBody({ variant = 'male', todayPlan, activeSession = null }: {
  variant?: SculptureVariant;
  todayPlan: { date: string; exerciseIds: string[] };
  activeSession?: number | null;
}) {
  const router = useRouter();
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [picked, setPicked] = useState<MuscleId | null>(null);
  const [detail, setDetail] = useState<'open' | 'closing' | null>(null);
  const [sheet, setSheet] = useState<'all' | 'liked' | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<{ source: string[]; ids: string[] }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState('50% 36%');
  const stage = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number>(0);
  const lock = useRef(false);
  const planned = new Set(saved && saved.source === todayPlan.exerciseIds ? saved.ids : todayPlan.exerciseIds);

  const close = useCallback(() => {
    setDetail((state) => (state === 'open' ? 'closing' : state));
    window.setTimeout(() => setDetail(null), 320);
  }, []);

  // 手机返回手势关闭详情：打开时压一层历史记录
  useEffect(() => {
    if (detail !== 'open') return;
    const onPop = () => close();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [detail, close]);

  useEffect(() => () => window.clearTimeout(openTimer.current), []);

  function onPick(id: MuscleId) {
    const muscle = canonicalMuscle(id) ?? id;
    haptic();
    setPicked(muscle);
    setSelected(new Set());
    setError('');
    window.clearTimeout(openTimer.current);
    // 先让锚点落到肌肉上，再推近进入姿势详情
    openTimer.current = window.setTimeout(() => {
      const dot = stage.current?.querySelector('.sculpture-anchor');
      const box = stage.current?.getBoundingClientRect();
      if (dot && box) {
        const r = dot.getBoundingClientRect();
        setOrigin(`${((r.left - box.left) / box.width * 100).toFixed(1)}% ${((r.top - box.top) / box.height * 100).toFixed(1)}%`);
      }
      history.pushState({ planDetail: muscle }, '');
      setDetail('open');
    }, 340);
  }

  function dismiss() {
    if (history.state?.planDetail) history.back();
    else close();
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
      const result = await response.json() as { items?: { exercise_id: string }[]; error?: string };
      if (!response.ok || !result.items) throw new Error(result.error || '保存失败，请重试');
      setSaved({ source: todayPlan.exerciseIds, ids: result.items.map((item) => item.exercise_id) });
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

  const group = picked ? sculptureGroup(picked) : null;
  const pose = picked ? planPoseFor(picked) : null;
  const anchor: SculptureAnchor = picked && group ? { muscle: picked, label: group.label } : HINT;

  return (
    <div className="plan-root fc">
      <div ref={stage} className="plan-stage" data-detail={detail ?? undefined} style={{ transformOrigin: origin }}>
        <div className="plan-dots" aria-hidden="true" />
        <SculptureBody look="halftone" key={variant} variant={variant} side={side} selected={picked}
          onPick={onPick} anchor={anchor} />
      </div>
      <button type="button" className="plan-rotate" onClick={() => setSide((s) => (s === 'front' ? 'back' : 'front'))}
        aria-label={side === 'front' ? '转到背面' : '转到正面'}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" />
        </svg>
        拖动旋转
      </button>

      {detail && picked && pose && (
        <PlanDetail
          closing={detail === 'closing'}
          muscle={picked}
          muscleLabel={group?.label ?? ''}
          region={PLAN_POSES[pose].label}
          pose={pose}
          planCount={planned.size}
          activeSession={activeSession}
          onOpenLibrary={(which) => setSheet(which)}
          onClose={dismiss}
        />
      )}

      <ExerciseSheet
        muscle={sheet ? picked : null}
        grouped
        preference={sheet === 'liked' ? 'liked' : undefined}
        onClose={() => setSheet(null)}
        selection={{ planned, selected, toggle, saving, error, complete }}
      />
    </div>
  );
}
