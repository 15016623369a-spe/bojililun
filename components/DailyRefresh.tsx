'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { todayKey } from '@/lib/date';

export default function DailyRefresh({ date, timeZone }: { date: string; timeZone: string }) {
  const router = useRouter();
  useEffect(() => {
    function refreshOnNewDay() {
      if (!document.hidden && todayKey(timeZone) !== date) router.refresh();
    }
    refreshOnNewDay();
    const timer = window.setInterval(refreshOnNewDay, 15_000);
    window.addEventListener('focus', refreshOnNewDay);
    document.addEventListener('visibilitychange', refreshOnNewDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshOnNewDay);
      document.removeEventListener('visibilitychange', refreshOnNewDay);
    };
  }, [date, timeZone, router]);
  return null;
}
