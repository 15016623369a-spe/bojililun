'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { mealNutrition, trainingSummary, type JournalEntry } from '@/lib/journal';
import { RecordEditor, deleteEntry } from './RecordCards';
import Icon, { type IconName } from './ui/Icon';

const KIND: Record<JournalEntry['kind'], { label: string; icon: IconName }> = {
  training: { label: '训练', icon: 'dumbbell' },
  meal: { label: '饮食', icon: 'bowl' },
  sleep: { label: '睡眠', icon: 'moon' },
  note: { label: '备注', icon: 'note' },
};

const minuteOf = (time?: string) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function cardText(entry: JournalEntry) {
  const payload = entry.payload;
  if (entry.kind === 'meal') {
    const items = payload?.items ?? [];
    const nutrition = payload ? mealNutrition([{ ...payload, planned: false }]) : undefined;
    const kcal = nutrition?.counted ? `≈ ${nutrition.totals.kcal} kcal` : nutrition?.pending ? '热量待补' : '';
    const amount = items.length === 1 && !/^(未填写|适量)$/.test(items[0].amount) ? items[0].amount : '';
    return {
      main: items.length ? items.slice(0, 2).map((item) => item.name).join(' + ') : entry.detail,
      sub: [entry.title, amount, items.length > 2 ? `另 ${items.length - 2} 样` : '', kcal].filter(Boolean).join(' · '),
    };
  }
  if (entry.kind === 'training') {
    const exercises = payload?.exercises ?? [];
    const first = exercises[0];
    const data = first ? [first.weight, first.sets === undefined ? '' : `${first.sets} 组`, first.reps ? `${first.reps} 次` : '', first.duration]
      .filter(Boolean).join(' × ') : '';
    return {
      main: exercises.map((item) => item.name).join('、') || (payload && trainingSummary(payload)) || entry.detail,
      sub: [data, exercises.length > 1 ? `共 ${exercises.length} 个动作` : '', entry.note].filter(Boolean).join(' · ')
        || entry.meta || (payload?.regions?.length ? `${payload.regions.join('、')}训练` : ''),
    };
  }
  return { main: entry.detail, sub: entry.meta ?? '' };
}

/**
 * 记录页的一天：上方时间刻度标出每条记录的时刻，下方横向卡片按时间排开。
 * 点刻度上的标记会滑到对应卡片，滑动卡片时刻度跟着高亮。
 */
