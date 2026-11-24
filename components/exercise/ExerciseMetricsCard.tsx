import { formatExerciseMetrics, type ExerciseMetricInput } from '@/lib/exercise-metrics';

export default function ExerciseMetricsCard({
  exercise,
  compact = false,
}: {
  exercise: ExerciseMetricInput;
  compact?: boolean;
}) {
  const m = formatExerciseMetrics(exercise);

  return (
    <section className={`ex-card${compact ? ' is-compact' : ''}`} aria-label="训练参考指标">
      <div className="ex-card-hd">
        <h2>训练参考</h2>
        <span>{m.patternLabel}</span>
      </div>

      <div className="ex-readouts">
        <div className="ex-ro">
          <span className="ex-ro-lbl">建议次数</span>
          <strong className={m.repIsDuration ? 'is-text' : undefined}>
            {m.repRange}
            {!m.repIsDuration && <small>次/组</small>}
          </strong>
          <em>{m.repCaption}</em>
        </div>
        <div className="ex-ro">
          <span className="ex-ro-lbl">建议间歇</span>
          <strong>
            {m.restRange}
            <small>秒</small>
          </strong>
          <em>{m.restCaption}</em>
        </div>
        <div className="ex-ro">
          <span className="ex-ro-lbl">动作机制</span>
          <strong className="is-text">{m.mechanicLabel}</strong>
          <em>{m.mechanicSub}</em>
        </div>
      </div>

      <div className="ex-muscle-bar">
        <span className="ex-m-chip pri">
          <i aria-hidden="true" />
          主练 · {m.primaryMuscle}
        </span>
        {m.secondaryMuscles.map((sec) => (
          <span key={sec} className="ex-m-chip sec">
            协同 · {sec}
          </span>
        ))}
      </div>

      {!compact && (
        <>
          <div className="ex-meters">
            <div className="ex-meter-row">
              <span>体能消耗</span>
              <div className="ex-ticks coral" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((i) => (
                  <i key={i} className={i <= m.demand.level ? 'on' : undefined} />
                ))}
              </div>
              <b>{m.demand.label}</b>
            </div>
            <div className="ex-meter-row">
              <span>恢复负担</span>
              <div className="ex-ticks" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((i) => (
                  <i key={i} className={i <= m.fatigue.level ? 'on' : undefined} />
                ))}
              </div>
              <b>{m.fatigue.label}</b>
            </div>
          </div>
          <p className="ex-note-foot">
            参考强度 MET {m.metRange}，实际消耗因体重、负荷与组间歇而异。
          </p>
        </>
      )}
    </section>
  );
}
