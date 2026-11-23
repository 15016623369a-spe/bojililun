import type { Metadata } from 'next';
import Link from 'next/link';
import JournalShell from '@/components/JournalShell';
import ReviewWall from '@/components/review/ReviewWall';
import ReviewExport from '@/components/ReviewExport';
import Icon from '@/components/ui/Icon';
import { type ReviewPeriod } from '@/lib/log';
import { getDb } from '@/lib/db';
import { localDay } from '@/lib/ledger';
import { periodRange } from '@/lib/period';
import { getBodyModelSettings } from '@/lib/core/body-model';
import { buildReviewWall } from '@/lib/review-wall';
import { readBackdrop } from '@/lib/core/backdrop';

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
const short = (date: string) => `${date.slice(5, 7)}.${date.slice(8)}`;

/**
 * 回顾：数据块墙（11 月 23 日用户确认）。上方日 / 周 / 月只切换容量主块，
 * 其余数据块固定看今天和最近 7 天，点开后在抽屉里切 7 天 / 30 天 / 1 年。数据口径见 lib/review-wall.ts。
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const period: ReviewPeriod = sp.period === 'day' || sp.period === 'month' ? sp.period : 'week';
  const today = localDay(new Date().toISOString());
  const range = period === 'day' ? { start: today, end: today } : periodRange(period, today);
  const { wall, hero } = buildReviewWall(getDb(), today, period);
  const variant = (await getBodyModelSettings()).model;
  const backdrop = await readBackdrop();

  return (
    <JournalShell active="review" title="回顾" today={today} className="is-review is-ledger-review" backdrop={backdrop}
      headerAction={<div className="head-actions">
        <ReviewExport key={range.start} today={today} start={range.start} />
        <Link href="/me" className="head-avatar" aria-label="我的个人资料"><Icon name="user" size={19} /></Link>
      </div>}
      hero={<>
        <p className="hero-word" aria-hidden="true">回顾</p>
        <div className="review-range">
          <Link className="range-label range-link" href={`/history/calendar?date=${today}&period=${period}`} aria-label="打开训练月历">
            {period === 'day' ? short(today) : `${short(range.start)} — ${short(range.end)}`}
            <span className="range-cal" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
          </Link>
          <nav className="vseg small" aria-label="统计区间">
            {SEGMENTS.map((s) => <Link key={s.key} href={s.key === 'week' ? '/review' : `/review?period=${s.key}`} scroll={false}
              className={period === s.key ? 'on' : undefined} aria-current={period === s.key ? 'page' : undefined}>{s.label}</Link>)}
          </nav>
        </div>
      </>}>
      <ReviewWall hero={hero} data={wall} variant={variant} />
    </JournalShell>
  );
}