export default function RecordDeck({ entries: given, isToday, freshId, onSaved, onDeleted, emptyHint }: {
  entries: JournalEntry[];
  /** 没有记录时卡片上的说明；不传时提示按住说话 */
  emptyHint?: string;
  isToday: boolean;
  freshId?: string;
  onSaved?: (entry: JournalEntry) => void;
  onDeleted?: (entry: JournalEntry) => void;
}) {
  const router = useRouter();
  // 卡片和刻度都按一天里的先后排，没有时间的放最后
  const entries = given.map((entry, index) => ({ entry, index, at: minuteOf(entry.time) ?? 24 * 60 + 1 }))
    .sort((a, b) => a.at - b.at || a.index - b.index).map(({ entry }) => entry);
  const deck = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [active, setActive] = useState(Math.max(0, entries.length - 1));
  const [openId, setOpenId] = useState<string>();
  const [error, setError] = useState('');
  const [now, setNow] = useState<number | null>(null);
  const open = entries.find((entry) => entry.id === openId);

  const times = entries.map((entry) => minuteOf(entry.time));
  const known = times.filter((value): value is number => value !== null);
  const start = Math.max(0, Math.min(8 * 60, Math.floor((Math.min(...known, 24 * 60) - 60) / 120) * 120));
  const end = Math.min(24 * 60, Math.max(20 * 60, Math.ceil((Math.max(...known, now ?? 0) + 60) / 120) * 120));
  const span = end - start;
  const ticks = span / 10 + 1;
  const labels = Array.from({ length: Math.floor(span / 240) + 1 }, (_, i) => start + i * 240);

  // 只在浏览器里取当前时间，避免服务端与客户端渲染不一致
  useEffect(() => {
    if (!isToday) return;
    const tick = () => { const d = new Date(); setNow(d.getHours() * 60 + d.getMinutes()); };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [isToday]);

  // 打开时停在最新一条
  useEffect(() => {
    const el = deck.current;
    const last = el?.querySelectorAll<HTMLElement>('.deck-card')[entries.length - 1];
    if (el && last) el.scrollLeft = last.offsetLeft - el.offsetLeft - 24;
    setActive(Math.max(0, entries.length - 1));
  }, [entries.length]);

  // 新记录出现时滑到它
  useEffect(() => {
    if (!freshId) return;
    const index = entries.findIndex((entry) => entry.id === freshId);
    if (index >= 0) go(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshId]);

  function go(index: number) {
    const el = deck.current;
    const card = el?.querySelectorAll<HTMLElement>('.deck-card')[index];
    if (!el || !card) return;
    setActive(index);
    el.scrollTo({ left: card.offsetLeft - el.offsetLeft - 24, behavior: 'smooth' });
  }

  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = deck.current;
      if (!el) return;
      const cards = [...el.querySelectorAll<HTMLElement>('.deck-card')];
      const left = el.scrollLeft + 24;
      let best = 0;
      cards.forEach((card, i) => { if (Math.abs(card.offsetLeft - el.offsetLeft - left) < Math.abs(cards[best].offsetLeft - el.offsetLeft - left)) best = i; });
      // 滑到最右端时，最后一张也算选中
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4) best = cards.length - 1;
      setActive((current) => (current === best ? current : best));
    });
  }

  async function undo(entry: JournalEntry) {
    try {
      await deleteEntry(entry);
      onDeleted?.(entry);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return <section className="day-deck" aria-label={isToday ? '今天的记录' : '当天的记录'}>
    <div className="day-ruler">
      <div className="day-ruler-ticks" aria-hidden="true">
        {Array.from({ length: ticks }, (_, i) => <i key={i} className={i % 6 === 0 ? 'hour' : undefined} />)}
      </div>
      {entries.map((entry, i) => {
        const at = times[i];
        if (at === null) return null;
        return <button key={entry.id} type="button" className={`day-mark ${entry.kind}`} data-active={i === active || undefined}
          style={{ left: `${((at - start) / span * 100).toFixed(2)}%` }}
          aria-label={`${entry.time} ${KIND[entry.kind].label}`} onClick={() => go(i)} />;
      })}
      {now !== null && now >= start && now <= end && <span className="day-now" aria-hidden="true"
        style={{ left: `${((now - start) / span * 100).toFixed(2)}%` }} />}
    </div>
    <div className="day-ruler-axis" aria-hidden="true">
      {labels.map((minutes) => <span key={minutes} style={{ left: `${((minutes - start) / span * 100).toFixed(2)}%` }}>{hhmm(minutes)}</span>)}
    </div>

    {error && <p className="form-err" role="alert">{error}</p>}

    <div className="deck" ref={deck} onScroll={onScroll}>
      {entries.length === 0 && <div className="deck-card empty">
        <span className="deck-kind"><Icon name={emptyHint ? 'note' : 'mic'} size={17} />{emptyHint ? '空白的一天' : '开始记录'}</span>
        <b className="big-num">--:--</b>
        <strong>{emptyHint ?? '今天还没有记录'}</strong>
        {!emptyHint && <small>按住下方说话，比如「午饭牛肉面加一个卤蛋」</small>}
      </div>}
      {entries.map((entry, i) => {
        const text = cardText(entry);
        const fresh = entry.id === freshId;
        return <article key={entry.id} className={`deck-card ${entry.kind}`} data-active={i === active || undefined} data-fresh={fresh || undefined}>
          <button type="button" className="deck-card-body" aria-haspopup="dialog" onClick={() => { setError(''); setOpenId(entry.id); }}>
            <span className="deck-kind"><Icon name={KIND[entry.kind].icon} size={17} />{KIND[entry.kind].label}
              {entry.payload?.planned && <em>计划</em>}</span>
            <b className="big-num">{entry.time || '--:--'}</b>
            <strong>{text.main}</strong>
            {text.sub && <small>{text.sub}</small>}
          </button>
          {fresh && <div className="deck-fresh">
            <button type="button" className="chip" onClick={() => setOpenId(entry.id)}><Icon name="edit" size={14} />编辑</button>
            <button type="button" className="chip" onClick={() => void undo(entry)}>撤销</button>
          </div>}
        </article>;
      })}
      <span className="deck-tail" aria-hidden="true" />
    </div>

    {entries.length > 1 && <div className="deck-dots" aria-hidden="true">
      {entries.map((entry, i) => <i key={entry.id} data-active={i === active || undefined} />)}
    </div>}

    {open && <RecordEditor key={open.id} entry={open} onClose={() => setOpenId(undefined)} onSaved={onSaved}
      onDelete={async () => { await deleteEntry(open); onDeleted?.(open); router.refresh(); }} />}
  </section>;
}
