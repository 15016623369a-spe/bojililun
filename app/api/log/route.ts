import { NextResponse } from 'next/server';
import { deleteMeal, deleteTraining, editMeal, editTraining, quickLog, replaceSets } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 一句话快记：训练 / 饮食 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      text?: string;
      photo?: string;
      items?: Array<{
        name?: string;
        grams?: number;
        kcal_100g?: number;
        protein_100g?: number;
        carb_100g?: number;
        fat_100g?: number;
        matched?: boolean;
      }>;
    };
    const text = String(body.text ?? '').trim();
    if (!text) return NextResponse.json({ error: '说点什么再记' }, { status: 400 });
    const preset = Array.isArray(body.items) && body.items.length
      ? body.items.map((i) => ({
          name: String(i.name ?? '食物'),
          grams: Number(i.grams) || 100,
          kcal_100g: Number(i.kcal_100g) || 0,
          protein_100g: Number(i.protein_100g) || 0,
          carb_100g: Number(i.carb_100g) || 0,
          fat_100g: Number(i.fat_100g) || 0,
          matched: Boolean(i.matched),
        }))
      : undefined;
    const result = quickLog(text, typeof body.photo === 'string' && body.photo ? body.photo : undefined, preset);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** 编辑一条记录 */
export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as {
      kind?: 'training' | 'meal';
      id?: number;
      minutes?: number;
      exercises?: string[];
      names?: string[];
      items?: Array<{
        exerciseId?: string;
        name: string;
        bodyPart?: string;
        target?: string;
        sets: number;
        reps: number;
        weight: number;
      }>;
    };
    const id = Number(body.id);
    if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });

    if (body.kind === 'meal') {
      const names = (body.names ?? []).map((s) => String(s).trim()).filter(Boolean);
      if (!names.length) return NextResponse.json({ error: '至少留一样吃的' }, { status: 400 });
      return NextResponse.json({ ok: true, entry: editMeal(id, names) });
    }

    // 详情页保存：整份「组数 × 次数 × 重量」
    if (Array.isArray(body.items) && body.items.length) {
      replaceSets(id, body.items);
      return NextResponse.json({ ok: true });
    }

    const exercises = (body.exercises ?? []).map((s) => String(s).trim()).filter(Boolean);
    return NextResponse.json({
      ok: true,
      entry: editTraining(id, { minutes: body.minutes, exercises: exercises.length ? exercises : undefined }),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** 撤销一条记录 */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id'));
    const kind = url.searchParams.get('kind');
    if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    if (kind === 'meal') deleteMeal(id);
    else deleteTraining(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
