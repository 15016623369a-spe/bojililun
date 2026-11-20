/**
 * 「提问即问答」的答案引擎 —— 只答客观问题，数字全部来自本地库。
 * 默认 provider 是 mock，这里不编造：查不到就直说不确定，并给能回答的方向。
 */

import { getDb } from './db';
import { dayText, todayStr } from './log';
import { BODY_LABEL, EQUIPMENT_LABEL, TARGET_LABEL } from './exercise-label';
import { muscleStats, volumeStats } from './core/workout';
import { periodRange } from './period';
import { todaySnapshot } from './core/meals';
import { FOODS } from './foods';

export interface AskFact {
  label: string;
  value: string;
}

export interface AskAction {
  id: 'log' | 'plan';
  label: string;
  /** 记录用的整句 */
  text?: string;
  exerciseId?: string;
  /** 饮食：直接把算好的那份营养带过去，避免再匹配一次数字对不上 */
  items?: Array<{
    name: string;
    grams: number;
    kcal_100g: number;
    protein_100g: number;
    carb_100g: number;
    fat_100g: number;
    matched: boolean;
  }>;
}

export interface AskAnswer {
  kind: 'food' | 'exercise' | 'stats' | 'today' | 'unknown';
  question: string;
  text: string;
  facts: AskFact[];
  media?: { id: string; name: string; image: string };
  actions: AskAction[];
  followUps?: { label: string; question: string }[];
}

/* ------------------------------ 清洗问句 ------------------------------ */

const FILLER =
  /(请问|请教|帮我|麻烦|大概|大约|约|差不多|一般|一下|的话|到底|究竟|这个|那个|我|你|吃|喝|练|做|了|的|呢|吗|啊|呀|吧|多少|几|怎么|怎样|如何|为什么|为啥|哪|什么|啥|是不是|能不能|可以|要|应该|推荐|区别|多久|多大|多高|发力|要点|标准|注意|姿势|技巧|练法|正确|规范|细节|动作|热量|卡路里|卡|大卡|kcal|cal|千卡)/g;

function keywords(text: string): string {
  return text
    .replace(/[?？!！。，,、\s]+/g, ' ')
    .replace(FILLER, ' ')
    .trim();
}

/* ------------------------------ 食物 ------------------------------ */

interface FoodRow {
  name: string;
  aliases: string;
  kcal_100g: number;
  protein_100g: number;
  carb_100g: number;
  fat_100g: number;
  default_grams: number;
}

/** 带主食后缀的菜名（牛肉面 / 蛋炒饭）按主食基准来估，别拿「牛肉」的 250kcal 冒充一碗面 */
const BASE_DISH: Array<[RegExp, string]> = [
  [/面$/, '面条'],
  [/饭$/, '米饭'],
  [/粥$/, '粥'],
  [/粉$/, '面条'],
  [/包$/, '包子'],
  [/饼$/, '馒头'],
];

