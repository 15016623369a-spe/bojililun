import { getDb } from '../db';
import { DEFAULT_TZ, MEAL_LABEL } from '../date';
import { getExercise } from '../exercise';
import { mentionedMuscles, type JournalEntry } from '../journal';
import { MUSCLES, muscleMatchesExercise } from '../muscles';
import { addDays } from '../period';
import { mealsOn } from './meals';
import { daySessions, nowIso, todayStr } from './workout';

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: process.env.APP_TZ || DEFAULT_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

interface QuickRow {
  id: number;
  date: string;
  kind: JournalEntry['kind'];
  title: string;
  detail: string;
  source_text: string;
  created_at: string;
}

function inferQuickEntry(source: string, date: string) {
  const meal = source.match(/早餐|早上|早饭|午餐|中午|午饭|晚餐|晚上|晚饭|夜宵|加餐/);
  const ate = /吃|喝|午餐|午饭|晚餐|晚饭|早[餐饭]|夜宵|加餐/.test(source);
  const training = /训练|练了|练完|练[背胸肩腿臀腹]|卧推|深蹲|下拉|划船|跑[步了]|做了.{0,8}(组|分钟)|骑[车了]|游[泳了]/.test(source);
  if (!ate && !training) throw new Error('可以试着写「午饭牛肉面」或「刚做了 20 分钟高位下拉」。');
  const dateOffset = /前天/.test(source) ? -2 : /昨天|昨晚/.test(source) ? -1 : 0;
  const entryDate = addDays(date, dateOffset);
  const detail = source.replace(/^(?:帮我)?(?:记录一下|记一下|记录|记一笔)[：:，,\s]*/, '')
    .replace(/^(?:前天|昨天|今天)(?=\S)/, '').replace(/^[\s，,：:]+|[。！!]+$/g, '');
  if (ate) {
    const title = /早/.test(meal?.[0] ?? '') ? '早餐'
      : /午/.test(meal?.[0] ?? '') ? '午餐'
        : /晚/.test(meal?.[0] ?? '') || /昨晚/.test(source) ? '晚餐'
          : meal ? '加餐' : '饮食';
    return { date: entryDate, kind: 'meal' as const, title, detail: detail.replace(/^(?:早餐|早上|早饭|午餐|中午|午饭|晚餐|晚上|晚饭|昨晚|夜宵|加餐)(?:吃了?|喝了?)?[：:，,\s]*/, '') || detail };
  }
  return { date: entryDate, kind: 'training' as const, title: '训练', detail };
}

function serializeQuick(row: QuickRow): JournalEntry {
  return {
    id: `quick-${row.id}`, quickId: row.id, date: row.date, kind: row.kind, title: row.title,
    detail: row.detail, source: row.source_text,
    muscles: row.kind === 'training' ? mentionedMuscles(row.detail) : [],
  };
}

export function writeQuickEntry(raw: string, requestId: string, id?: number) {
  const source = raw.trim();
  if (!source || source.length > 1000) throw new Error('记录需要 1 至 1000 个字');
  const db = getDb();
  if (id !== undefined) {
    const row = db.prepare('SELECT * FROM journal_entry WHERE id = ?').get(id) as QuickRow | undefined;
    if (!row) throw new Error('这条记录已不存在');
    const changedDate = /前天|昨天|今天|昨晚/.test(source);
    const parsed = inferQuickEntry(source, todayStr());
    db.prepare('UPDATE journal_entry SET date = ?, kind = ?, title = ?, detail = ?, source_text = ? WHERE id = ?')
      .run(changedDate ? parsed.date : row.date, parsed.kind, parsed.title, parsed.detail, source, id);
    return serializeQuick(db.prepare('SELECT * FROM journal_entry WHERE id = ?').get(id) as unknown as QuickRow);
  }

  const parsed = inferQuickEntry(source, todayStr());
  db.prepare(`INSERT INTO journal_entry (request_id, date, kind, title, detail, source_text, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING`)
    .run(requestId, parsed.date, parsed.kind, parsed.title, parsed.detail, source, nowIso());
  return serializeQuick(db.prepare('SELECT * FROM journal_entry WHERE request_id = ?').get(requestId) as unknown as QuickRow);
}

export function undoQuickEntry(id: number) {
  getDb().prepare('DELETE FROM journal_entry WHERE id = ?').run(id);
}

export function journalMarkers(start: string, end: string) {
  const rows = getDb().prepare(`
    SELECT date, kind, count(*) AS count
    FROM (
      SELECT date, kind FROM journal_entry WHERE date BETWEEN $start AND $end
      UNION ALL
      SELECT date, 'meal' FROM meal_log WHERE date BETWEEN $start AND $end
      UNION ALL
      SELECT date, 'training' FROM session
      WHERE date BETWEEN $start AND $end AND ended_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM session_set WHERE session_id = session.id)
    )
    GROUP BY date, kind
  `).all({ $start: start, $end: end }) as Array<{ date: string; kind: JournalEntry['kind']; count: number }>;
  const byDate = new Map<string, { training: number; meal: number }>();
  for (const { date, kind, count } of rows) {
    const markers = byDate.get(date) ?? { training: 0, meal: 0 };
    markers[kind] = count;
    byDate.set(date, markers);
  }
  return byDate;
}

export function journalForDate(date: string): JournalEntry[] {
  const quick = getDb().prepare('SELECT * FROM journal_entry WHERE date = ?').all(date) as unknown as QuickRow[];
  const entries = quick.map((row) => ({ at: row.created_at, entry: serializeQuick(row) }));
  for (const meal of mealsOn(date)) {
    entries.push({ at: meal.created_at, entry: {
      id: `meal-${meal.id}`, date, kind: 'meal', title: MEAL_LABEL[meal.meal_type],
      detail: meal.items.map((item) => `${item.name} ${item.grams} g`).join('、'),
      meta: meal.kcal > 0 ? `约 ${meal.kcal} kcal` : undefined,
    } });
  }
  for (const { session, sets, groups } of daySessions(date)) {
    if (!session.ended_at || !sets.length) continue;
    const duration = Math.max(0, Math.round((Date.parse(session.ended_at) - Date.parse(session.started_at)) / 1000));
    const muscles = new Set(groups.flatMap((group) => {
      const exercise = getExercise(group.exercise_id);
      return exercise ? MUSCLES.filter((muscle) => muscleMatchesExercise(muscle, exercise)).map((muscle) => muscle.id)
        : mentionedMuscles(group.exercise_name);
    }));
    const regions = [...new Set(MUSCLES.filter((muscle) => muscles.has(muscle.id)).map((muscle) => muscle.region))];
    const region = regions[0];
    const title = regions.length !== 1 ? '力量训练' : ['手臂', '核心'].includes(region) ? region + '训练' : region + '部训练';
    entries.push({ at: session.ended_at, entry: {
      id: `session-${session.id}`, date, kind: 'training',
      title,
      detail: groups.map((group) => group.exercise_name).join('、'),
      meta: `共 ${sets.length} 组 · ${duration < 60 ? duration + ' 秒' : Math.round(duration / 60) + ' 分钟'}`,
      time: timeFormatter.format(new Date(session.ended_at)),
      muscles: [...muscles], href: `/history/${date}#session-${session.id}`,
    } });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at)).map(({ entry }) => entry);
}
