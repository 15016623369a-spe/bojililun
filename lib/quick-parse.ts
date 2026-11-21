import { exercisePhrases } from './exercise-words';
import { foodAliases, FOODS } from './foods';
import { mentionedMuscles, regionTrainingName, type JournalMealItem, type QuickPayload, type TrainingExerciseRow } from './journal';
import { MUSCLES } from './muscles';
import { macrosFor } from './nutrition';

/**
 * 语音记录标准化：把纠错后的口述解析成结构化 JSON（动作表 / 食物表 / 睡眠字段 / 摘要），
 * 前端只渲染这份结构化结果，不再展示原话。
 */

const FOOD_BY_NAME = new Map(FOODS.flatMap((food) =>
  foodAliases(food).map((name) => [name.toLowerCase(), food] as const)));
// 咖啡可能是黑咖啡，也可能加奶。要求明确品种，避免按拿铁估算。
FOOD_BY_NAME.delete('咖啡');
FOOD_BY_NAME.delete('美式');

export const FOOD_WORDS = [...new Set([
  '牛肉面', '辣子鸡', '火锅', '卤蛋', '鸡胸肉', '蛋白粉', '燕麦', '米饭', '面条', '鸡蛋',
  '牛奶', '香蕉', '苹果', '面包', '沙拉', '三文鱼', '豆腐', '酸奶', '咖啡', '果汁',
  '馒头', '饺子', '包子', '红薯', '玉米', '牛肉', '鸡肉', '鱼肉', '蔬菜', '水果',
  '坚果', '奶酪', '全麦面包', '蛋白棒', '能量棒', '燕麦片', '小米粥', '白米饭',
  ...[...FOOD_BY_NAME.keys()].filter((name) => name.length >= 2),
])].sort((a, b) => b.length - a.length);

const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const NUM = '(\\d+(?:\\.\\d+)?|[一二两三四五六七八九十半]+)';

export function numOf(raw: string): number | undefined {
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === '半') return 0.5;
  if (raw === '十') return 10;
  const compound = raw.match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/);
  if (compound) return (compound[1] ? CN_DIGIT[compound[1]] : 1) * 10 + (compound[2] ? CN_DIGIT[compound[2]] : 0);
  return CN_DIGIT[raw];
}

function numOfMatch(text: string, pattern: string): number | undefined {
  const match = text.match(new RegExp(pattern));
  return match ? numOf(match[1]) : undefined;
}

/** 词表命中区间：长词优先、互不重叠，按出现顺序返回 */
function occurrences(text: string, words: string[]): Array<{ name: string; start: number; end: number }> {
  const claimed: Array<{ name: string; start: number; end: number }> = [];
  for (const word of words) {
    let from = 0;
    for (;;) {
      const index = text.indexOf(word, from);
      if (index < 0) break;
      const end = index + word.length;
      if (!claimed.some((item) => index < item.end && end > item.start)) claimed.push({ name: word, start: index, end });
      from = index + 1;
    }
  }
  return claimed.sort((a, b) => a.start - b.start);
}

function regionsOf(text: string): string[] {
  const ids = new Set(mentionedMuscles(text));
  return [...new Set(MUSCLES.filter((muscle) => ids.has(muscle.id)).map((muscle) => muscle.region))];
}

const PLANNED = /打算|计划|准备|想要|明天/;

function parseTraining(source: string, detail: string): QuickPayload {
  const hits = occurrences(source, exercisePhrases());
  const exercises: TrainingExerciseRow[] = hits.map((hit, index) => {
    const after = source.slice(hit.end, hits[index + 1]?.start ?? Math.min(source.length, hit.end + 14));
    const before = source.slice(Math.max(0, hit.start - 8), hit.start);
    const sets = numOfMatch(after, NUM + '\\s*组') ?? numOfMatch(before, NUM + '\\s*组');
    const reps = numOfMatch(after, NUM + '\\s*(?:次|个)');
    const weight = numOfMatch(after, NUM + '\\s*(?:公斤|千克|kg)') ?? numOfMatch(before, NUM + '\\s*(?:公斤|千克|kg)');
    const minutes = numOfMatch(after, NUM + '\\s*分钟');
    const seconds = numOfMatch(after, NUM + '\\s*秒');
    return {
      name: hit.name,
      sets,
      reps: reps === undefined ? undefined : String(reps),
      weight: weight === undefined || weight === 0 ? undefined : `${weight} kg`,
      duration: minutes ? `${minutes} 分钟` : seconds ? `${seconds} 秒` : undefined,
    };
  });
  const regions = regionsOf(source);
  if (!exercises.length && regions.length) {
    for (const region of regions) exercises.push({ name: regionTrainingName(region) });
  }
  return {
    kind: 'training',
    planned: PLANNED.test(source) || undefined,
    regions,
    exercises,
    summary: exercises.length ? undefined : detail,
  };
}

