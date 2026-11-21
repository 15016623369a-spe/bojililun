import { getDb } from '@/lib/db';
import { exportJournal, renderMarkdown } from '@/lib/export';
import { fillSets, saveBatch, localDay, writeItems, transaction } from '@/lib/ledger';
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
    if (parsed.route === 'qa') return Response.json(parsed);
    saveBatch(getDb(), user, b.request_id, b.source, parsed.records);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request) {
  try {
    const b = await req.json(),
      db = getDb();
    if (b.choice !== undefined) fillSets(db, user, b.id, b.index, b.choice);
    else
      transaction(db, () => {
        if (!db.prepare('SELECT id FROM entries WHERE id=? AND user_id=? AND is_deleted=0').get(b.id, user))
          throw Error('卡片不存在');
        if (b.deleted === true) db.prepare('UPDATE entries SET is_deleted=1 WHERE id=?').run(b.id);
        if (typeof b.note === 'string') db.prepare('UPDATE entries SET note=? WHERE id=?').run(b.note, b.id);
        if (b.items) {
          if (!db.prepare("SELECT id FROM entries WHERE id=? AND entry_type='meal'").get(b.id))
            throw Error('不是饮食记录');
          db.prepare('DELETE FROM meal_items WHERE entry_id=?').run(b.id);
          writeItems(db, b.id, b.items);
        }
      });
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
