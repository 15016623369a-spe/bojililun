import { getDb } from './db';

/** 健身动作通用词（动作库未覆盖时的兜底）。 */
export const EXERCISE_TERMS = [
  '引体向上', '平板支撑', '臂屈伸', '侧平举', '俯卧撑', '卧推', '深蹲', '硬拉', '划船', '下拉',
  '推举', '飞鸟', '弯举', '卷腹', '腿举', '臀推', '臀桥', '跑步', '骑车', '游泳',
].sort((a, b) => b.length - a.length);

export const EQUIPMENT_PREFIXES = ['杠铃', '哑铃', '弹力带', '绳索', '器械', '壶铃', '史密斯', '曲杆', '拉力器', '自重', '双杠'];
export const VARIANT_PREFIXES = ['上斜', '下斜', '反握', '窄握', '宽握', '弓箭手', '跪姿', '跑姿', '单臂', '双臂', '交替', '相扑', '罗马尼亚', '保加利亚', '分腿', '箱式'];

/** 口语常用别名 → 动作库标准名：动作库未收录「蝴蝶机夹胸」等叫法时，纠错与替换候选仍能落到真实动作。 */
export const EXERCISE_ALIASES: Record<string, string> = {
  蝴蝶机夹胸: '器械坐姿飞鸟',
  蝴蝶机飞鸟: '器械坐姿飞鸟',
  蝴蝶机: '器械坐姿飞鸟',
  器械夹胸: '器械坐姿飞鸟',
  坐姿夹胸: '器械坐姿飞鸟',
  夹胸器: '器械坐姿飞鸟',
  绳索夹胸: '绳索交叉夹胸变式',
  龙门架夹胸: '绳索交叉夹胸变式',
  拉力器夹胸: '绳索交叉夹胸变式',
  哑铃夹胸: '哑铃飞鸟',
  夹胸: '器械坐姿飞鸟',
};

export const canonicalExercise = (phrase: string): string => EXERCISE_ALIASES[phrase] ?? phrase;

function stripPrefixes(name: string, prefixes: string[]): { core: string; prefix: string } {
  let core = name;
  let prefix = '';
  for (;;) {
    const hit = prefixes.find((item) => core.startsWith(item) && core.length > item.length);
    if (!hit) break;
    if (!prefix) prefix = hit;
    core = core.slice(hit.length);
  }
  return { core, prefix };
}
export const coreOf = (name: string) => stripPrefixes(name, EQUIPMENT_PREFIXES).core;
export const prefixOf = (name: string) => stripPrefixes(name, EQUIPMENT_PREFIXES).prefix;
export const rootOf = (name: string) => stripPrefixes(coreOf(name), VARIANT_PREFIXES).core;

/** 语音动作词表：动作库全名 + 去掉器械前缀的核心名 + 通用动作词，长词优先，保证「上斜卧推」不会被截成「卧推」。 */
let phraseVocabulary: string[] | undefined;
export function exercisePhrases(): string[] {
  if (!phraseVocabulary) {
    const rows = getDb().prepare('SELECT zh_name FROM exercise').all() as unknown as Array<{ zh_name: string }>;
    const set = new Set<string>(EXERCISE_TERMS);
    for (const alias of Object.keys(EXERCISE_ALIASES)) set.add(alias);
    // 器械/变体 × 通用动作根的组合（杠铃深蹲、上斜卧推…）：口语常用而动作库全名带额外修饰
    for (const prefix of [...EQUIPMENT_PREFIXES, ...VARIANT_PREFIXES]) {
      for (const term of EXERCISE_TERMS) set.add(prefix + term);
    }
    for (const { zh_name } of rows) {
      if (!zh_name) continue;
      set.add(zh_name);
      const core = coreOf(zh_name);
      if (core.length >= 2) set.add(core);
      // 器械+动作根（杠铃深蹲、杠铃划船）：动作库全名常带额外修饰，口语只说器械+根
      const prefix = prefixOf(zh_name);
      const root = rootOf(zh_name);
      if (prefix && root.length >= 2) set.add(prefix + root);
    }
    phraseVocabulary = [...set].sort((a, b) => b.length - a.length);
  }
  return phraseVocabulary;
}

export function spokenExercisePhrase(source: string): string | undefined {
  return exercisePhrases().find((phrase) => source.includes(phrase));
}