import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import { BODY_LABEL } from '@/lib/exercise-label';
import { PERIOD_LABEL, addDays, periodRange, type Period } from '@/lib/period';
import { exerciseStats, muscleStats, todayStr, trendStats, volumeStats } from '@/lib/core/workout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERIODS: Period[] = ['week', 'month', 'quarter', 'year'];

const BIG = ['chest', 'back', 'upper legs'];
const SMALL = ['shoulders', 'upper arms', 'waist', 'lower legs', 'lower arms', 'neck', 'cardio'];

const WEEK_CN = ['一', '二', '三', '四', '五', '六', '日'];

type SP = Promise<{ period?: string }>;

function bucketize(period: Period, start: string, end: string, points: Array<{ date: string; volume: number }>) {
  const byDate = new Map(points.map((p) => [p.date, p.volume]));
  const buckets: Array<{ label: string; volume: number }> = [];

  if (period === 'week') {
    let d = start;
    for (let i = 0; i < 7; i++) {
      buckets.push({ label: WEEK_CN[i], volume: byDate.get(d) ?? 0 });
      d = addDays(d, 1);
    }
    return buckets;
  }

  if (period === 'month') {
    let d = start;
    let i = 1;
    while (d <= end) {
      buckets.push({ label: String(i), volume: byDate.get(d) ?? 0 });
      d = addDays(d, 1);
      i++;
    }
    return buckets;
  }

  if (period === 'quarter') {
    for (let i = 0; i < 3; i++) {
      const prefix = start.slice(0, 7).slice(0, 5) + String(Number(start.slice(5, 7)) + i).padStart(2, '0');
      const volume = points.filter((p) => p.date.startsWith(prefix)).reduce((a, p) => a + p.volume, 0);
      buckets.push({ label: `${Number(prefix.slice(5, 7))}月`, volume });
    }
    return buckets;
  }

  for (let m = 1; m <= 12; m++) {
    const prefix = `${start.slice(0, 4)}-${String(m).padStart(2, '0')}`;
    const volume = points.filter((p) => p.date.startsWith(prefix)).reduce((a, p) => a + p.volume, 0);
    buckets.push({ label: `${m}`, volume });
  }
  return buckets;
}