const MEAL_NUM = '(\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千]+|半)';
const MEAL_UNIT = '(千克|公斤|kg|毫升|ml|克|g|斤|两|碗|份|杯|盘|根|块|勺|片|只|条|瓶|盒|个)';
const FOOD_PATTERN = `(${FOOD_WORDS.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
const QUANTITY = `${MEAL_NUM}\\s*${MEAL_UNIT}`;

export function looksLikeMeal(text: string): boolean {
  return FOOD_BY_NAME.has(text.toLowerCase()) || new RegExp(
    `^(?:${QUANTITY}\\s*${FOOD_PATTERN}|${FOOD_PATTERN}\\s*${QUANTITY})(?:$|[、，,；;]|和|还有)`, 'i',
  ).test(text);
}

function mealNumber(raw: string): number | undefined {
  const simple = numOf(raw);
  if (simple !== undefined) return simple;
  const match = raw.match(/^(?:([一二两三四五六七八九])千)?(?:([一二两三四五六七八九])百)?([零〇]?[一二两三四五六七八九十]*)$/);
  if (!match || (!match[1] && !match[2])) return undefined;
  const rest = match[3].replace(/^[零〇]/, '');
  const tail = rest ? numOf(rest) : 0;
  if (tail === undefined) return undefined;
  // 口语「一百五」等价于 150，「一百零五」等价于 105。
  const place = rest.length === 1 && !/^[零〇]|十/.test(match[3])
    ? (match[2] ? 10 : 100) : 1;
  return (CN_DIGIT[match[1]] ?? 0) * 1000 + (CN_DIGIT[match[2]] ?? 0) * 100 + tail * place;
}

const WEIGHT_IN_GRAMS: Record<string, number> = { 克: 1, g: 1, 千克: 1000, 公斤: 1000, kg: 1000, 斤: 500, 两: 50 };
const DRINKS = new Set(['牛奶', '拿铁', '可乐']);
const PORTION_UNITS: Record<string, string[]> = {
  米饭: ['碗'], 炒饭: ['碗', '份'], 面条: ['碗', '份'], 粥: ['碗'],
  鸡蛋: ['个', '只'], 香蕉: ['根'], 苹果: ['个'], 馒头: ['个'],
  包子: ['个'], 牛奶: ['杯'], 拿铁: ['杯'], 蛋白粉: ['勺'],
};

export function estimateQuickMealItem(item: JournalMealItem): JournalMealItem {
  const food = FOOD_BY_NAME.get(item.name.trim().toLowerCase());
  const base = { ...item, nutrition: undefined, estimatedGrams: undefined, nutritionIssue: undefined };
  if (!food) return { ...base, nutritionIssue: 'food' };
  const amount = item.amount.trim().toLowerCase();
  const match = amount.match(new RegExp(`^${MEAL_NUM}\\s*${MEAL_UNIT}?$`));
  const count = match && mealNumber(match[1]);
  if (!count || !match) return { ...base, nutritionIssue: 'amount' };
  const unit = match[2] ?? 'g';
  const estimated = !(unit in WEIGHT_IN_GRAMS);
  const factor = WEIGHT_IN_GRAMS[unit]
    ?? (DRINKS.has(food.name) && /^(毫升|ml)$/.test(unit) ? 1 : undefined)
    ?? (PORTION_UNITS[food.name]?.includes(unit) ? food.default_grams : undefined);
  const grams = count * (factor ?? 0);
  if (grams <= 0 || grams > 20_000) return { ...base, nutritionIssue: 'amount' };
  return {
    ...base,
    estimatedGrams: estimated ? grams : undefined,
    nutrition: macrosFor(grams, {
      kcal: food.kcal_100g, protein: food.protein_100g, carb: food.carb_100g, fat: food.fat_100g,
    }),
  };
}

function withQuickMealNutrition(payload: QuickPayload): QuickPayload {
  if (payload.kind !== 'meal' || !payload.items) return payload;
  return {
    ...payload,
    items: payload.items.map((item) => item.nutrition || item.nutritionIssue ? item : estimateQuickMealItem(item)),
  };
}

function adjacentMealItems(text: string, quantityFirst: boolean): JournalMealItem[] {
  const pattern = new RegExp(
    quantityFirst ? `\\s*${QUANTITY}\\s*${FOOD_PATTERN}` : `\\s*${FOOD_PATTERN}\\s*${QUANTITY}`, 'iy',
  );
  const items: JournalMealItem[] = [];
  while (pattern.lastIndex < text.length) {
    const match = pattern.exec(text);
    if (!match) return [];
    const [, name, number, unit] = quantityFirst ? [match[0], match[3], match[1], match[2]] : match;
    items.push(estimateQuickMealItem({ name, amount: number + unit }));
  }
  return items;
}

function parseMeal(source: string, detail: string, title: string): QuickPayload {
  const items = detail.split(/[、，,；;。+＋]|(?:还|又)(?:吃|喝)了?|以及|还有|和|跟|加上|加(?=[\d一二两三四五六七八九十半个份碗杯])/
  ).flatMap((part) => {
    const clean = part.trim()
      .replace(/^(?:(?:明天|早餐|午餐|晚餐|晚饭|午饭|早饭|夜宵|加餐|打算|计划|准备|想要|我|吃了?|喝了?|大约|大概|差不多|约)[\s：:]*)+/, '')
      .replace(/(?:左右|大概|大约)$/, '').trim();
    if (!clean) return [];
    const adjacent = adjacentMealItems(clean, true);
    if (adjacent.length) return adjacent;
    const suffixed = adjacentMealItems(clean, false);
    if (suffixed.length) return suffixed;

    // 有不认识的菜名时，保留该段菜名和分量，供用户修改。
    const leading = clean.match(new RegExp(`^${MEAL_NUM}\\s*${MEAL_UNIT}\\s*(?:的)?(.+)$`, 'i'));
    const trailing = clean.match(new RegExp(`^(.+?)\\s*(?:约|大约|大概)?${MEAL_NUM}\\s*${MEAL_UNIT}$`, 'i'));
    if (leading) return [estimateQuickMealItem({ name: leading[3].trim(), amount: leading[1] + leading[2] })];
    if (trailing) return [estimateQuickMealItem({ name: trailing[1].trim(), amount: trailing[2] + trailing[3] })];
    return [estimateQuickMealItem({ name: clean, amount: '未填写' })];
  });
  if (!items.length) items.push(estimateQuickMealItem({ name: detail || source, amount: '未填写' }));
  return { kind: 'meal', planned: PLANNED.test(source) || undefined, mealType: title, items };
}

function clockOf(match: RegExpMatchArray): string {
  let hour = numOf(match[1]) ?? 0;
  if (/^(晚上|昨晚|夜里)/.test(match[0]) && hour < 12) hour += 12;
  const minute = match[2] === '半' ? 30 : match[2] ? numOf(match[2]) ?? 0 : 0;
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

function parseSleep(source: string, detail: string): QuickPayload {
  const hours = numOfMatch(source, NUM + '\\s*(?:个)?(?:小时|钟头)');
  const minutes = numOfMatch(source, NUM + '\\s*分钟');
  const duration = hours ? `${hours} 小时${minutes ? ` ${minutes} 分钟` : ''}` : minutes ? `${minutes} 分钟` : undefined;
  const bed = source.match(new RegExp('(?:晚上|昨晚|夜里|凌晨)?\\s*' + NUM + '\\s*点\\s*(半|' + NUM + '分)?\\s*(?:睡|入睡|上床)'));
  const wake = source.match(new RegExp(NUM + '\\s*点\\s*(半|' + NUM + '分)?\\s*(?:醒|起床)'));
  const quality = /失眠|睡不着|入睡困难/.test(source) ? '入睡困难'
    : /易醒|不踏实|很浅/.test(source) ? '易醒'
      : /很香|质量好|深度睡眠|睡得好/.test(source) ? '质量较好' : undefined;
  const sleep = {
    duration,
    bedtime: bed ? clockOf(bed) : undefined,
    wake: wake ? clockOf(wake) : undefined,
    quality,
  };
  const has = Object.values(sleep).some(Boolean);
  return { kind: 'sleep', sleep: has ? sleep : undefined, summary: has ? undefined : detail };
}

export function parseQuickPayload(source: string, kind: QuickPayload['kind'], detail: string, title = ''): QuickPayload {
  if (kind === 'training') return parseTraining(source, detail);
  if (kind === 'meal') return parseMeal(source, detail, title);
  if (kind === 'sleep') return parseSleep(source, detail);
  return { kind: 'note', summary: detail || source };
}

export function readQuickPayload(row: {
  payload_json: string | null;
  source_text: string;
  kind: QuickPayload['kind'];
  detail: string;
  title: string;
}): QuickPayload {
  if (row.payload_json) {
    try { return withQuickMealNutrition(JSON.parse(row.payload_json) as QuickPayload); } catch { /* 损坏时重新解析 */ }
  }
  return parseQuickPayload(row.source_text, row.kind, row.detail, row.title);
}
