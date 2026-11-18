import type { Metadata, Viewport } from 'next';
import './globals.css';
import './journal.css';

export const metadata: Metadata = {
  title: 'FitCheck · 健身记录',
  description: '用语音记下饮食和训练，回顾自己的记录。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f9f7f2',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