function findFood(token: string): FoodRow | null {
  if (!token) return null;
  const rows = getDb()
    .prepare('SELECT name, aliases, kcal_100g, protein_100g, carb_100g, fat_100g, default_grams FROM food_cache')
    .all() as unknown as FoodRow[];
  const base = BASE_DISH.find(([re]) => re.test(token))?.[1];
  if (base) {
    const hit = rows.find((r) => r.name === base);
    if (hit) return hit; // 数字按主食，标题里会说明
  }

  let best: FoodRow | null = null;
  let bestScore = 0;
  for (const r of rows) {
    const keys = [r.name, ...r.aliases.split(',').map((s) => s.trim())].filter(Boolean);
    for (const k of keys) {
      let score = 0;
      if (k === token) score = 100;
      else if (token.includes(k)) score = 50 + k.length * 4;
      else if (k.includes(token) && token.length >= 2) score = 30 + token.length * 4;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
  }
  return bestScore >= 54 ? best : null;
}

function answerFood(q: string, token: string): AskAnswer | null {
  const f = findFood(token);
  if (!f) return null;
  const grams = f.default_grams;
  const kcal = Math.round((f.kcal_100g * grams) / 100);
  const protein = Math.round(((f.protein_100g * grams) / 100) * 10) / 10;
  return {
    kind: 'food',
    question: q,
    text:
      f.name === token
        ? `${f.name} 约 ${Math.round(f.kcal_100g)} kcal/100g，常见 ${grams}g 一份大约 ${kcal} kcal、蛋白质 ${protein}g。数字来自内置食物库，是近似值。`
        : `你说的「${token}」库里没有单独条目，按最接近的「${f.name}」估：约 ${Math.round(f.kcal_100g)} kcal/100g，${grams}g 大约 ${kcal} kcal、蛋白质 ${protein}g。配料不同会差不少。`,
    facts: [
      { label: '每 100g', value: `${Math.round(f.kcal_100g)} kcal` },
      { label: `一份 ${grams}g`, value: `${kcal} kcal` },
      { label: '蛋白质', value: `${protein} g` },
    ],
    actions: [
      {
        id: 'log',
        label: '+ 记为今日饮食',
        text: `吃了${token}`,
        items: [
          {
            name: token,
            grams,
            kcal_100g: f.kcal_100g,
            protein_100g: f.protein_100g,
            carb_100g: f.carb_100g,
            fat_100g: f.fat_100g,
            matched: true,
          },
        ],
      },
    ],
  };
}

function answerBeefNoodles(question: string): AskAnswer {
  const noodles = FOODS.find((food) => food.name === '面条')!;
  const beef = FOODS.find((food) => food.name === '牛肉')!;
  const egg = FOODS.find((food) => food.name === '鸡蛋')!;
  const withEgg = /卤蛋|鸡蛋/.test(question);
  const grams = 240 + 110 + 11;
  const density = (noodleValue: number, beefValue: number, extra = 0) =>
    (noodleValue * 240 + beefValue * 110 + extra * 100) / grams;
  const items = [{
    name: '牛肉面', grams, matched: false,
    kcal_100g: density(noodles.kcal_100g, beef.kcal_100g, 11 * 9),
    protein_100g: density(noodles.protein_100g, beef.protein_100g),
    carb_100g: density(noodles.carb_100g, beef.carb_100g),
    fat_100g: density(noodles.fat_100g, beef.fat_100g, 11),
  }];
  const eggKcal = Math.round(egg.kcal_100g * egg.default_grams / 100);
  if (withEgg) items.push({ ...egg, name: '卤蛋', grams: egg.default_grams, matched: false });
  return {
    kind: 'food', question,
    text: withEgg
      ? `一碗牛肉面加一个卤蛋约 ${600 + eggKcal}–${680 + eggKcal} 千卡。卤蛋按普通鸡蛋估算，约增加 ${eggKcal} 千卡。`
      : '一碗牛肉面约 600–680 千卡。按约 240 克面条、110 克牛肉和汤底用油估算，面量和油量会影响结果。',
    facts: [],
    actions: [{ id: 'log', label: '+ 记为今日饮食', text: '吃了牛肉面', items }],
    followUps: withEgg ? undefined : [{ label: '加个卤蛋呢？', question: '一碗牛肉面加一个卤蛋大概多少大卡？' }],
  };
}

/* ------------------------------ 动作 ------------------------------ */

interface ExRow {
  id: string;
  name: string;
  zh_name: string;
  body_part: string;
  equipment: string;
  target: string;
  zh: string;
  zh_steps: string;
  image: string;
}

function findExercise(token: string): ExRow | null {
  if (!token || token.length < 2) return null;
  const db = getDb();
  const row = db
    .prepare(
      'SELECT id, name, zh_name, body_part, equipment, target, zh, zh_steps, image FROM exercise WHERE zh_name LIKE ? ORDER BY length(zh_name) ASC LIMIT 1',
    )
    .get(`%${token}%`) as ExRow | undefined;
  if (row) return row;
  const byBody = db
    .prepare(
      'SELECT id, name, zh_name, body_part, equipment, target, zh, zh_steps, image FROM exercise WHERE body_part = ? AND name NOT LIKE ? ORDER BY length(zh_name) ASC LIMIT 1',
    )
    .get(BODY_TO_PART[token] ?? '', '%stretch%') as ExRow | undefined;
  return byBody ?? null;
}

const BODY_TO_PART: Record<string, string> = {
  胸: 'chest',
  背: 'back',
  肩: 'shoulders',
  腿: 'upper legs',
  手臂: 'upper arms',
  核心: 'waist',
  腹: 'waist',
  臀: 'upper legs',
  有氧: 'cardio',
};

function answerExercise(q: string, token: string): AskAnswer | null {
  const ex = findExercise(token);
  if (!ex) return null;
  let steps: string[] = [];
  try {
    const parsed = JSON.parse(ex.zh_steps || '[]');
    if (Array.isArray(parsed)) steps = parsed.map(String);
  } catch {
    steps = [];
  }
  const first = steps.slice(0, 3);
  const target = TARGET_LABEL[ex.target] ?? ex.target;
  const equip = EQUIPMENT_LABEL[ex.equipment] ?? ex.equipment;
  const body = BODY_LABEL[ex.body_part] ?? ex.body_part;

  const text = first.length
    ? `${ex.zh_name}主要练${target}（${equip}）。要点：${first
        .map((s, i) => `${i + 1}) ${s.replace(/。$/, '')}`)
        .join('；')}。`
    : `${ex.zh_name}主要练${target}（${equip}）。这个动作暂时没有分步说明。`;

  return {
    kind: 'exercise',
    question: q,
    text,
    facts: [
      { label: '目标', value: target },
      { label: '器械', value: equip },
      { label: '部位', value: body },
    ],
    media: { id: ex.id, name: ex.zh_name || ex.name, image: ex.image },
    actions: [
      { id: 'plan', label: '+ 加入今日训练', exerciseId: ex.id },
      { id: 'log', label: '✓ 练了这个', text: `练了${ex.zh_name}` },
    ],
  };
}

