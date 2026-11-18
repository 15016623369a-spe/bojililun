/** 统计区间计算：周 / 月 / 季 / 年，均按 Asia/Shanghai 的自然日 */

export type Period = 'week' | 'month' | 'quarter' | 'year';

export const PERIOD_LABEL: Record<Period, string> = {
  week: '本周',
  month: '本月',
  quarter: '本季',
  year: '本年',
};

function parseDay(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function fmt(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

function addDays(d: string, n: number): string {
  const dt = parseDay(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

export interface Range {
  start: string;
  end: string;
  label: string;
  prevStart: string;
  prevEnd: string;
}

export function periodRange(period: Period, today: string): Range {
  const dt = parseDay(today);
  let start: string;
  let end: string;
  let label: string;

  if (period === 'week') {
    const dow = (dt.getUTCDay() + 6) % 7; // 周一 = 0
    const s = new Date(dt);
    s.setUTCDate(s.getUTCDate() - dow);
    start = fmt(s);
    end = addDays(start, 6);
    label = `${start} — ${end}`;
  } else if (period === 'month') {
    start = `${today.slice(0, 7)}-01`;
    const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
    end = fmt(last);
    label = `${dt.getUTCFullYear()} 年 ${dt.getUTCMonth() + 1} 月`;
  } else if (period === 'quarter') {
    const q = Math.floor(dt.getUTCMonth() / 3);
    const first = new Date(Date.UTC(dt.getUTCFullYear(), q * 3, 1));
    const last = new Date(Date.UTC(dt.getUTCFullYear(), q * 3 + 3, 0));
    start = fmt(first);
    end = fmt(last);
    label = `${dt.getUTCFullYear()} 年 Q${q + 1}`;
  } else {
    start = `${today.slice(0, 4)}-01-01`;
    end = `${today.slice(0, 4)}-12-31`;
    label = `${today.slice(0, 4)} 年`;
  }

  // 上一个同长度区间，用于“对比”
  const len = Math.round((parseDay(end).getTime() - parseDay(start).getTime()) / 86400000) + 1;
  return {
    start,
    end,
    label,
    prevStart: addDays(start, -len),
    prevEnd: addDays(start, -1),
  };
}

/** 一个月里每天的信息（用于历史页的月历） */
export function monthDays(month: string): Array<{ date: string; day: number; weekday: number }> {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const out: Array<{ date: string; day: number; weekday: number }> = [];
  for (let d = 1; d <= last.getUTCDate(); d++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    out.push({ date: fmt(dt), day: d, weekday: (dt.getUTCDay() + 6) % 7 });
  }
  return out;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m} 月 ${d} 日 · 周${wd}`;
}

export { addDays };
