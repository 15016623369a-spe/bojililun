import type { Metadata, Viewport } from 'next';
import './globals.css';
import './journal.css';
import './replica.css';
import './visual.css';
import './v-train.css';
import './v-record.css';
import './v-review.css';

export const metadata: Metadata = {
  title: 'FitCheck · 健身记录',
  description: '用语音记下饮食和训练，回顾自己的记录。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#e2e3df',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
