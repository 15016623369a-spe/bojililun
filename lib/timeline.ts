import type { PlanItem, SetRow } from './types';

export type RestPhase = 'idle' | 'lifting' | 'recovering' | 'ready' | 'long' | 'gap';

export type TimelineSegment =
  | {
      kind: 'lift';
      set: SetRow;
      setIndex: number;
      startMs: number;
      endMs: number;
      durationSec: number;
      isBest: boolean;
    }
  | {
      kind: 'rest';
      key: string;
      startMs: number;
      endMs: number;
      durationSec: number;
      phase: RestPhase;
    };

export type TimelineBlock = {
  /** 唯一块标识：已发生的连续段用 run-N，未开练的计划大项用 plan-ID */
  key: string;
  planItemId: number;
  exerciseId: string;
  name: string;
  target: string;
  weight: number;
  reps: number;
  plannedSets: number;
  restSec: number;
  supplemental: boolean;
  status: 'recorded' | 'active' | 'upcoming';
  /** 实际开始/结束或推算的时间窗（毫秒时间戳） */
  startMs: number;
  endMs: number;
  isProjected: boolean;
  /** 本大项与前一大项之间的换项时长（秒） */
  transitionBeforeSec: number | null;
  transitionPhase: RestPhase | null;
  segments: TimelineSegment[];
  setCount: number;
  liftTotalSec: number;
  restTotalSec: number;
};

export type WorkoutTimelineModel = {
  blocks: TimelineBlock[];
  totalLiftSec: number;
  totalRestSec: number;
  totalTransitionSec: number;
  totalSets: number;
  lastSet: SetRow | null;
  /** 从上一组结束到当前时刻（或开组时刻）的实时休息/换项秒数 */
  liveRestSec: number;
  liveLiftSec: number;
};