export default async function StatsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const period: Period = PERIODS.includes(sp.period as Period) ? (sp.period as Period) : 'week';
  const today = todayStr();
  const r = periodRange(period, today);

  const cur = volumeStats(r.start, r.end);
  const prev = volumeStats(r.prevStart, r.prevEnd);
  const muscles = muscleStats(r.start, r.end);
  const exs = exerciseStats(r.start, r.end);
  const trend = trendStats(r.start, r.end);
  const buckets = bucketize(period, r.start, r.end, trend);

  const maxBucket = Math.max(1, ...buckets.map((b) => b.volume));
  const muscleMax = Math.max(1, ...muscles.map((m) => m.volume));
  const muscleMap = new Map(muscles.map((m) => [m.body_part, m]));

  const delta = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const empty = cur.sessions === 0;
  const hasTimedSessions = cur.sessions > cur.quickSessions;

  return (
    <JournalShell active="review" title="训练统计" subtitle={r.start + " — " + r.end} back={{ href: "/history", label: "回顾" }}>
      <div className="journal-utility">
        <div className="seg-tabs">
          {PERIODS.map((p) => (
            <Link key={p} href={`/stats?period=${p}`} className={`seg-tab ${period === p ? 'on' : ''}`}>
              {PERIOD_LABEL[p]}
            </Link>
          ))}
        </div>

        <section className="metric-grid">
          <div className="metric-card">
            <span>训练容量</span>
            <b>
              {cur.volume.toLocaleString('en-US')} <em>kg</em>
            </b>
            <small>{compareText(delta(cur.volume, prev.volume))}</small>
          </div>
          <div className="metric-card">
            <span>训练次数 / 天数</span>
            <b>
              {cur.sessions} 次 · {cur.days} 天
            </b>
            <small>{compareText(delta(cur.sessions, prev.sessions))}</small>
          </div>
          <div className="metric-card">
            <span>训练时长</span>
            <b>
              {hasTimedSessions ? (cur.durationMin === 0 ? '<1' : cur.durationMin) : '—'} {hasTimedSessions && <em>分钟</em>}
            </b>
            <small>{hasTimedSessions ? compareText(delta(cur.durationMin, prev.durationMin)) : '语音记录未填写时长'}</small>
          </div>
          <div className="metric-card">
            <span>完成组数</span>
            <b>
              {cur.sets} <em>组</em>
            </b>
            <small>{compareText(delta(cur.sets, prev.sets))}</small>
          </div>
        </section>

        {empty ? (
          <div className="empty-card">
            <p>这段时间还没有完成的训练。</p>
            <div className="row-btns">
              <Link className="btn primary" href="/train">
                去训练
              </Link>
              <Link className="btn" href="/exercises">
                挑动作
              </Link>
            </div>
          </div>
        ) : (
          <>
            <section className="block">
              <h2 className="block-title">
                肌群训练分布
                <span>容量 / 语音记录</span>
              </h2>
              <div className="muscle-groups">
                <h3>大肌群</h3>
                <div className="muscle-grid">
                  {BIG.map((b) => (
                    <MuscleBar key={b} body={b} stat={muscleMap.get(b)} max={muscleMax} />
                  ))}
                </div>
                <h3>小肌群</h3>
                <div className="muscle-grid">
                  {SMALL.filter((b) => muscleMap.get(b)).map((b) => (
                    <MuscleBar key={b} body={b} stat={muscleMap.get(b)} max={muscleMax} />
                  ))}
                  {!SMALL.some((b) => muscleMap.get(b)) && <p className="hint">还没有小肌群记录</p>}
                </div>
              </div>
            </section>

            <section className="block">
              <h2 className="block-title">
                容量趋势
                <span>kg / {period === 'week' ? '天' : period === 'month' ? '天' : '月'}</span>
              </h2>
              <div className={`bar-chart ${period === 'month' || period === 'year' ? 'dense' : ''}`}>
                {buckets.map((b, i) => (
                  <div className="bc-col" key={i} title={`${b.label}: ${b.volume} kg`}>
                    <div className="bc-bar">
                      <i style={{ height: `${Math.max(2, (b.volume / maxBucket) * 100)}%` }} />
                    </div>
                    <span>{b.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="block">
              <h2 className="block-title">动作表现</h2>
              <div className="perf-list">
                {exs.map((e) => (
                  <div className="perf-row" key={e.exercise_id}>
                    <div>
                      <b>{e.exercise_name}</b>
                      <span>
                        {e.sets} 组 · 最大 {e.best_weight > 0 ? `${e.best_weight} kg` : '自重'} × {e.best_reps}
                      </span>
                    </div>
                    <em>{e.volume.toLocaleString('en-US')} kg</em>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

    </JournalShell>
  );
}

function compareText(pct: number | null): string {
  if (pct === null) return '上期无可比数据';
  if (pct === 0) return '与上期持平';
  return `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% 对比上期`;
}

function MuscleBar({
  body,
  stat,
  max,
}: {
  body: string;
  stat?: { volume: number; sets: number; records: number };
  max: number;
}) {
  const volume = stat?.volume ?? 0;
  const records = stat?.records ?? 0;
  return (
    <div className={`muscle-cell ${volume === 0 && records === 0 ? 'empty' : ''}`}>
      <div className="mc-head">
        <span>{BODY_LABEL[body] ?? body}</span>
        <em>{volume > 0 ? `${Math.round(volume).toLocaleString('en-US')} kg` : records > 0 ? `${records} 次语音记录` : '未训练'}</em>
      </div>
      <div className="bar">
        <i style={{ width: `${volume ? Math.max(6, (volume / max) * 100) : records ? 16 : 0}%` }} />
      </div>
    </div>
  );
}
