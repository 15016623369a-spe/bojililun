import type { RangeKey, WallDay } from '@/lib/review-wall';

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'd7', label: '7天' },
  { key: 'd30', label: '30天' },
  { key: 'y1', label: '1年' },
];
export const RANGE_WORD: Record<RangeKey, string> = { d7: '近 7 天', d30: '近 30 天', y1: '近 12 个月' };
export const STATS_PERIOD: Record<RangeKey, string> = { d7: 'week', d30: 'month', y1: 'year' };

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
export const weekday = (date: string) => `周${WEEK[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]}`;
export const short = (date: string) => `${Number(date.slice(5, 7))}.${Number(date.slice(8))}`;
export const fmt = (v: number, dec = 0) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
export const avg = (a: number[]) => (a.length ? sum(a) / a.length : 0);
export const present = <T,>(a: (T | null | undefined)[]) => a.filter((x): x is T => x !== null && x !== undefined);

export function haptic(ms = 6) {
  try {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (!ua || ua.hasBeenActive) navigator.vibrate?.(ms);
  } catch { /* iOS 网页没有振动 */ }
}

/** 图上的一格：7 天和 30 天每天一格，1 年每个自然月一格 */
export type Bucket = { key: string; label: string; pick: string; days: WallDay[]; date: string | null };

export function bucketsOf(all: WallDay[], range: RangeKey): Bucket[] {
  if (range === 'y1') {
    const months = new Map<string, WallDay[]>();
    for (const d of all) {
      const m = d.date.slice(0, 7);
      (months.get(m) ?? months.set(m, []).get(m)!).push(d);
    }
    return [...months].map(([m, days]) => ({
      key: m, days, date: null,
      label: `${Number(m.slice(5))}月`,
      pick: `${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月`,
    }));
  }
  const n = range === 'd7' ? 7 : 30;
  return all.slice(-n).map((d, i, a) => ({
    key: d.date, days: [d], date: d.date,
    label: n === 7 ? weekday(d.date) : (a.length - 1 - i) % 7 === 0 ? short(d.date) : '',
    pick: `${weekday(d.date)} · ${short(d.date)}`,
  }));
}

/** 同样长度的上一段（1 年不比较） */
export function previousDays(all: WallDay[], range: RangeKey) {
  if (range === 'y1') return null;
  const n = range === 'd7' ? 7 : 30;
  return all.length >= n * 2 ? all.slice(-n * 2, -n) : null;
}

export const changePill = (cur: number, prev: number, word: string) => {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct)}% 较${word}`;
};
