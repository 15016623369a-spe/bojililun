import { exercisePhrases } from './exercise-words';
import { mentionedMuscles, regionTrainingName, type QuickPayload, type TrainingExerciseRow } from './journal';
import { MUSCLES } from './muscles';

/**
 * 语音记录标准化：把纠错后的口述解析成结构化 JSON（动作表 / 食物表 / 睡眠字段 / 摘要），
 * 前端只渲染这份结构化结果，不再展示原话。
 */

export const FOOD_WORDS = [
  '牛肉面', '辣子鸡', '火锅', '卤蛋', '鸡胸肉', '蛋白粉', '燕麦', '米饭', '面条', '鸡蛋',
  '牛奶', '香蕉', '苹果', '面包', '沙拉', '三文鱼', '豆腐', '酸奶', '咖啡', '果汁',
  '馒头', '饺子', '包子', '红薯', '玉米', '牛肉', '鸡肉', '鱼肉', '蔬菜', '水果',
  '坚果', '奶酪', '全麦面包', '蛋白棒', '能量棒', '燕麦片', '小米粥', '白米饭',
].sort((a, b) => b.length - a.length);

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

function amountIn(window: string): string | undefined {
  const match = window.match(new RegExp(NUM + '\\s*(碗|两|份|杯|盘|根|块|克|g|斤|毫升|ml|勺|片|只|条|瓶|盒|个)'));
  if (!match) return undefined;
  const value = numOf(match[1]);
  return value === undefined ? undefined : `${value}${match[2]}`;
}

function parseMeal(source: string, detail: string, title: string): QuickPayload {
  const hits = occurrences(source, FOOD_WORDS);
  const items = hits.map((hit, index) => {
    const after = source.slice(hit.end, hits[index + 1]?.start ?? Math.min(source.length, hit.end + 10));
    const before = source.slice(Math.max(0, hit.start - 8), hit.start);
    return { name: hit.name, amount: amountIn(after) ?? amountIn(before) ?? '适量' };
  });
  if (!items.length) items.push({ name: detail || source, amount: '适量' });
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