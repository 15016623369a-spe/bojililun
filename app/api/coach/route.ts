import { COACH_TOPICS, type CoachTopic } from '@/lib/coach-types';
import { askCoach, confirmCoachPlan, getCoachState } from '@/lib/core/coach';

export const runtime = 'nodejs';
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function GET() {
  return Response.json(getCoachState(), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ error: '请求格式无效' }, { status: 415 });
  }
  const origin = request.headers.get('origin');
  if (origin && (!URL.canParse(origin) || new URL(origin).host !== request.headers.get('host'))) {
    return Response.json({ error: '请求来源无效' }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string' || !UUID.test(body.id)) {
    return Response.json({ error: '请求编号无效' }, { status: 400 });
  }
  try {
    if ('action' in body && body.action === 'confirm') {
      const state = confirmCoachPlan(body.id);
      return state ? Response.json(state) : Response.json({ error: '这份训练草案已不可用，请重新安排' }, { status: 404 });
    }
    if (!('question' in body) || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 1500) {
      return Response.json({ error: '请输入 1–1500 个字的问题' }, { status: 400 });
    }
    const topic = 'topic' in body && typeof body.topic === 'string' && Object.hasOwn(COACH_TOPICS, body.topic)
      ? body.topic as CoachTopic : undefined;
    return Response.json(await askCoach(body.id, body.question.trim(), topic));
  } catch (error) {
    console.error('[coach] 请求处理失败', error instanceof Error ? error.message : '');
    return Response.json({ error: '教练暂时没能完成，请重试' }, { status: 500 });
  }
}
