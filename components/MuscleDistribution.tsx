'use client';

import { useRef, useState } from 'react';
import type { muscleDistribution } from '@/lib/muscle-distribution';
import { PERIOD_LABEL, type Period } from '@/lib/period';
import JournalIcon from './JournalIcon';

const metrics = {
  sets: { label: '组数对比', unit: '组' },
  volume: { label: '容量对比', unit: 'kg' },
  sessions: { label: '次数对比', unit: '次' },
  seconds: { label: '时长对比', unit: '分钟' },
} as const;

type Metric = keyof typeof metrics;

export default function MuscleDistribution({ cards, period }: {
  cards: ReturnType<typeof muscleDistribution>;
  period: Period;
}) {
  const [metric, setMetric] = useState<Metric>('sets');
  const [selected, setSelected] = useState<{ label: string; key: string }>();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const unit = metrics[metric].unit;
  const format = (value: number) => (metric === 'seconds' ? value / 60 : value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });

  return <details className="muscle-compare-disclosure" ref={disclosure}>
    <summary ref={trigger}>
      <span className="muscle-compare-icon"><JournalIcon name="review" /></span>
      <span className="muscle-compare-label">
        <strong className="muscle-compare-closed">查看肌群对比</strong>
        <strong className="muscle-compare-open">收起肌群对比</strong>
        <small>{PERIOD_LABEL[period]} · {period === 'week' || period === 'month' ? '按天' : '按月'}</small>
      </span>
      <span className="muscle-compare-chevron" aria-hidden="true" />
    </summary>
    <div className="muscle-compare-content">
      <div className="muscle-compare-tabs" role="group" aria-label="对比指标">
        {(Object.keys(metrics) as Metric[]).map((key) => <button key={key} type="button"
          aria-pressed={metric === key} onClick={() => setMetric(key)}>{metrics[key].label}</button>)}
      </div>
      <div className="muscle-compare-grid" data-wide={period === 'month' || period === 'year'}>
        {cards.map(({ label, points }) => {
          const values = points.map((point) => point[metric]);
          const max = Math.max(1, ...values);
          const total = values.reduce((sum, value) => sum + value, 0);
          const active = selected?.label === label ? points.find((point) => point.key === selected.key) : undefined;
          return <article className="muscle-compare-card" key={label}>
            <header>
              <h3>{label}</h3><span>{PERIOD_LABEL[period]} <strong>{format(total)} {unit}</strong></span>
            </header>
            <div className="muscle-compare-bars" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
              role="group" aria-label={`${label}${metrics[metric].label}`}>
              {points.map((point, index) => {
                const value = point[metric];
                const description = `${point.key}，${format(value)} ${unit}`;
                const showTick = period !== 'month' || index === 0 || (index + 1) % 5 === 0;
                return <button type="button" key={point.key} className="muscle-compare-column"
                  aria-label={description} aria-pressed={active?.key === point.key} title={description}
                  onClick={() => setSelected(active?.key === point.key ? undefined : { label, key: point.key })}>
                  <span className="muscle-compare-track" aria-hidden="true">
                    <i style={{ height: value > 0 ? `${Math.max(3, value / max * 100)}%` : '1px' }} />
                  </span>
                  <small aria-hidden="true">{showTick ? point.tick : ' '}</small>
                </button>;
              })}
            </div>
            {active && <p className="muscle-compare-total" role="status">{active.key} · <strong>{format(active[metric])} {unit}</strong></p>}
          </article>;
        })}
      </div>
      <button type="button" className="muscle-compare-collapse" onClick={() => {
        if (disclosure.current) disclosure.current.open = false;
        trigger.current?.focus();
      }}>收起对比</button>
    </div>
  </details>;
}
