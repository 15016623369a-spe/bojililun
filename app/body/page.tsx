import Link from 'next/link';
import BottomNav from '@/components/BottomNav';
import BodyAtlas from '@/components/BodyAtlas';

export const metadata = { title: '人体 · FitCheck' };

export default function BodyPage() {
  return (
    <div className="page">
      <header className="page-hdr">
        <div>
          <h1>人体</h1>
          <p>真实解剖模型 · 胸肩细分到肌束</p>
        </div>
        <Link className="chip-btn" href="/exercises">
          全部动作
        </Link>
      </header>
      <div className="page-body">
        <BodyAtlas />
      </div>
      <BottomNav active="body" />
    </div>
  );
}
