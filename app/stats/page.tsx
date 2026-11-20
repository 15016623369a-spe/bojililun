import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import { muscleDistribution } from '@/lib/muscle-distribution';
import MuscleDistribution from '@/components/MuscleDistribution';
import { PERIOD_LABEL, addDays, periodRange, type Period } from '@/lib/period';
import { exercisePerformance, primaryMuscleActivity, todayStr, trainingTimeByDate, trendStats, volumeStats } from '@/lib/core/workout';
import type { MuscleId } from '@/lib/muscles';
import ExercisePerformance from '@/components/ExercisePerformance';
import StatsBodyMap from '@/components/StatsBodyMap';
import { getProfileRow } from '@/lib/core/meals';
import { sculptureVariant } from '@/lib/sculpture-groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERIODS: Period[] = ['week', 'month', 'quarter', 'year'];

const WEEK_CN = ['一', '二', '三', '四', '五', '六', '日'];

type SP = Promise<{ period?: string }>;

function bucketize(period: Period, start: string, end: string, values: ReadonlyMap<string, number>) {
  const buckets: { label: string; value: number }[] = [];
  if (period === 'week' || period === 'month') {
    for (let date = start, i = 0; date <= end; date = addDays(date, 1), i++) {
      buckets.push({ label: period === 'week' ? WEEK_CN[i] : String(i + 1), value: values.get(date) ?? 0 });
    }
    return buckets;
  }

  const byMonth = new Map<string, number>();
  for (const [date, value] of values) {
    const month = date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + value);
  }
  for (let m = Number(start.slice(5, 7)); m <= Number(end.slice(5, 7)); m++) {
    const month = `${start.slice(0, 4)}-${String(m).padStart(2, '0')}`;
    buckets.push({ label: period === 'quarter' ? `${m}月` : String(m), value: byMonth.get(month) ?? 0 });
  }
  return buckets;
}

function formatDuration(seconds: number) {
  const rounded = Math.round(seconds);
  if (rounded === 0) return '0 分钟';
  if (rounded < 60) return `${rounded} 秒`;
  const minutes = Math.round(rounded / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes} 分钟`;
  return minutes % 60 ? `${hours} 小时 ${minutes % 60} 分钟` : `${hours} 小时`;
}

export default async function StatsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const period: Period = PERIODS.includes(sp.period as Period) ? (sp.period as Period) : 'week';
  const today = todayStr();
  const r = periodRange(period, today);

  const cur = volumeStats(r.start, r.end);
  const prev = volumeStats(r.prevStart, r.prevEnd);
  const activity = primaryMuscleActivity(r.start, r.end);
  const currentMuscles = new Map<MuscleId, number>();
  for (const { id, volume } of activity) currentMuscles.set(id, (currentMuscles.get(id) ?? 0) + volume);
  const muscleCards = muscleDistribution(activity, period, r.start, r.end);
  const exs = exercisePerformance(r.start, r.end);
  const trend = trendStats(r.start, r.end);
  const buckets = bucketize(period, r.start, r.end, new Map(trend.map(({ date, volume }) => [date, volume])));
  const trainingTime = trainingTimeByDate(r.start, r.end);
  const timeBuckets = bucketize(period, r.start, r.end, new Map(trainingTime.map(({ date, seconds }) => [date, seconds])));
  const totalSeconds = trainingTime.reduce((total, { seconds }) => total + seconds, 0);
  const timedSessions = trainingTime.reduce((total, { sessions }) => total + sessions, 0);
  const maxTime = Math.max(1, ...timeBuckets.map(({ value }) => value));

  const maxBucket = Math.max(1, ...buckets.map((b) => b.value));
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
          <>
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
          </>
        ) : (
          <>
            <section className="block">
              <h2 className="block-title">肌群训练分布<span>容量 · 重量 × 次数</span></h2>
              <StatsBodyMap stats={currentMuscles} variant={sculptureVariant(getProfileRow()?.sex)} />
              <MuscleDistribution cards={muscleCards} period={period} />
            </section>

            <section className="block">
              <h2 className="block-title">
                容量趋势
                <span>kg / {period === 'week' ? '天' : period === 'month' ? '天' : '月'}</span>
              </h2>
              <div className={`bar-chart ${period === 'month' || period === 'year' ? 'dense' : ''}`}>
                {buckets.map((b, i) => (
                  <div className="bc-col" key={i} title={`${b.label}: ${b.value} kg`}>
                    <div className="bc-bar">
                      <i style={{ height: `${Math.max(2, (b.value / maxBucket) * 100)}%` }} />
                    </div>
                    <span>{b.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="block stats-time">
              <h2 className="block-title">运动时间<span>按{period === 'week' || period === 'month' ? '天' : '月'}统计</span></h2>
              {timedSessions > 0 ? <>
                <dl className="stats-time-summary">
                  <div><dt>累计时长</dt><dd>{formatDuration(totalSeconds)}</dd></div>
                  <div><dt>平均每次</dt><dd>{formatDuration(totalSeconds / timedSessions)}</dd></div>
                </dl>
                <div className={`bar-chart ${period === 'month' || period === 'year' ? 'dense' : ''}`} role="list" aria-label="运动时间趋势">
                  {timeBuckets.map(({ label, value }) => {
                    const description = `${label}：${formatDuration(value)}`;
                    return <div className="bc-col" role="listitem" aria-label={description} key={label} title={description}>
                      <div className="bc-bar" aria-hidden="true">
                        <i style={{ height: `${value > 0 ? Math.max(2, value / maxTime * 100) : 0}%` }} />
                      </div>
                      <span aria-hidden="true">{label}</span>
                    </div>;
                  })}
                </div>
              </> : <p className="hint">所选时段还没有已完成且有时长的训练。</p>}
            </section>

            <ExercisePerformance exercises={exs} />
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
