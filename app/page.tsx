import { redirect } from 'next/navigation';
import { needsTrainingSetup } from '@/lib/core/training-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 记录以手账页 /log 为准；根路径只负责新用户建档分流。 */
export default function RootPage() {
  redirect(needsTrainingSetup() ? '/setup' : '/log');
}
