import { getDb } from '@/lib/db';
import { exportJournal, renderMarkdown } from '@/lib/export';
import {
  fillSets,
  chooseCardPick,
  updateMealNutrition,
  saveBatch,
  localDay,
  writeItems,
  transaction,
} from '@/lib/ledger';
import { editNutrition, type NutritionEdit } from '@/lib/ledger-nutrition';
import type { Item } from '@/lib/calculations';
import { parseInput } from '@/lib/ledger-parse';
const user = 'local';
export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams,
      start = p.get('start') || localDay(new Date().toISOString()),
      end = p.get('end') || start;
    const book = exportJournal(getDb(), user, start, end),
      md = p.get('format') === 'md';
    return new Response(md ? renderMarkdown(book) : JSON.stringify(book, null, 2), {
      headers: {
        'content-type': md ? 'text/markdown; charset=utf-8' : 'application/json',
        'cache-control': 'no-store',
        ...(p.has('download')
          ? { 'content-disposition': `attachment; filename="FitCheck-${start}-${end}.${md ? 'md' : 'json'}"` }
          : {}),
      },
    });
  } catch (e) {
    return failure(e);
  }
}
function failure(e: unknown) {
  return Response.json({ error: e instanceof Error ? e.message : '记录失败' }, { status: 400 });
}
export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (
      !['manual', 'voice', 'photo', 'scale'].includes(b.source) ||
      typeof b.request_id !== 'string' ||
      !b.request_id
    )
      throw Error('缺少来源或请求标识');
    const db = getDb();
    if (db.prepare('SELECT 1 FROM ledger_requests WHERE user_id=? AND request_id=?').get(user, b.request_id))
      return Response.json({ ok: true });
    if (b.photo && (typeof b.photo !== 'string' || b.photo.length > 6_000_000)) throw Error('照片过大，请重新选择');
    if (b.photo && !/^data:image\/(jpeg|png|webp);base64,/.test(b.photo)) throw Error('照片格式无效');
    const parsed =
      b.source === 'scale'
        ? {
            route: 'record' as const,
            records: [
              {
                entry_type: 'body_metrics' as const,
                logged_at: b.logged_at ?? new Date().toISOString(),
                summary_title: '体重',
                confidence: 'exact' as const,
                weight_kg: b.weight_kg,
                body_fat_pct: b.body_fat_pct,
                note: b.note ?? null,
                raw_text: null,
                feeling_tags: [],
              },
            ],
          }
        : await parseInput(b.text ?? '', b.photo, b.source);
    if (parsed.route === 'qa') {
      if (b.photo) throw Error('没有识别到可记录的内容，照片已保留');
      return Response.json(parsed);
    }
    const loggedAt = typeof b.logged_at === 'string' ? Date.parse(b.logged_at) : NaN;
    const records = b.source !== 'scale' && Number.isFinite(loggedAt)
      ? parsed.records.map((record) => ({ ...record, logged_at: new Date(loggedAt).toISOString() }))
      : parsed.records;
    saveBatch(db, user, b.request_id, b.source, records, b.photo);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request) {
  try {
    const b = await req.json(),
      db = getDb();
    if (b.deleted === false) {
      if (!db.prepare('UPDATE entries SET is_deleted=0 WHERE id=? AND user_id=?').run(b.id, user).changes)
        throw Error('卡片不存在');
    } else if (typeof b.quick_choice === 'string') chooseCardPick(db, user, b.id, b.quick_choice);
    else if (b.choice !== undefined) fillSets(db, user, b.id, b.index, b.choice);
    else
      transaction(db, () => {
        if (!db.prepare('SELECT id FROM entries WHERE id=? AND user_id=? AND is_deleted=0').get(b.id, user))
          throw Error('卡片不存在');
        if (b.deleted === true) db.prepare('UPDATE entries SET is_deleted=1 WHERE id=?').run(b.id);
        if (typeof b.note === 'string') db.prepare('UPDATE entries SET note=? WHERE id=?').run(b.note, b.id);
        if (b.nutrition_edit) {
          const edit = b.nutrition_edit as NutritionEdit & { item_id: number };
          const row = db
            .prepare('SELECT * FROM meal_items WHERE id=? AND entry_id=?')
            .get(edit.item_id, b.id);
          if (!row) throw Error('食物明细不存在');
          const { nutrition_basis, ...data } = row;
          const item = editNutrition(
            {
              ...data,
              nutrition_basis: nutrition_basis ? JSON.parse(String(nutrition_basis)) : undefined,
            } as Item,
            {
              measured_grams: edit.measured_grams,
              food_state: edit.food_state,
              weight_basis: edit.weight_basis,
            },
          );
          updateMealNutrition(db, b.id, edit.item_id, item);
          db.prepare("UPDATE entries SET quick_pick='false' WHERE id=?").run(b.id);
        }
        if (b.items) {
          if (!db.prepare("SELECT id FROM entries WHERE id=? AND entry_type='meal'").get(b.id))
            throw Error('不是饮食记录');
          db.prepare('DELETE FROM meal_items WHERE entry_id=?').run(b.id);
          writeItems(db, b.id, b.items);
          db.prepare("UPDATE entries SET quick_pick='false' WHERE id=?").run(b.id);
        }
      });
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
