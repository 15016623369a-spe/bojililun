import { notFound } from 'next/navigation';
import PorcelainNormalProbe from '@/components/PorcelainNormalProbe';

export const dynamic = 'force-dynamic';

/** 皮肤法线贴图试验页：只在开发时打开，正式版返回 404 */
export default function Probe2() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <div style={{ display: 'flex', height: '100vh', background: '#FBF6F3' }}>
      <div style={{ flex: 1, height: '100%' }}>
        <PorcelainNormalProbe mode="skin" />
      </div>
    </div>
  );
}
