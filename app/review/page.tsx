import type { Metadata } from 'next';
import Link from 'next/link';
import TabBar from '@/components/fc/TabBar';
import { LeafIcon } from '@/components/fc/icons';
import { reviewData, reviewOverview, type ReviewPeriod } from '@/lib/log';
import type { TimelineEntry } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '回顾 · FitCheck',
};

const SEGMENTS: Array<{ key: ReviewPeriod; label: string }> = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
];

const PERIOD_WORD: Record<ReviewPeriod, string> = { day: '这天', week: '本周', month: '本月' };

function ReviewRow({ e }: { e: TimelineEntry }) {
  if (e.kind === 'meal') {
    return (
      <div className="fc-lrow">
        <i className="fc-dot meal" />
        <div className="fc-lrow-b">
          <div>
            {e.label} · {e.items.join('、')}
          </div>
        </div>
      </div>
    );
  }
  return (
    <Link href={`/log/training/${e.id}`} className="fc-lrow">
      <i className="fc-dot" />
      <div className="fc-lrow-b">
        <div>
          {e.region} · {e.exercises.length ? e.exercises.join('、') : '训练'}
        </div>
        <div className="muted">{e.minutes > 0 ? `${e.minutes} 分钟` : '进行中'}</div>
      </div>
    </Link>
  );
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const period: ReviewPeriod = sp.period === 'day' || sp.period === 'month' ? sp.period : 'week';
  const data = reviewData(period);
  const ov = reviewOverview(period);

  return (
    <div className="fc">
      <div className="fc-shell review">
        <header>
          <div className="fc-brand">
            <LeafIcon />
            FitCheck
          </div>
          <h1 className="fc-h1">回顾</h1>
        </header>

        <div className="fc-seg" role="tablist" aria-label="统计区间">
          {SEGMENTS.map((s) => (
            <Link
              key={s.key}
              href={s.key === 'week' ? '/review' : `/review?period=${s.key}`}
              className={period === s.key ? 'on' : ''}
              scroll={false}
              role="tab"
              aria-selected={period === s.key}
            >
              {s.label}
            </Link>
          ))}
        </div>

        <p className="fc-range">{data.label}</p>

        <section className="fc-ov">
          <div className="fc-ov-line">
            {PERIOD_WORD[period]}记录 <b>{ov.days}</b> 天 · 训练 <b>{ov.sessions}</b> 次 · 饮食 <b>{ov.meals}</b> 餐
          </div>

          {ov.week && (
            <div className="fc-ov-days">
              {ov.week.map((d) => (
                <div key={d.date} className={`fc-ov-day${d.has ? ' has' : ''}${d.today ? ' today' : ''}`}>
                  <i>{d.label}</i>
                  <span>{d.dow}</span>
                </div>
              ))}
            </div>
          )}

          {ov.parts.length > 0 && (
            <div className="fc-ov-parts">
              {ov.parts.map((p) => (
                <span key={p.part}>
                  {p.label} ×{p.count}
                </span>
              ))}
            </div>
          )}

          {ov.days > 0 && (
            <div className="fc-ov-foot">
              共 {ov.sets} 组 · {ov.volume.toLocaleString('zh-CN')} kg · {ov.minutes} 分钟
            </div>
          )}
        </section>

        <div className="fc-hair" />

        {data.days.length === 0 && (
          <div className="fc-empty">
            <b>这段时间还没有记录。</b>
            <br />
            去「记录」里按住说话，或者在「身体」里点一下肌肉直接打卡。
          </div>
        )}

        {data.days.map((day) => (
          <section key={day.date}>
            <h2 className="fc-day">{day.label}</h2>
            {day.entries.map((e) => (
              <ReviewRow key={`${e.kind}-${e.id}`} e={e} />
            ))}
          </section>
        ))}

        <div className="fc-more">
          <Link href="/train">训练计划</Link>
          <Link href="/exercises">动作库</Link>
          <Link href="/me">我的</Link>
        </div>
      </div>

      <div className="fc-dock">
        <div className="fc-dock-inner nav-only">
          <TabBar active="review" />
        </div>
      </div>
    </div>
  );
}
