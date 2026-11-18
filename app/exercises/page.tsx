import Link from 'next/link';
import {
  BODY_LABEL,
  BODY_ORDER,
  EQUIPMENT_LABEL,
  EQUIPMENT_ORDER,
  TARGET_LABEL,
  imageUrl,
} from '@/lib/exercise-label';
import AddToPlanButton from '@/components/AddToPlanButton';
import { countExercises, equipmentCountsFor, groupCount, listExercises } from '@/lib/exercise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = 120;

type SP = Promise<Record<string, string | string[] | undefined>>;

function str(v: string | string[] | undefined, fallback: string): string {
  return typeof v === 'string' && v ? v : fallback;
}

export default async function ExercisesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const body = str(sp.body, 'all');
  const equip = str(sp.equip, 'all');
  const q = str(sp.q, '').trim();
  const skip = Math.max(0, Number(str(sp.skip, '0')) || 0);

  const bodyPart = body === 'all' ? undefined : body;
  const equipment = equip === 'all' ? undefined : equip;

  const rows = listExercises({
    bodyPart,
    equipment,
    q: q || undefined,
    limit: PAGE + 1,
    offset: skip,
  });
  const hasMore = rows.length > PAGE;
  const items = rows.slice(0, PAGE);
  const total = countExercises({ bodyPart, equipment, q: q || undefined });
  const bodyTotal = countExercises({ bodyPart, q: q || undefined });

  const bodyCounts = new Map(groupCount('body_part').map((r) => [r.key, r.c]));
  const equipCounts = new Map(equipmentCountsFor({ bodyPart, q: q || undefined }).map((r) => [r.key, r.c]));

  const href = (patch: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { body, equip, q, skip: undefined, ...patch };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== 'all') p.set(k, v);
    }
    const s = p.toString();
    return `/exercises${s ? `?${s}` : ''}`;
  };

  // 按器械分组，读完更像一本动作手册
  const groups: Array<{ equipment: string; list: typeof items }> = [];
  for (const it of items) {
    let g = groups.find((x) => x.equipment === it.equipment);
    if (!g) {
      g = { equipment: it.equipment, list: [] };
      groups.push(g);
    }
    g.list.push(it);
  }

  const equipChips = [
    { key: 'all', label: '全部', count: bodyTotal },
    ...EQUIPMENT_ORDER.map((e) => ({ key: e, label: EQUIPMENT_LABEL[e] ?? e, count: equipCounts.get(e) ?? 0 })),
  ].filter((c) => c.key === 'all' || c.count > 0);

  return (
    <div className="lib">
      <header className="lib-hdr">
        <Link className="lib-back" href="/" aria-label="返回对话">
          ←
        </Link>
        <div>
          <div className="lib-title">动作库</div>
          <div className="lib-sub">
            {body === 'all' ? '全部部位' : BODY_LABEL[body] ?? body}
            {q ? ` · 搜索「${q}」` : ''} · {total.toLocaleString('en-US')} 个动作
          </div>
        </div>
      </header>

      <div className="lib-body">
        <nav className="rail">
          <Link className={`rail-item ${body === 'all' ? 'on' : ''}`} href={href({ body: 'all' })}>
            <span>全部</span>
            <em>{[...bodyCounts.values()].reduce((a, b) => a + b, 0)}</em>
          </Link>
          {BODY_ORDER.map((b) => (
            <Link key={b} className={`rail-item ${body === b ? 'on' : ''}`} href={href({ body: b })}>
              <span>{BODY_LABEL[b] ?? b}</span>
              <em>{bodyCounts.get(b) ?? 0}</em>
            </Link>
          ))}
        </nav>

        <main className="lib-main">
          <form className="lib-search" action="/exercises" method="get">
            {body !== 'all' && <input type="hidden" name="body" value={body} />}
            {equip !== 'all' && <input type="hidden" name="equip" value={equip} />}
            <input name="q" defaultValue={q} placeholder="搜动作名，如 bench press" />
            <button type="submit">搜索</button>
          </form>

          <div className="chips-row">
            {equipChips.map((c) => (
              <Link
                key={c.key}
                className={`equip-chip ${equip === c.key ? 'on' : ''}`}
                href={href({ equip: c.key })}
              >
                {c.label}
                <em>{c.count}</em>
              </Link>
            ))}
          </div>

          {groups.map((g) => (
            <section key={g.equipment} className="ex-group">
              <h2 className="ex-group-title">
                {EQUIPMENT_LABEL[g.equipment] ?? g.equipment}
                <span>{equipCounts.get(g.equipment) ?? g.list.length}</span>
              </h2>
              <div className="ex-grid">
                {g.list.map((x) => (
                  <div className="ex-card" key={x.id}>
                    <Link className="ex-card-link" href={`/exercises/${x.id}`}>
                      <div className="ex-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imageUrl(x.image)} alt={x.name} loading="lazy" />
                        <span className="ex-badge">讲解</span>
                      </div>
                      <div className="ex-name">{x.zh_name || x.name}</div>
                      <div className="ex-meta">
                        {TARGET_LABEL[x.target] ?? x.target}
                        <i>·</i>
                        {BODY_LABEL[x.body_part] ?? x.body_part}
                      </div>
                    </Link>
                    <AddToPlanButton exerciseId={x.id} />
                  </div>
                ))}
              </div>
            </section>
          ))}

          {items.length === 0 && <p className="empty">没有匹配的动作，换个关键词或部位试试。</p>}

          {hasMore && (
            <div className="more-row">
              <Link className="btn" href={href({ skip: String(skip + PAGE) })}>
                加载更多（还有 {total - skip - PAGE} 个）
              </Link>
            </div>
          )}
          {!hasMore && items.length > 0 && <p className="lib-end">— 到底了 —</p>}
        </main>
      </div>
    </div>
  );
}
