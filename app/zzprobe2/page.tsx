import PorcelainNormalProbe from '@/components/PorcelainNormalProbe';

export const dynamic = 'force-dynamic';

export default function Probe2() {
  return (
    <div style={{ display: 'flex', height: '100vh', background: '#FBF6F3' }}>
      <div style={{ flex: 1, height: '100%' }}>
        <PorcelainNormalProbe mode="skin" />
      </div>
    </div>
  );
}
