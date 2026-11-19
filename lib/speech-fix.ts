import { exercisePhrases } from './exercise-words';
import { FOOD_WORDS } from './quick-parse';
import { phoneticFix } from './speech-align';

/**
 * 语音识别（ASR）领域纠错。
 * 多音节词不再枚举误识写法：统一交给拼音模糊对齐引擎（speech-align），
 * 对动作库/部位/饮食词表做音节级相似度匹配，任意同音近音误识都能纠正。
 * 这里只保留单音节部位同音字（拼音太短无法可靠对齐）与句首口头禅清理。
 */

/** 单音节部位同音字：练个熊→练胸 等，日常语境几乎不成立 */
const MONO_FIXES: Array<[RegExp, string]> = [
  [/练个?熊/g, '练胸'], [/熊部/g, '胸部'], [/推熊/g, '推胸'], [/夹熊/g, '夹胸'], [/上熊/g, '上胸'],
  [/练个?杯/g, '练背'], [/练个?被/g, '练背'],
  [/练个?尖/g, '练肩'], [/练个?间/g, '练肩'],
  [/练个?退/g, '练腿'], [/练个?屯/g, '练臀'], [/练个?富/g, '练腹'],
  [/我推(?=\s*\d)/g, '卧推'],
];

const MUSCLE_WORDS = [
  '胸部', '背部', '肩部', '腿部', '臀部', '腹部', '上胸', '下胸', '上背', '下背',
  '三头', '二头', '背阔', '胸肌', '腹肌', '臀肌', '三角肌', '斜方肌', '二头肌', '三头肌',
];

let vocabulary: string[] | undefined;
function domainVocabulary(): string[] {
  if (!vocabulary) vocabulary = [...exercisePhrases(), ...MUSCLE_WORDS, ...FOOD_WORDS];
  return vocabulary;
}

/** 口语赘词：只清理句首的口头禅，不动句中内容 */
const FILLER_PREFIX = /^(?:(?:嗯|呃|啊|欸|那个|就是|然后|喂)[，,、\s啊呀]*)+/;

export function fixSpeechText(raw: string): string {
  let text = raw.trim();
  text = text.replace(FILLER_PREFIX, '');
  for (const [pattern, fixed] of MONO_FIXES) text = text.replace(pattern, fixed);
  return phoneticFix(text, domainVocabulary());
}