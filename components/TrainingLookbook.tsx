'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { humanDate } from '@/lib/date';
import { idsForTarget } from '@/lib/energy';
import type { MuscleId } from '@/lib/muscles';
import { PLAN_POSES, planPoseFor, type PlanPose } from '@/lib/plan-poses';
import { sculptureGroup, type SculptureVariant } from '@/lib/sculpture-groups';
import type { PlanItem, SetRow } from '@/lib/types';
import SculptureBody from './fc/SculptureBody';
import Icon from './ui/Icon';

type TrainingDay = { date: string; focus: string; recorded: boolean };
type LookbookAction = Pick<PlanItem, 'exercise_id' | 'name' | 'target' | 'sets' | 'reps' | 'weight'>;
type LookbookSet = Pick<SetRow, 'exercise_id' | 'exercise_name' | 'target'>;

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const REGIONS = Object.keys(PLAN_POSES) as PlanPose[];

function targetsRegion(target: string, region: PlanPose) {
  return idsForTarget(target).some((muscle) => planPoseFor(muscle) === region);
}

export default function TrainingLookbook({ days, today, date, focus, status, planned, recorded, variant, actions, sets }: {
  days: TrainingDay[];
  today: string;
  date: string;
  focus: string;
  status: string;
  planned: MuscleId[];
  recorded: MuscleId[];
  variant: SculptureVariant;
  actions: LookbookAction[];
  sets: LookbookSet[];
}) {
  const muscles = [...planned, ...recorded];
  const first = muscles.find((id) => sculptureGroup(id));
  const [side, setSide] = useState<'front' | 'back'>(sculptureGroup(first)?.side === 'back' ? 'back' : 'front');
  const [picked, setPicked] = useState<MuscleId | null>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const region = picked ? planPoseFor(picked) : null;
  const mapped = new Map<PlanPose, MuscleId>();
  for (const muscle of muscles) {
    const area = planPoseFor(muscle);
    if (!mapped.has(area)) mapped.set(area, muscle);
  }

  function openRegion(muscle: MuscleId) {
    setPicked(muscle);
    drawer.current?.showModal();
  }

  const rows = new Map<string, { id: string; name: string; plan?: LookbookAction; count: number }>();
  if (region) {
    for (const action of actions.filter(({ target }) => targetsRegion(target, region))) {
      rows.set(action.exercise_id, { id: action.exercise_id, name: action.name, plan: action, count: 0 });
    }
    for (const set of sets.filter(({ target }) => targetsRegion(target, region))) {
      const row = rows.get(set.exercise_id);
      if (row) row.count += 1;
      else rows.set(set.exercise_id, { id: set.exercise_id, name: set.exercise_name, count: 1 });
    }
  }

  const add = new URLSearchParams();
  if (date !== today) add.set('date', date);
  if (picked) {
    add.set('muscle', picked);
    add.set('library', 'all');
  }

  return <section className="training-lookbook" aria-label="训练画册">
    <header className="lookbook-heading">
      <div>
        <p>{date === today ? '今天' : humanDate(date).split(' ')[1]} <span>{date.slice(5).replace('-', '.')}</span></p>
        <h2>{focus}</h2>
      </div>
      {status && <p className="lookbook-status">{status}</p>}
    </header>

    <div className="lookbook-stage">
      <div className="plan-dots" aria-hidden="true" />
      <SculptureBody variant={variant} side={side} look="halftone" planned={planned} recorded={recorded}
        onPick={openRegion} />
      <button type="button" className="lookbook-turn" onClick={() => setSide(side === 'front' ? 'back' : 'front')}>
        {side === 'front' ? '看背面' : '看正面'}
      </button>
      <p className="lookbook-hint">点肌群查看动作</p>
    </div>

    {mapped.size > 0 && <div className="lookbook-regions" aria-label="当天涉及的肌群" role="group">
      {REGIONS.filter((area) => mapped.has(area)).map((area) => {
        const hasRecorded = recorded.some((muscle) => planPoseFor(muscle) === area);
        const hasPlanned = planned.some((muscle) => planPoseFor(muscle) === area && !recorded.includes(muscle));
        return <button key={area} type="button" onClick={() => openRegion(mapped.get(area)!)} aria-haspopup="dialog"
          aria-label={`${PLAN_POSES[area].label}${hasPlanned ? '，有安排' : ''}${hasRecorded ? '，有实练' : ''}`}>
          {hasPlanned && <i data-state="planned" aria-hidden="true" />}
          {hasRecorded && <i data-state="recorded" aria-hidden="true" />}
          {PLAN_POSES[area].label}
        </button>;
      })}
    </div>}

    <nav className="training-week" aria-label="本周训练">
      {days.map((day, index) => <Link key={day.date}
        href={day.date === today ? '/train' : `/train?date=${day.date}`}
        aria-current={day.date === date ? 'date' : undefined}
        aria-label={`${day.date === today ? '今天，' : ''}${humanDate(day.date)}，${day.focus || '无安排'}${day.recorded ? '，有实练记录' : ''}`}
        data-state={day.recorded ? 'recorded' : day.focus ? 'planned' : undefined}>
        <span>{WEEKDAYS[index]}</span><b>{Number(day.date.slice(-2))}</b><i aria-hidden="true" />
      </Link>)}
    </nav>

    <dialog className="lookbook-drawer" ref={drawer} aria-labelledby="lookbook-drawer-title"
      onClose={() => setPicked(null)} onPointerDown={(event) => { if (event.target === event.currentTarget) drawer.current?.close(); }}>
      {region && <div className="lookbook-drawer-content">
        <header>
          <div>
            <p>{date === today ? '今天' : humanDate(date)} · {rows.size} 个动作</p>
            <h2 id="lookbook-drawer-title">{PLAN_POSES[region].label}</h2>
          </div>
          <button type="button" className="lookbook-close" autoFocus onClick={() => drawer.current?.close()} aria-label="关闭肌群画册">
            <Icon name="close" size={20} />
          </button>
        </header>
        {rows.size > 0 ? <ul className="lookbook-actions">
          {[...rows.values()].map(({ id, name, plan, count }) => <li key={id}>
            <div><b>{name}</b>{plan && <small>计划 {plan.sets} × {plan.reps} · {plan.weight ? `${plan.weight} kg` : '自重'}</small>}</div>
            {count > 0 && <span>已练 {count} 组</span>}
          </li>)}
        </ul> : <p className="lookbook-empty">当天没有安排这个部位</p>}
        {date >= today && <Link href={`/body?${add}`} className="lookbook-add" onClick={() => drawer.current?.close()}>
          添加{PLAN_POSES[region].label}动作 <Icon name="plus" size={18} />
        </Link>}
      </div>}
    </dialog>
  </section>;
}
