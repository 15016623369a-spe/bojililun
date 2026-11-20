import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import RecordDetail from '@/components/fc/RecordDetail';
import { trainingDetail } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '训练详情 · FitCheck',
};

export default async function TrainingDetailPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const numericId = Number(id);
  if (kind !== 'training' || !Number.isFinite(numericId)) notFound();

  const detail = trainingDetail(numericId);
  if (!detail) notFound();

  return (
    <div className="fc">
      <div className="fc-shell detail">
        <RecordDetail detail={detail} />
      </div>
    </div>
  );
}
