'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import type { SetRow } from '@/lib/types';
import { formatClock, restPhase, type RestPhase, type TimelineBlock } from '@/lib/timeline';
import HalftoneImage from './ui/HalftoneImage';
import { playStepTick } from '@/lib/rest-alert';

export type DemoMedia = { image?: string; hasAnimation: boolean; hasSculpture?: boolean; mp4Url?: string };

const STALE_REST_SEC = 3600;
function haptic(ms = 6) { try { navigator.vibrate?.(ms); } catch { /* ignore */ } }

export default function TimelineBlockActive({
  block,
  media,
  weight,
  reps,
  nextSetNumber,
  isLiftingThis,
  isLiftingOther,
  liftingExerciseName,
  hasPriorSet,
  isSwitching,
  liveRestSec,
  liveLiftSec,
  busy,
  onWeightChange,
  onRepsChange,
  onStartLift,
  onCancelLift,
  onFinishSet,
  onJumpToLifting,
  onEditSet,
  onDeleteSet,
}: {
  block: TimelineBlock;
  media?: DemoMedia;
  weight: string;
  reps: string;
  nextSetNumber: number;
  isLiftingThis: boolean;
  isLiftingOther: boolean;
  liftingExerciseName?: string;
  hasPriorSet: boolean;
  isSwitching: boolean;
  liveRestSec: number;
  liveLiftSec: number;
  busy: boolean;
  onWeightChange: (v: string) => void;
  onRepsChange: (v: string) => void;
  onStartLift: () => void;
  onCancelLift: () => void;
  onFinishSet: () => void;
  onJumpToLifting?: () => void;
  onEditSet: (id: number, weight: number, reps: number) => Promise<void>;
  onDeleteSet: (id: number) => Promise<void>;
}) {
  const [adjustOpen, setAdjustOpen] = useState<'weight' | 'reps' | null>(null);
  const [editing, setEditing] = useState<{ id: number; weight: string; reps: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const lapsRef = useRef<HTMLOListElement | null>(null);

  const weightNum = Number(weight) || 0;
  const repsNum = Number(reps) || 10;
  // 超过 1 小时静默归零待命，避免隔夜未结束训练挂着十几个小时的大数字
  const isRestingNow = !isLiftingThis && !isLiftingOther && hasPriorSet && liveRestSec < STALE_REST_SEC;
  const phase: RestPhase = isLiftingThis
    ? 'lifting'
    : isRestingNow
      ? restPhase(liveRestSec, block.restSec, true)
      : 'idle';
  const clockText = isLiftingThis
    ? formatClock(liveLiftSec)
    : isRestingNow
      ? formatClock(liveRestSec)
      : '00:00';
  const restPct = isRestingNow
    ? Math.min(100, Math.round((liveRestSec / Math.max(15, block.restSec)) * 100))
    : 0;

  useEffect(() => {
    const el = lapsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [block.segments.length, isLiftingThis, isRestingNow]);

  function stepWeight(delta: number) {
    haptic(5);
    playStepTick();
    onWeightChange(String(Math.max(0, Math.min(500, +(weightNum + delta).toFixed(2)))));
  }
  function stepReps(delta: number) {
    haptic(5);
    playStepTick();
    onRepsChange(String(Math.max(1, repsNum + delta)));
  }

  async function submitEdit() {
    if (!editing || editBusy) return;
    const w = Number(editing.weight);
    const r = Number(editing.reps);
    if (!Number.isFinite(w) || w < 0 || w > 1000 || !Number.isInteger(r) || r < 1 || r > 1000) return;
    setEditBusy(true);
    try {
      await onEditSet(editing.id, w, r);
      setEditing(null);
    } finally {
      setEditBusy(false);
    }
  }

  async function submitDelete(s: SetRow) {
    if (editBusy) return;
    setEditBusy(true);
    try {
      await onDeleteSet(s.id);
      setEditing(null);
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div className="wt-active is-apple-stage">
      <div className="wt-hero" data-phase={phase}>
        {media?.image || (media?.hasSculpture && media.mp4Url) || media?.hasAnimation ? (
          <div className="rn-min-bg wt-bg is-sculptural" aria-hidden="true">
            {media?.image ? (
              <HalftoneImage key={block.exerciseId} src={media.image} cell={2.4} variant="sculpture" className="wt-sculpture-halftone" />
            ) : media?.hasSculpture && media.mp4Url ? (
              <video key={block.exerciseId} className="rn-min-bg-video" src={media.mp4Url} poster={media.image} autoPlay loop muted playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={block.exerciseId} className="rn-min-bg-gif" src={`/api/gif/${block.exerciseId}`} alt="" />
            )}
          </div>
        ) : null}
        <div className="rn-min-timer-wrap">
          <b className="wt-clock" role="timer" aria-live="off">{clockText}</b>
          <i className="rn-min-dot" aria-hidden="true" />
        </div>
        {isRestingNow && (
          <div className="wt-rest-track" aria-hidden="true">
            <span style={{ width: `${restPct}%` }} />
          </div>
        )}
        <div className="wt-center-readout">
          <span className="wt-set-pill">第 {nextSetNumber} 组</span>
          <span className="wt-mid-dot" aria-hidden="true">·</span>
          <button type="button" className="wt-val-btn" data-open={adjustOpen === 'weight' || undefined} onClick={() => setAdjustOpen((v) => (v === 'weight' ? null : 'weight'))}>
            <b>{weightNum > 0 ? weight : '自重'}</b>
            {weightNum > 0 && <em>kg</em>}
          </button>
          <span className="wt-val-x" aria-hidden="true">×</span>
          <button type="button" className="wt-val-btn" data-open={adjustOpen === 'reps' || undefined} onClick={() => setAdjustOpen((v) => (v === 'reps' ? null : 'reps'))}>
            <b>{reps}</b>
            <em>次</em>
          </button>
        </div>
        <div className="wt-center-cta">
          {isLiftingThis ? (
            <>
              <button type="button" className="wt-action-pill is-lifting" disabled={busy} onClick={() => { setAdjustOpen(null); onFinishSet(); }}>
                {busy ? <span className="rn-check-spin" aria-hidden="true" /> : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                )}
                <span>完成第 {nextSetNumber} 组</span>
              </button>
              <button type="button" className="wt-side-ghost" onClick={onCancelLift}>取消</button>
            </>
          ) : isLiftingOther ? (
            <button type="button" className="wt-action-pill is-return" onClick={onJumpToLifting}>
              <i className="rn-min-now-dot" aria-hidden="true" />
              <span>正在练 {liftingExerciseName || '其他动作'} {formatClock(liveLiftSec)}</span>
            </button>
          ) : (
            <>
              <button type="button" className="wt-action-pill is-start" disabled={busy} onClick={() => { setAdjustOpen(null); onStartLift(); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5Z" /></svg>
                <span>开始第 {nextSetNumber} 组</span>
              </button>
              <button type="button" className="wt-side-ghost" disabled={busy} onClick={() => { setAdjustOpen(null); onFinishSet(); }}>直接记</button>
            </>
          )}
        </div>
      </div>

      {adjustOpen && (
        <div className="rn-min-adjust wt-adjust">
          {adjustOpen === 'weight' ? (
            <>
              <button type="button" onClick={() => stepWeight(-2.5)}>−2.5</button>
              <input type="number" inputMode="decimal" step="0.5" min="0" aria-label="重量" value={weight} onChange={(e) => onWeightChange(e.target.value)} />
              <button type="button" onClick={() => stepWeight(2.5)}>+2.5</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => stepReps(-1)}>−1</button>
              <input type="number" inputMode="numeric" step="1" min="1" aria-label="次数" value={reps} onChange={(e) => onRepsChange(e.target.value)} />
              <button type="button" onClick={() => stepReps(1)}>+1</button>
            </>
          )}
          <button type="button" className="is-done" onClick={() => setAdjustOpen(null)}>好</button>
        </div>
      )}

      {(block.segments.length > 0 || isLiftingThis || isRestingNow) && (
        <ol ref={lapsRef} className="wt-segs is-apple-laps">
          {block.segments.map((seg) =>
            seg.kind === 'rest' ? (
              <li key={seg.key} className="wt-lap-rest" data-phase={seg.phase}>
                <span>休息</span>
                <small>{formatClock(seg.durationSec)}</small>
              </li>
            ) : (
              <Fragment key={seg.set.id}>
                <li className="wt-seg-lift" data-best={seg.isBest || undefined}>
                  <button
                    type="button"
                    className="wt-seg-row is-3col"
                    onClick={() => setEditing((cur) => (cur?.id === seg.set.id ? null : { id: seg.set.id, weight: String(seg.set.weight), reps: String(seg.set.reps) }))}
                  >
                    <span className="wt-seg-idx">第 {seg.setIndex} 组</span>
                    <b className="wt-lap-mid">{seg.set.weight > 0 ? `${seg.set.weight} kg × ${seg.set.reps} 次` : `自重 × ${seg.set.reps} 次`}</b>
                    <small className="wt-lap-dur">{seg.durationSec > 0 ? `力训 ${formatClock(seg.durationSec)}` : '—'}</small>
                  </button>
                  {editing?.id === seg.set.id && (
                    <div className="rn-edit-inline rn-min-edit">
                      <label><input type="number" inputMode="decimal" step="0.5" min="0" aria-label="重量" value={editing.weight} onChange={(e) => setEditing({ ...editing, weight: e.target.value })} /><em>kg</em></label>
                      <label><input type="number" inputMode="numeric" step="1" min="1" aria-label="次数" value={editing.reps} onChange={(e) => setEditing({ ...editing, reps: e.target.value })} /><em>次</em></label>
                      <button type="button" className="rn-edit-save" disabled={editBusy} onClick={() => void submitEdit()}>保存</button>
                      <button type="button" className="rn-min-del" disabled={editBusy} onClick={() => void submitDelete(seg.set)}>删除</button>
                      <button type="button" className="rn-edit-cancel" onClick={() => setEditing(null)}>取消</button>
                    </div>
                  )}
                </li>
              </Fragment>
            ),
          )}
          {isLiftingThis && (
            <li className="wt-seg-lift is-live">
              <div className="wt-seg-row is-3col">
                <span className="wt-seg-idx"><i className="rn-min-now-dot" aria-hidden="true" />第 {nextSetNumber} 组</span>
                <b className="wt-lap-mid">{weightNum > 0 ? `${weight} kg × ${reps} 次` : `自重 × ${reps} 次`}</b>
                <small className="wt-lap-dur is-live">力训 {formatClock(liveLiftSec)}</small>
              </div>
            </li>
          )}
          {isRestingNow && (
            <li className="wt-lap-rest is-live" data-phase={phase}>
              <span><i className="wt-rest-live-dot" aria-hidden="true" />{isSwitching ? '换项休息' : '休息中'}</span>
              <small>{formatClock(liveRestSec)}</small>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
