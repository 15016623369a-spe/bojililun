import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import RecordUndoNotice from '@/components/RecordUndoNotice';
import './globals.css';
import './journal.css';
import './replica.css';
import './visual.css';
import './plan-visual.css';
import './v-train.css';
import './v-record.css';
import './v-coach-preview.css';
import './v-review.css';
import './v-review-wall.css';
import './v-backdrop.css';
import './v-stats.css';
import './v-me.css';
import './v-extras.css';
import './exercise-detail.css';
import './motion.css';
import './theme-dark.css';

export const metadata: Metadata = {
  title: 'FitCheck · 健身记录',
  description: '用语音记下饮食和训练，回顾自己的记录。',
  appleWebApp: {
    capable: true,
    title: 'FitCheck',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
};

export async function generateViewport(): Promise<Viewport> {
  const dark = (await cookies()).get('fc-theme')?.value === 'dark';
  return { width: 'device-width', initialScale: 1, themeColor: dark ? '#0e0f10' : '#e2e3df' };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 白天 / 夜间：在「我的」底部切换，存在 cookie 里，服务端渲染时就带上
  const theme = (await cookies()).get('fc-theme')?.value === 'dark' ? 'dark' : 'light';
  return (
    <html lang="zh-CN" data-theme={theme}>
      <body>{children}<RecordUndoNotice /></body>
    </html>
  );
}
