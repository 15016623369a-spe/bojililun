import type { Metadata, Viewport } from 'next';
import './globals.css';
import './replica.css';

export const metadata: Metadata = {
  title: 'FitCheck · 记录与回顾',
  description: '按住说话就记下今天练了什么、吃了什么；周／月回顾看练过哪些部位。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0a0d12',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
