/**
 * 「说一句话就记账」的解析器 —— 纯函数，不碰数据库。
 * 只负责把中文口语拆成「训练 / 饮食 + 时长 + 条目」，
 * 具体匹配动作库、食物库、写库都在 lib/log.ts 里做。
 */

import type { MealType } from './date';

export interface ParsedTraining {
  kind: 'training';
  minutes: number;
  tokens: string[];
}

export interface ParsedMeal {
  kind: 'meal';
  mealType: MealType | null;
  tokens: string[];
}

export type ParsedLog = ParsedTraining | ParsedMeal;

const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

const TRAINING_RE = /(练|训练|撸铁|健身|运动|做|跑|骑|游|拉伸|打球|爬楼|跳绳)/;
const MEAL_RE = /(吃|喝|餐|饭|加餐|零食|宵夜|夜宵|早餐|午餐|晚餐)/;

const MEAL_HINT: Array<{ re: RegExp; type: MealType }> = [
  { re: /(早餐|早饭|早上吃|早晨)/, type: 'breakfast' },
  { re: /(午餐|午饭|中午吃)/, type: 'lunch' },
  { re: /(晚餐|晚饭|晚上吃)/, type: 'dinner' },
  { re: /(加餐|宵夜|夜宵|零食|下午茶)/, type: 'snack' },
];

/** 抽出时长（分钟）。支持「20 分钟」「半小时」「一个半小时」「1h」 */
export function extractMinutes(text: string): number {
  let minutes = 0;

  const half = /(一个半|1\.5|一又二分之一)\s*(小时|h|钟头)/.exec(text);
  if (half) minutes = 90;

  if (!minutes) {
    const hour = /(\d+|一|两|二|三)\s*(?:个)?\s*(小时|钟头|h\b)/.exec(text);
    if (hour) {
      const raw = hour[1];
      const n = /^\d+$/.test(raw) ? Number(raw) : (CN_NUM[raw] ?? 0);
      if (n) minutes = n * 60;
    }
  }

  if (!minutes) {
    const m = /(\d+(?:\.\d+)?)\s*(?:分钟|分|min)/.exec(text);
    if (m) minutes = Math.round(Number(m[1]));
  }

  if (!minutes && /(半小时|半个小时|30\s*min)/.test(text)) minutes = 30;

  return Math.min(600, Math.max(0, minutes));
}

/** 去掉语气、时间、数量等噪声 */
function cleanToken(raw: string): string {
  return raw
    .replace(/^(刚|刚刚|今天|今晚|昨天|晚上|下午|早上|上午|中午|夜里|我|又)+/g, '')
    .replace(/(一共|总共|大概|大约|左右|多|整|的|了|练|做|训练)+$/g, '')
    .replace(/^(练了|做了|搞了|整了|去了)+/g, '')
    .replace(/[\s。！!？?~～]+/g, '')
    .trim();
}

function splitTokens(text: string): string[] {
  return text
    .split(/[、,，;；+＋/]|和|跟|与|还有|以及|然后|再加|加上|\s+/)
    .map(cleanToken)
    .filter((t) => t.length > 0 && t.length < 16 && !/^(分钟|小时|个|组|次|下|趟)$/.test(t));
}

/** 把一句话解析成训练或饮食；判断不了时默认当饮食（更常见的场景） */
export function parseLog(input: string): ParsedLog {
  const text = String(input ?? '').trim();
  const minutes = extractMinutes(text);

  const trainingHit = TRAINING_RE.test(text);
  const mealHit = MEAL_RE.test(text);
  // 带「组数 / 重量 / 5×5」的说法，即使没有「练了」也是训练
  const volume = parseVolume(text);
  const hasVolume = volume.sets !== undefined || volume.weight !== undefined;

  const mealType = MEAL_HINT.find((h) => h.re.test(text))?.type ?? null;

  // 明确提到“吃/喝/餐”，且没提时长 → 饮食
  if (mealHit && !minutes) {
    return { kind: 'meal', mealType, tokens: splitTokens(stripMealWords(text)) };
  }

  if (trainingHit || minutes || hasVolume) {
    const body = stripTrainingWords(text);
    // 「4 组 12 次 60 公斤」会被空格拆成碎词，这里只留下动作名
    const tokens = splitTokens(body).filter(
      (t) => stripVolume(t).length > 0 && !/^(\d+(?:\.\d+)?|组|次|个|公斤|千克|斤|kg|reps?|sets?)$/i.test(t),
    );
    // 全是“训练/健身”这种空词时，退回按饮食处理
    if (tokens.length === 0 && mealHit) {
      return { kind: 'meal', mealType, tokens: splitTokens(stripMealWords(text)) };
    }
    return { kind: 'training', minutes, tokens };
  }

  return { kind: 'meal', mealType, tokens: splitTokens(stripMealWords(text)) };
}

function stripTrainingWords(text: string): string {
  return text
    .replace(/(刚|刚刚|今天|今晚|晚上|下午|早上|上午|中午|刚才)/g, '')
    .replace(/(\d+(?:\.\d+)?|一|两|二|三|半)\s*(?:个)?\s*(个)?\s*(小时|钟头|分钟|min)/g, '')
    .replace(/(一个半|半小时|半个小时)/g, '')
    .replace(/(又|一共|总共|大概|大约|左右)/g, '')
    .replace(/(练了|做了|搞了|整了|去了|练|训练|撸铁|健身|运动|了|个动作|的动作)/g, '');
}

function stripMealWords(text: string): string {
  return text
    .replace(/(刚|刚刚|今天|今晚|晚上|下午|早上|上午|中午|刚才|我)/g, '')
    .replace(/(早饭|早餐|午饭|午餐|晚饭|晚餐|加餐|宵夜|夜宵|吃的|吃了|喝了|吃|喝|来了|点了|煮了)/g, '、')
    .replace(/(一份|一个|一碗|一杯|一瓶|一根|一袋|半份|半碗|两瓶|两个|两碗)/g, '')
    .replace(/(的|了|左右)/g, '');
}


/* ------------------------------ 组数 / 次数 / 重量 ------------------------------ */

export interface VolumeSpec {
  sets?: number;
  reps?: number;
  weight?: number;
}

/** 从一句话里抽「几组、几次、多重」，支持 4组12次60公斤 / 4×12 / 60kg / 60斤 */
export function parseVolume(text: string): VolumeSpec {
  const t = String(text ?? '');
  const out: VolumeSpec = {};

  const sets = /(\d+)\s*(?:组|sets?)/i.exec(t);
  if (sets) out.sets = Number(sets[1]);

  const reps = /(\d+)\s*(?:次|个|reps?)/i.exec(t);
  if (reps) out.reps = Number(reps[1]);

  const kg = /(\d+(?:\.\d+)?)\s*(kg|公斤|千克|斤)/i.exec(t);
  if (kg) out.weight = kg[2] === '斤' ? Number(kg[1]) / 2 : Number(kg[1]);

  const times = /(\d+)\s*[×xX*]\s*(\d+)/.exec(t);
  if (times) {
    if (out.sets === undefined) out.sets = Number(times[1]);
    if (out.reps === undefined) out.reps = Number(times[2]);
  }

  return out;
}

/** 去掉「4 组 12 次 60kg」这类量，剩下的才是动作名 */
export function stripVolume(text: string): string {
  return text
    .replace(/(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+)/g, '')
    .replace(/(\d+(?:\.\d+)?)\s*(?:组|次|个|kg|公斤|千克|斤)/gi, '')
    .trim();
}
