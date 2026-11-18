import Link from 'next/link';
import BottomNav from '@/components/BottomNav';
import BodyExplorer from '@/components/BodyExplorer';

export const metadata = { title: '人体 · FitCheck' };

export default function BodyPage() {
  return (
    <div className="page">
      <header className="page-hdr">
        <div>
          <h1>人体</h1>
          <p>拖动旋转 · 点击肌肉看动作</p>
        </div>
        <Link className="chip-btn" href="/exercises">
          全部动作
        </Link>
      </header>
      <div className="page-body">
        <BodyExplorer />
      </div>
      <BottomNav active="body" />
    </div>
  );
}
