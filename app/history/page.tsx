import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** 回顾以手账页 /review 为准；保留旧链接，按日 / 周 / 月转过去。日详情 /history/[date] 和月历仍在。 */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period } = await searchParams;
  redirect(period === 'day' || period === 'month' ? `/review?period=${period}` : '/review');
}