/* ------------------------------ 我这周练了啥 ------------------------------ */

function answerStats(q: string): AskAnswer {
  const today = todayStr();
  const week = periodRange('week', today);
  const vol = volumeStats(week.start, week.end);
  const muscles = muscleStats(week.start, week.end).filter((m) => m.body_part);
  const a = dayText(week.start).label.split(' 周')[0];
  const b = dayText(week.end).label.split(' 周')[0];

  if (vol.days === 0) {
    return {
      kind: 'stats',
      question: q,
      text: `本周（${a} — ${b}）还没有训练记录。说一句「刚做了 20 分钟高位下拉」，我就记上了。`,
      facts: [],
      actions: [],
    };
  }

  const top = muscles
    .slice(0, 4)
    .map((m) => `${BODY_LABEL[m.body_part] ?? m.body_part} ${m.sets} 组`)
    .join('、');

  return {
    kind: 'stats',
    question: q,
    text: `本周（${a} — ${b}）练了 ${vol.days} 天、${vol.sessions} 次，共 ${vol.sets} 组、${vol.volume.toLocaleString('zh-CN')} kg 容量、${vol.durationMin} 分钟。练得最多的是：${top}。`,
    facts: [
      { label: '天数', value: `${vol.days} 天` },
      { label: '容量', value: `${vol.volume.toLocaleString('zh-CN')} kg` },
      { label: '时长', value: `${vol.durationMin} 分钟` },
      { label: '组数', value: `${vol.sets} 组` },
    ],
    actions: [],
  };
}

/* ------------------------------ 今天吃了多少 ------------------------------ */

function answerToday(q: string): AskAnswer {
  const snap = todaySnapshot();
  const target = snap.profile?.target_kcal ?? 0;
  const protein = Math.round(snap.consumed.protein);
  const meals = snap.meals.length + snap.quickMealCount;
  const pending = snap.pendingQuickMealItems ? `还有 ${snap.pendingQuickMealItems} 项热量待补。` : '';

  return {
    kind: 'today',
    question: q,
    text: (target
      ? `今天吃了 ${Math.round(snap.consumed.kcal)} kcal（${meals} 条饮食记录），蛋白质 ${protein}g；目标 ${target} kcal，还剩 ${snap.remainingKcal} kcal。`
      : `今天吃了 ${Math.round(snap.consumed.kcal)} kcal（${meals} 条饮食记录），蛋白质 ${protein}g。还没有填个人资料，所以算不出剩余额度。`) + pending,
    facts: [
      { label: '摄入', value: `${Math.round(snap.consumed.kcal)} kcal` },
      { label: '蛋白质', value: `${protein} g` },
      { label: '剩余', value: target ? `${snap.remainingKcal} kcal` : '—' },
    ],
    actions: [],
  };
}

/* ------------------------------ 入口 ------------------------------ */

export function answerQuestion(question: string): AskAnswer {
  const q = String(question ?? '').trim();
  const token = keywords(q);

  // 先看是不是问「吃了多少 / 还剩多少」
  if (/(今天|今日)/.test(q) && /(吃|摄入|热量|卡|剩|额度|蛋白)/.test(q)) {
    return answerToday(q);
  }
  if (/(这周|本周|上周|这个月|本月|最近)/.test(q) && /(练|训练|部位|肌肉|组|容量|几次|几天|多久)/.test(q)) {
    return answerStats(q);
  }
  if (/(练了哪|练哪|哪些部位|练了啥|练了什么|训练量|容量)/.test(q)) {
    return answerStats(q);
  }

  // 动作问题：带「怎么/发力/要点/怎么做/标准」或直接命中动作名
  if (/(怎么|怎样|如何|发力|要点|标准|注意|练哪|在哪)/.test(q)) {
    const ex = answerExercise(q, token);
    if (ex) return ex;
  }

  // 热量 / 营养问题
  if (/(热量|卡|kal|kcal|蛋白|碳水|脂肪|胖|减脂)/i.test(q)) {
    if (/牛肉面/.test(q) && /热量|大卡|千卡|kcal|卡路里/i.test(q)) return answerBeefNoodles(q);
    const food = answerFood(q, token);
    if (food) return food;
  }

  // 兜底：再按「是不是某个动作 / 某个食物」猜一次
  const ex = answerExercise(q, token);
  if (ex) return ex;
  const food = answerFood(q, token);
  if (food) return food;

  return {
    kind: 'unknown',
    question: q,
    text: `这个问题我还答不上来。可以问我：某种食物的热量、某个动作的要点、这周练了哪几块、今天还剩多少热量。`,
    facts: [],
    actions: [],
  };
}
