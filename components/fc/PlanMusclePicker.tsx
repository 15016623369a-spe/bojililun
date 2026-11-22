import { useRef } from 'react';
import { muscleById, REGIONS, type MuscleId } from '@/lib/muscles';
import { SCULPTURE_GROUPS } from '@/lib/sculpture-groups';

const sections = REGIONS.map((region) => ({
  region,
  groups: SCULPTURE_GROUPS.filter(({ id }) => muscleById(id)?.region === region),
})).filter(({ groups }) => groups.length > 0);

export default function PlanMusclePicker({ onPick }: {
  onPick: (id: MuscleId, trigger: HTMLButtonElement | null) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  return <div className="plan-picker-row">
    <button ref={trigger} type="button" className="plan-muscle-picker" aria-haspopup="dialog"
      onClick={() => dialog.current?.showModal()}>
      按名称选肌群 <span aria-hidden="true">›</span>
    </button>
    <dialog ref={dialog} className="plan-muscle-dialog" aria-labelledby="plan-muscle-title"
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="plan-muscle-panel">
        <header className="plan-muscle-head">
          <h2 id="plan-muscle-title">选肌群</h2>
          <button type="button" className="fc-dict-close" onClick={() => dialog.current?.close()}>关闭</button>
        </header>
        <div className="plan-muscle-list">
          {sections.map(({ region, groups }) => <section key={region}>
            <h3>{region}</h3>
            <div className="plan-muscle-options">
              {groups.map(({ id, label }) => <button key={id} type="button" onClick={() => {
                dialog.current?.close();
                onPick(id, trigger.current);
              }}>{label}</button>)}
            </div>
          </section>)}
        </div>
      </div>
    </dialog>
  </div>;
}
