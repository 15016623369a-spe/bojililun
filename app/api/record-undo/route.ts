import { getDb } from '@/lib/db';
import { restoreRemoval } from '@/lib/core/record-removals';

export async function POST(request: Request) {
  try {
    const { token } = await request.json();
    if (typeof token !== 'string' || !token) throw new Error('缺少撤销标识');
    restoreRemoval(getDb(), token);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
