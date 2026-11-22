'use client';

function haptic(ms = 6) { try { navigator.vibrate?.(ms); } catch { /* iOS 网页无振动 */ } }

/** 圆钮步进器：± 按步长调整，中间数字可直接输入。今日计划与加练共用。 */
export default function Stepper({ label, value, unit, step, min, max, onChange }: {
  label: string; value: number; unit: string; step: number; min: number; max: number; onChange: (value: number) => void;
}) {
  const set = (next: number) => { const v = Math.min(max, Math.max(min, +next.toFixed(2))); if (v !== value) { haptic(); onChange(v); } };
  return <div className="stepper">
    <span className="stepper-label">{label}</span>
    <div className="stepper-body">
      <button type="button" aria-label={`减少${label}`} onClick={() => set(value - step)} disabled={value <= min}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
      </button>
      <label className="stepper-value">
        <input type="number" inputMode="decimal" value={value} min={min} max={max} step={step} aria-label={label}
          onChange={(event) => { const v = Number(event.target.value); if (Number.isFinite(v)) onChange(v); }} />
        <em>{unit}</em>
      </label>
      <button type="button" aria-label={`增加${label}`} onClick={() => set(value + step)} disabled={value >= max}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
      </button>
    </div>
  </div>;
}
