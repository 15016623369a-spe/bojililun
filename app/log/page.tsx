import type { Metadata } from 'next';
import JournalShell from '@/components/JournalShell';
import LedgerDeck, { type DeckItem } from '@/components/LedgerDeck';
import LogScreen from '@/components/fc/LogScreen';
import RecordHeadButtons from '@/components/fc/RecordHeadButtons';
import CoachPreview from '@/components/fc/CoachPreview';
import BigDate, { weekdayOf } from '@/components/ui/BigDate';
import { getDb } from '@/lib/db';
import { exportJournal } from '@/lib/export';
import { readCardPick } from '@/lib/ledger';
import { calcMealTotals, formatDisplayKcal } from '@/lib/calculations';
import type { Card } from '@/lib/export';
import { todayStr } from '@/lib/log';
import { validDate } from '@/lib/period';
import { readBackdrop } from '@/lib/core/backdrop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '今天 · FitCheck',
};

const TZ = process.env.APP_TZ || 'Asia/Shanghai';
const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const minutesOf = (iso: string) => {
  const [h, m] = clock.format(new Date(iso)).split(':').map(Number);
  return h * 60 + m;
};

/** 训练卡副标题：动作数 · 组数 · 容量（只算有重量和次数的组） */
function workoutLine(c: Card) {
  const sets = c.exercises.flatMap((m) => m.sets);
  const volume = sets.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
  return [c.exercises.map((m) => m.exercise_name).join('、'), sets.length ? `${sets.length} 组` : '组数待补', volume ? `${Math.round(volume).toLocaleString('zh-CN')} kg` : '']
    .filter(Boolean).join(' · ');
}

/** 记录：数据、计算与录入沿用手账（exportJournal / LedgerCards / LogScreen），版式用新版的大号日期、时间刻度和横向卡片。 */
export default async function LogPage({ searchParams }: { searchParams: Promise<{ date?: string; card?: string }> }) {
  const sp = await searchParams;
  const now = todayStr();
  // 月历点进来的某一天：同样的版式，只读那天的手账；没有录入栏
  const past = validDate(sp.date) && sp.date < now ? sp.date : null;
  const today = past ?? now;
  const db = getDb();
  const day = exportJournal(db, 'local', today, today).days[0];
  const selectedCard = day.entries.find(card => String(card.id) === sp.card)?.id;
  const picks = Object.fromEntries(day.entries.map((c) => [c.id, readCardPick(db, 'local', c.id)]));

  const items: DeckItem[] = [
    ...day.entries.map((c): DeckItem => {
      const sub = c.entry_type === 'meal'
        ? [formatDisplayKcal(calcMealTotals(c.items).kcal), c.items.length > 1 ? `${c.items.length} 样` : c.items[0]?.portion_text ?? ''].filter(Boolean).join(' · ')
        : c.entry_type === 'workout'
          ? workoutLine(c)
          : c.note ?? '';
      return {
        key: `card-${c.id}`, cardId: c.id, kind: c.entry_type, time: clock.format(new Date(c.logged_at)), minutes: minutesOf(c.logged_at),
        title: c.summary_title, sub, pending: Boolean(picks[c.id]),
      };
    }),
    ...day.body_metrics.map((m, i): DeckItem => ({
      key: `metric-${i}-${m.logged_at}`, kind: 'body_metrics', time: clock.format(new Date(m.logged_at)), minutes: minutesOf(m.logged_at),
      title: `${m.weight_kg} kg`, sub: m.note || '体重记录', pending: false,
    })),
  ].sort((a, b) => a.minutes - b.minutes);

  const meals = day.entries.filter((c) => c.entry_type === 'meal').length;
  const workouts = day.entries.filter((c) => c.entry_type === 'workout').length;
  const kcal = day.daily_summary.intake.kcal ?? 0;
  const backdrop = await readBackdrop();

  return (
    <JournalShell active="record" title={past ? '当天记录' : '今天'} today={now} className={`is-record is-ledger${past ? ' is-past' : ''}`} hideNav={!past} backdrop={backdrop}
      back={past ? { href: `/history/calendar?date=${past}`, label: '月历' } : undefined}
      headerAction={past ? <div className="journal-head-actions"><span className="journal-head-label">记录</span></div> : <RecordHeadButtons />}
      hero={past ? <BigDate date={today} note={`${meals} 餐 · ${workouts} 次训练`}>
        {kcal > 0 && <small className="hero-kcal"><b>{Math.round(kcal).toLocaleString('zh-CN')}</b> kcal 摄入</small>}
      </BigDate> : <div className="record-hero">
        {/* 今天：大标题加一行小字，不再叠一个超大日期（11 月 24 日用户觉得原版式太满） */}
        <p className="hero-word">今天</p>
        <p className="record-hero-sub">{Number(today.slice(5, 7))} 月 {Number(today.slice(8))} 日 {weekdayOf(today)}
          {items.length > 0 && <> · {meals} 餐 · {workouts} 次训练{kcal > 0 && <> · <b>{Math.round(kcal).toLocaleString('zh-CN')}</b> kcal</>}</>}</p>
      </div>}>
      {/* 我的教练：和记录分开的入口，需要时点开 */}
      {!past && <CoachPreview entry="tile" />}
      <div id="record-recovery-slot" />
      <LedgerDeck key={`${today}:${selectedCard ?? ''}`} items={items} cards={day.entries} picks={picks}
        past={Boolean(past)} selectedCard={selectedCard} />
      {/* 录入面板、拍照和底部导航沿用手账的 LogScreen（打字、拍照在右上角，语音是底部导航中间的话筒）；空状态由上面的卡片承担。回看某一天时不显示录入 */}
      {!past && <div className="fc ledger-dock-scope">
        <LogScreen ledgerHasRecords empty={items.length === 0} />
      </div>}
    </JournalShell>
  );
}
