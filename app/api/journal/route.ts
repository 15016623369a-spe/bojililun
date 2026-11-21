import { NextResponse } from 'next/server';
import { applyTrainingMutation, prepareTrainingMutation, TrainingConflictError, undoQuickEntry, updateQuickMealItem, writeQuickEntry, type TrainingMutationPreview } from '@/lib/core/journal';
import { MEAL_PHOTO_MAX_BYTES } from '@/lib/journal';
import { isQuestion } from '@/lib/intent';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { text, requestId, id, resolution, replacementExerciseId, intent, targetCardId, confirmMutation } = await request.json();
    if (typeof text === 'string' && typeof targetCardId === 'string' && targetCardId.startsWith('session-')) {
      if (!text.trim() || text.length > 1000) throw new Error('修改内容需要 1 至 1000 个字');
      if (/[?？]|(多少|怎么|为什么|吗)$/.test(text.trim())) throw new Error('卡片语音用于修改当前训练，请把问题发到主页问答');
      const targetIntent = /(完成|做完|练完|结束)/.test(text) ? 'completion' : 'correction';
      return NextResponse.json({ preview: prepareTrainingMutation(text, targetIntent, targetCardId) });
    }
    if (confirmMutation && typeof confirmMutation === 'object') {
      const preview = confirmMutation as TrainingMutationPreview;
      if (!['correction', 'completion'].includes(preview.intent) || typeof preview.exerciseId !== 'string'
        || !Number.isSafeInteger(preview.afterSets) || !Number.isSafeInteger(preview.beforeSets)) throw new Error('变更预览无效');
      return NextResponse.json({ entry: applyTrainingMutation(preview) });
    }
    if (typeof text !== 'string' || (id === undefined && (typeof requestId !== 'string' || requestId.length > 64 || !requestId))
      || (id !== undefined && (!Number.isSafeInteger(id) || id < 1))
      || (resolution !== undefined && resolution !== 'actual')
      || (replacementExerciseId !== undefined && typeof replacementExerciseId !== 'string')) throw new Error('记录格式无效');
    if (intent === 'correction' || intent === 'completion') {
      return NextResponse.json({ preview: prepareTrainingMutation(text, intent as 'correction' | 'completion') });
    }
    if (isQuestion(text)) throw new Error('请在问答中提交问句');
    return NextResponse.json({ entry: writeQuickEntry(text, requestId, id, resolution, replacementExerciseId) });
  } catch (err) {
    if (err instanceof TrainingConflictError) {
      return NextResponse.json({ error: err.message, conflict: err.conflict }, { status: 409 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: '记录不存在' }, { status: 400 });
  undoQuickEntry(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  try {
    const { quickId, index, amount, name, meal, preparation, manualKcal, photoData, removePhoto } = await request.json();
    if (!Number.isSafeInteger(quickId) || quickId < 1 || !Number.isSafeInteger(index) || index < 0
      || typeof amount !== 'string'
      || [name, meal, preparation, photoData].some((value) => value !== undefined && typeof value !== 'string')
      || (manualKcal != null && typeof manualKcal !== 'number')
      || (removePhoto !== undefined && typeof removePhoto !== 'boolean')) throw new Error('记录格式无效');
    if (photoData?.length > Math.ceil(MEAL_PHOTO_MAX_BYTES / 3) * 4 + 32) throw new Error('图片不能超过 8 MB');
    const entry = updateQuickMealItem(quickId, index, { amount, name, meal, preparation, manualKcal, photoData, removePhoto });
    return NextResponse.json({ ok: true, amount: amount.trim(), entry });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
