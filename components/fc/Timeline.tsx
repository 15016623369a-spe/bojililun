'use client';

import Link from 'next/link';
import type { TimelineEntry } from '@/lib/types';
import { CheckIcon, DumbbellIcon, MealIcon } from './icons';

function Row({ e }: { e: TimelineEntry }) {
  if (e.kind === 'meal') {
    return (
      <div className="fc-row">
        <i className="fc-dot meal" />
        <div className="fc-head">
          <span className="ico" style={{ color: 'var(--orange)' }}>
            <MealIcon />
          </span>
          <span>{e.label}</span>
        </div>
        <div className="fc-title">{e.title}</div>
        {e.meta ? <div className="fc-meta">{e.meta}</div> : null}
        {e.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="fc-row-photo" src={e.photo} alt={e.title} loading="lazy" />
        )}
      </div>
    );
  }

  return (
    <Link href={`/log/training/${e.id}`} className="fc-row">
      <i className="fc-dot" />
      <div className="fc-head">
        <span className="ico" style={{ color: 'var(--green)' }}>
          <DumbbellIcon />
        </span>
        <span className="t">{e.time}</span>
        <span className="sep">·</span>
        <span>{e.label}</span>
      </div>
      <div className="fc-title">{e.title}</div>
      {e.exercises.length > 0 && <div className="fc-meta">{e.exercises.join('、')}</div>}
      <div className="fc-meta">{e.minutes > 0 ? `共 ${e.minutes} 分钟` : '还没结束'}</div>
      {e.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="fc-row-photo" src={e.photo} alt={e.title} loading="lazy" />
      )}
    </Link>
  );
}

/** 刚记完的那一条：绿色确认卡，编辑 / 撤销 */
function ConfirmCard({ e, onEdit, onUndo }: { e: TimelineEntry; onEdit: () => void; onUndo: () => void }) {
  return (
    <div className="fc-row card-row">
      <i className={`fc-dot${e.kind === 'meal' ? ' meal' : ''}`} />
      <div className="fc-card">
        <Link href={e.kind === 'training' ? `/log/training/${e.id}` : '/log'} className="fc-card-main">
          <div className="fc-card-hd">
            <span className="fc-check">
              <CheckIcon />
            </span>
            已记录
          </div>
          <div className="fc-card-title">{e.title}</div>
          {e.kind === 'training' ? (
            <>
              {e.exercises.length > 0 && <div className="fc-card-meta">{e.exercises.join('、')}</div>}
              <div className="fc-card-meta">共 {e.minutes} 分钟</div>
            </>
          ) : (
            e.meta && <div className="fc-card-meta">{e.meta}</div>
          )}
          {e.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="fc-card-photo" src={e.photo} alt={e.title} loading="lazy" />
          )}
        </Link>
        <div className="fc-card-foot">
          <button type="button" onClick={onEdit}>
            编辑
          </button>
          <button type="button" onClick={onUndo}>
            撤销
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Timeline({
  entries,
  pending,
  onEdit,
  onUndo,
}: {
  entries: TimelineEntry[];
  pending?: TimelineEntry | null;
  onEdit?: () => void;
  onUndo?: () => void;
}) {
  if (entries.length === 0 && !pending) {
    return (
      <div className="fc-empty">
        <b>今天还没有记录。</b>
        <br />
        按住下面的按钮，说一句「刚做了 20 分钟高位下拉和划船」就好。
      </div>
    );
  }

  const items: Array<{ key: string; e: TimelineEntry; isPending: boolean }> = entries.map((e) => ({
    key: `${e.kind}-${e.id}`,
    e,
    isPending: false,
  }));

  if (pending) {
    const at = items.findIndex((x) => x.e.time > pending.time);
    items.splice(at === -1 ? items.length : at, 0, { key: `pending-${pending.kind}-${pending.id}`, e: pending, isPending: true });
  }

  return (
    <div className="fc-tl">
      {items.map((x) =>
        x.isPending && onEdit && onUndo ? (
          <ConfirmCard key={x.key} e={x.e} onEdit={onEdit} onUndo={onUndo} />
        ) : (
          <Row key={x.key} e={x.e} />
        ),
      )}
    </div>
  );
}
