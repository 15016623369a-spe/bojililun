'use client';

import { useState } from 'react';
import Icon from './Icon';

export default function Stepper({ label, value, unit, step, min, max, onChange, readout = false, aside, disabled = false }: {
  label: string;
  value: number;
  unit: string;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  readout?: boolean;
  aside?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function adjust(next: number) {
    const bounded = Math.min(max, Math.max(min, +next.toFixed(6)));
    if (bounded !== value) onChange(bounded);
  }

  function commit(input: string) {
    const numeric = input.trim().replace(',', '.');
    if (/^\d+(?:\.\d*)?$|^\.\d+$/.test(numeric)) {
      const value = Number(numeric);
      if (Number.isFinite(value)) onChange(Math.min(max, Math.max(min, Number.isInteger(step) ? Math.round(value) : value)));
    }
    setDraft(null);
  }

  const [int, decimal] = String(value).split('.');
  return <div className={readout ? 'stepper stepper-readout' : 'stepper'}>
    <div className="stepper-head"><span className="stepper-label">{label}</span>{aside && <small>{aside}</small>}</div>
    <div className="stepper-body">
      <button className="stepper-adjust" type="button" aria-label={`减少${label}`} onClick={() => adjust(value - step)} disabled={disabled || value <= min}>
        <Icon name="minus" size={18} />
      </button>
      <div className="stepper-value">
        {draft === null ? <button type="button" className="stepper-number" aria-label={`${label} ${value} ${unit}，点按输入`}
          disabled={disabled} onClick={() => setDraft(String(value))}>
          {int}{decimal && <span className="dim">.{decimal}</span>}
        </button> : <input className="stepper-number" type="text" autoFocus
          inputMode={Number.isInteger(step) ? 'numeric' : 'decimal'} aria-label={`输入${label}`}
          value={draft} onChange={(event) => setDraft(event.target.value)} onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => commit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
          }} />}
        <em>{unit}</em>
      </div>
      <button className="stepper-adjust" type="button" aria-label={`增加${label}`} onClick={() => adjust(value + step)} disabled={disabled || value >= max}>
        <Icon name="plus" size={18} />
      </button>
    </div>
  </div>;
}