const DEFAULT_SET_WORK_SEC = 35;
const DEFAULT_TRANSITION_SEC = 120;

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600) {
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatHHMM(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function restPhase(seconds: number, targetSec: number, live: boolean): RestPhase {
  const target = Math.max(15, targetSec || 90);
  const longAt = Math.round(target * 1.5);
  if (seconds > 600) return 'gap';
  if (seconds > longAt) return 'long';
  if (live) return seconds >= target ? 'ready' : 'recovering';
  return seconds >= Math.round(target * 0.7) ? 'ready' : 'recovering';
}

const e1rm = (w: number, r: number) => (r <= 0 || r > 15 || w <= 0 ? 0 : r === 1 ? w : w * (1 + r / 30));

function setBestId(group: SetRow[]): number | null {
  if (group.length < 2) return null;
  const scores = group.map((s) => e1rm(s.weight, s.reps) || s.weight * s.reps || s.reps);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  return max > min ? (group[scores.indexOf(max)]?.id ?? null) : null;
}

function restSecBetween(earlier: SetRow, later: SetRow): number {
  if (earlier.actual_rest_sec != null && earlier.actual_rest_sec >= 0) return earlier.actual_rest_sec;
  const raw = Math.round((Date.parse(later.created_at) - Date.parse(earlier.created_at)) / 1000);
  return Math.max(0, raw - (later.duration_sec || 0));
}

function estimateBlockSpanMs(sets: number, restSec: number): number {
  const n = Math.max(1, sets || 3);
  return (n * DEFAULT_SET_WORK_SEC + Math.max(0, n - 1) * (restSec || 90)) * 1000;
}

export function buildWorkoutTimeline({
  plan,
  sets,
  activePlanItemId,
  liftingState,
  nowMs,
}: {
  plan: PlanItem[];
  sets: SetRow[];
  activePlanItemId: number | null;
  liftingState: { planItemId: number; startedAtMs: number } | null;
  nowMs: number;
}): WorkoutTimelineModel {
  const planById = new Map(plan.map((p) => [p.id, p]));
  const planByEx = new Map(plan.map((p) => [p.exercise_id, p]));
  const orderedSets = [...sets].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);

  // 1. 按真实时间把已记组聚成连续的大项片段（同一动作中断后回练会自然形成新的时间段）
  const runs: { planItemId: number; exerciseId: string; name: string; sets: SetRow[] }[] = [];
  for (const s of orderedSets) {
    const pid = s.plan_item_id ?? planByEx.get(s.exercise_id)?.id ?? -s.id;
    const prev = runs.at(-1);
    if (prev && prev.exerciseId === s.exercise_id && prev.planItemId === pid) prev.sets.push(s);
    else runs.push({ planItemId: pid, exerciseId: s.exercise_id, name: s.exercise_name, sets: [s] });
  }

  const blocks: TimelineBlock[] = [];
  const usedPlanIds = new Set<number>();
  let totalLiftSec = 0;
  let totalRestSec = 0;
  let totalTransitionSec = 0;

  runs.forEach((run, runIdx) => {
    const p = planById.get(run.planItemId) ?? planByEx.get(run.exerciseId);
    if (p) usedPlanIds.add(p.id);
    const bestId = setBestId(run.sets);
    const segments: TimelineSegment[] = [];
    let liftTotalSec = 0;
    let restTotalSec = 0;

    run.sets.forEach((s, i) => {
      const endMs = Date.parse(s.created_at);
      const dur = Math.max(0, s.duration_sec || 0);
      const startMs = endMs - dur * 1000;
      if (i > 0) {
        const prev = run.sets[i - 1];
        const rSec = restSecBetween(prev, s);
        if (rSec > 0) {
          restTotalSec += rSec;
          segments.push({
            kind: 'rest',
            key: `r-${prev.id}-${s.id}`,
            startMs: Date.parse(prev.created_at),
            endMs: startMs,
            durationSec: rSec,
            phase: restPhase(rSec, prev.rest_sec || p?.rest_sec || 90, false),
          });
        }
      }
      liftTotalSec += dur;
      segments.push({ kind: 'lift', set: s, setIndex: s.set_index, startMs, endMs, durationSec: dur, isBest: bestId === s.id });
    });

    const prevRunLast = runIdx > 0 ? runs[runIdx - 1].sets.at(-1)! : null;
    const firstSet = run.sets[0];
    const lastSet = run.sets.at(-1)!;
    const transitionBeforeSec = prevRunLast ? restSecBetween(prevRunLast, firstSet) : null;
    if (transitionBeforeSec != null && transitionBeforeSec > 0) totalTransitionSec += transitionBeforeSec;
    totalLiftSec += liftTotalSec;
    totalRestSec += restTotalSec;

    const isLatestRunOfActive =
      activePlanItemId === run.planItemId &&
      runs.findLastIndex((r) => r.planItemId === run.planItemId) === runIdx;
    const blockStart = segments[0]?.startMs ?? Date.parse(firstSet.created_at);
    const blockEnd = isLatestRunOfActive ? Math.max(nowMs, Date.parse(lastSet.created_at)) : Date.parse(lastSet.created_at);

    blocks.push({
      key: `run-${runIdx}-${run.planItemId}`,
      planItemId: run.planItemId,
      exerciseId: run.exerciseId,
      name: p?.name ?? run.name,
      target: p?.target ?? firstSet.target ?? '',
      weight: lastSet.weight || p?.weight || 0,
      reps: lastSet.reps || p?.reps || 10,
      plannedSets: p?.sets ?? run.sets.length,
      restSec: p?.rest_sec ?? lastSet.rest_sec ?? 90,
      supplemental: Boolean(p?.supplemental),
      status: isLatestRunOfActive ? 'active' : 'recorded',
      startMs: blockStart,
      endMs: blockEnd,
      isProjected: false,
      transitionBeforeSec: transitionBeforeSec && transitionBeforeSec > 0 ? transitionBeforeSec : null,
      transitionPhase: transitionBeforeSec && transitionBeforeSec > 0 ? restPhase(transitionBeforeSec, p?.rest_sec || 90, false) : null,
      segments,
      setCount: run.sets.length,
      liftTotalSec,
      restTotalSec,
    });
  });

  // 2. 尚未开练的计划大项按用户排好的顺序接在时间轴下方，动态推算每段时间窗
  let cursorMs = Math.max(nowMs, blocks.at(-1)?.endMs ?? nowMs);
  for (const p of plan) {
    if (usedPlanIds.has(p.id)) continue;
    const isActive = activePlanItemId === p.id;
    const isLiftingThis = liftingState?.planItemId === p.id;
    const spanMs = estimateBlockSpanMs(p.sets, p.rest_sec);
    const startMs = isLiftingThis ? liftingState.startedAtMs : cursorMs;
    const endMs = isLiftingThis ? Math.max(nowMs, startMs + spanMs) : startMs + spanMs;
    blocks.push({
      key: `plan-${p.id}`,
      planItemId: p.id,
      exerciseId: p.exercise_id,
      name: p.name,
      target: p.target,
      weight: p.weight,
      reps: p.reps,
      plannedSets: p.sets,
      restSec: p.rest_sec,
      supplemental: Boolean(p.supplemental),
      status: isActive || isLiftingThis ? 'active' : 'upcoming',
      startMs,
      endMs,
      isProjected: !isLiftingThis,
      transitionBeforeSec: null,
      transitionPhase: null,
      segments: [],
      setCount: 0,
      liftTotalSec: 0,
      restTotalSec: 0,
    });
    cursorMs = endMs + DEFAULT_TRANSITION_SEC * 1000;
  }

  const lastSet = orderedSets.at(-1) ?? null;
  const liveLiftSec = liftingState ? Math.max(0, Math.floor((nowMs - liftingState.startedAtMs) / 1000)) : 0;
  const liveRestSec = lastSet
    ? Math.max(0, Math.floor(((liftingState ? liftingState.startedAtMs : nowMs) - Date.parse(lastSet.created_at)) / 1000))
    : 0;

  return {
    blocks,
    totalLiftSec,
    totalRestSec,
    totalTransitionSec,
    totalSets: orderedSets.length,
    lastSet,
    liveRestSec,
    liveLiftSec,
  };
}


export type HorizontalSlot = {
  slotKey: string;
  startMs: number;
  endMs: number;
  isProjected: boolean;
  transitionBeforeSec: number | null;
  transitionPhase: RestPhase | null;
  cards: TimelineBlock[];
};

export type DropMode = 'before' | 'stack' | 'after';

/**
 * 在横向时间轴上调整或叠放卡片：
 * - mode = 'stack'：将拖拽卡片叠放到目标时间列中（与该列其他卡片保持空隙并共享同一时段）
 * - mode = 'before' / 'after'：将拖拽卡片独立成列，插在目标时间列之前或之后（也可把已叠放的卡片拖出拆开）
 */
export function applyCardDrop(
  columns: number[][],
  draggedId: number,
  targetColIdx: number,
  mode: DropMode,
): number[][] {
  const next = columns.map((col) => col.filter((id) => id !== draggedId));
  let removedBefore = 0;
  const compact: number[][] = [];
  next.forEach((col, idx) => {
    if (col.length > 0) compact.push(col);
    else if (idx < targetColIdx) removedBefore += 1;
  });
  const adj = Math.max(0, Math.min(compact.length - 1, targetColIdx - removedBefore));
  if (compact.length === 0) return [[draggedId]];
  if (mode === 'stack') {
    compact[adj] = [...compact[adj], draggedId];
    return compact;
  }
  const insertAt = mode === 'before' ? adj : adj + 1;
  compact.splice(insertAt, 0, [draggedId]);
  return compact;
}

/** 根据用户排好的二维列结构（每列 1 张或多张叠放卡片），生成横向时间轴上的时间刻度与换项段 */
export function buildHorizontalSlots(
  model: WorkoutTimelineModel,
  storedColumns: number[][] | null,
  nowMs: number,
): { slots: HorizontalSlot[]; columns: number[][] } {
  // 每个 planItemId 对应一个代表卡片（若同一动作有多个片段，取最新段作为代表并汇总总组数/总力训时长）
  const cardByPlanId = new Map<number, TimelineBlock>();
  for (const b of model.blocks) {
    const prev = cardByPlanId.get(b.planItemId);
    if (!prev) {
      cardByPlanId.set(b.planItemId, { ...b });
    } else {
      cardByPlanId.set(b.planItemId, {
        ...b,
        startMs: Math.min(prev.startMs, b.startMs),
        endMs: Math.max(prev.endMs, b.endMs),
        setCount: prev.setCount + b.setCount,
        liftTotalSec: prev.liftTotalSec + b.liftTotalSec,
        restTotalSec: prev.restTotalSec + b.restTotalSec,
        segments: [...prev.segments, ...b.segments],
      });
    }
  }

  const validIds = [...cardByPlanId.keys()];
  const validSet = new Set(validIds);
  const columns: number[][] = [];
  const placed = new Set<number>();

  if (storedColumns && storedColumns.length > 0) {
    for (const col of storedColumns) {
      const kept = col.filter((id) => validSet.has(id) && !placed.has(id));
      if (kept.length > 0) {
        kept.forEach((id) => placed.add(id));
        columns.push(kept);
      }
    }
  }
  for (const id of validIds) {
    if (!placed.has(id)) {
      placed.add(id);
      columns.push([id]);
    }
  }

  let cursorMs = nowMs;
  const slots: HorizontalSlot[] = [];
  columns.forEach((col, idx) => {
    const cards = col.map((id) => cardByPlanId.get(id)!).filter(Boolean);
    const hasRecorded = cards.some((c) => !c.isProjected);
    const spanMs = cards.reduce((sum, c) => sum + estimateBlockSpanMs(c.plannedSets, c.restSec), 0);
    const startMs = hasRecorded ? Math.min(...cards.filter((c) => !c.isProjected).map((c) => c.startMs)) : cursorMs;
    const endMs = hasRecorded ? Math.max(...cards.filter((c) => !c.isProjected).map((c) => c.endMs)) : startMs + spanMs;
    const prevSlot = slots.at(-1);
    let transSec: number | null = null;
    if (prevSlot && hasRecorded && !prevSlot.isProjected) {
      const gap = Math.round((startMs - prevSlot.endMs) / 1000);
      if (gap > 0) transSec = gap;
    }
    slots.push({
      slotKey: `slot-${idx}-${col.join('_')}`,
      startMs,
      endMs,
      isProjected: !hasRecorded,
      transitionBeforeSec: transSec,
      transitionPhase: transSec ? restPhase(transSec, cards[0]?.restSec || 90, false) : null,
      cards,
    });
    cursorMs = Math.max(nowMs, endMs) + DEFAULT_TRANSITION_SEC * 1000;
  });

  return { slots, columns };
}
