/** 日期 / 餐次 —— 纯函数，前后端共用，不依赖 Node API */

export const DEFAULT_TZ = 'Asia/Shanghai';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

/** 指定时区的 YYYY-MM-DD */
export function todayKey(tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** 指定时区的小时（0–23） */
export function hourIn(tz: string = DEFAULT_TZ): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour')?.value ?? '0';
  return Number(h) % 24;
}

export function mealTypeForHour(hour: number): MealType {
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

export function currentMealType(tz: string = DEFAULT_TZ): MealType {
  return mealTypeForHour(hourIn(tz));
}

export function humanDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const week = ['日', '一', '二', '三', '四', '五', '六'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日 周${week}`;
}

export function weekDates(dateKey: string): string[] {
  const monday = new Date(`${dateKey}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}
