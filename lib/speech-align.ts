import { pinyin } from 'pinyin-pro';

/**
 * 通用语音纠错：拼音模糊对齐。
 * 不枚举误识词，而是把语句中「动作/饮食提示词」之后的候选片段转成拼音，
 * 与领域词表做音节级编辑距离对齐（声母/韵母/声调混淆归组），
 * 相似度达标且双方音节被完整覆盖时才替换 —— 对任意动作的同音/近音误识都生效。
 */

const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
/** 声母混淆组（平翘舌、鼻边音、唇齿音、舌面音等 ASR/口音常见混淆） */
const INITIAL_GROUPS = [['zh', 'z'], ['ch', 'c'], ['sh', 's'], ['n', 'l'], ['r', 'l'], ['f', 'h'], ['j', 'q', 'x'], ['g', 'k'], ['d', 't'], ['b', 'p']];
/** 韵母混淆组（前后鼻音、u/ü、uo/o 等） */
const FINAL_GROUPS = [['en', 'eng'], ['in', 'ing'], ['an', 'ang'], ['uan', 'uang'], ['ian', 'iang'], ['u', 'v'], ['uo', 'o'], ['ong', 'eng'], ['ie', 've'], ['ei', 'ui']];
/** 候选片段边缘允许残留的语气/量词音节；数词只允许出现在片段开头（三个、五组），结尾残留会误吞同音字 */
const TAIL_FILLERS = new Set(['le', 'ge', 'zhe', 'na', 'yi', 'xia', 'wo', 'de', 'ya', 'a', 'ba', 'ma', 'ne', 'ou', 'er', 'me']);
const LEAD_FILLERS = new Set([...TAIL_FILLERS, 'san', 'si', 'wu', 'liu', 'qi', 'jiu', 'shi', 'liang', 'zu']);

const initialGroup = new Map<string, number>();
INITIAL_GROUPS.forEach((group, index) => group.forEach((item) => initialGroup.set(item, index)));
const finalGroup = new Map<string, number>();
FINAL_GROUPS.forEach((group, index) => group.forEach((item) => finalGroup.set(item, index)));

function splitSyllable(syllable: string): { initial: string; final: string } {
  const initial = INITIALS.find((item) => syllable.startsWith(item)) ?? '';
  return { initial, final: syllable.slice(initial.length) };
}

/** 音节模糊键：声母/韵母按混淆组归一化后的整音节串 */
function fuzzyKey(syllable: string): string {
  const { initial, final } = splitSyllable(syllable);
  const gi = initialGroup.get(initial);
  const gf = finalGroup.get(final);
  const ni = gi === undefined ? initial : `I${gi}`;
  const nf = gf === undefined ? final : `F${gf}`;
  return `${ni}|${nf}`;
}

function syllableSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (fuzzyKey(a) === fuzzyKey(b)) return 1;
  const pa = splitSyllable(a);
  const pb = splitSyllable(b);
  const gi = initialGroup.get(pa.initial);
  const gj = initialGroup.get(pb.initial);
  const sameInitial = pa.initial === pb.initial || (gi !== undefined && gi === gj);
  const fi = finalGroup.get(pa.final);
  const fj = finalGroup.get(pb.final);
  const sameFinal = pa.final === pb.final || (fi !== undefined && fi === fj);
  return sameInitial || sameFinal ? 0.5 : 0;
}

function syllablesOf(text: string): string[] {
  return pinyin(text, { toneType: 'none', type: 'array', v: true, nonZh: 'consecutive' })
    .map((item) => item.toLowerCase().replace(/\s+/g, ''));
}

interface VocabEntry { surface: string; syllables: string[]; keys: string[] }
interface Bucket { byCount: Map<number, Map<string, VocabEntry[]>>; keys: Set<string>; similar: Map<string, string[]> }

const bucketCache = new WeakMap<object, Bucket>();
function buildBucket(vocabulary: string[]): Bucket {
  const byCount = new Map<number, Map<string, VocabEntry[]>>();
  const keys = new Set<string>();
  for (const surface of vocabulary) {
    if (surface.length < 2) continue;
    const syllables = syllablesOf(surface);
    if (syllables.length < 2) continue;
    const entry: VocabEntry = { surface, syllables, keys: syllables.map(fuzzyKey) };
    keys.add(entry.keys[0]);
    let byKey = byCount.get(syllables.length);
    if (!byKey) { byKey = new Map(); byCount.set(syllables.length, byKey); }
    const list = byKey.get(entry.keys[0]);
    if (list) list.push(entry); else byKey.set(entry.keys[0], [entry]);
  }
  return { byCount, keys, similar: new Map() };
}

/** 与首音节模糊键相似的键集合（含自身）：共享声母组或韵母组即召回 */
function similarKeys(key: string, bucket: Bucket): string[] {
  const cached = bucket.similar.get(key);
  if (cached) return cached;
  const [ni, nf] = key.split('|');
  const out: string[] = [];
  for (const other of bucket.keys) {
    const [oi, of] = other.split('|');
    if (oi === ni || of === nf) out.push(other);
  }
  bucket.similar.set(key, out);
  return out;
}

/** 音节级编辑距离：替换代价 1-相似度，增删代价 0.9 */
function alignDistance(span: string[], vocab: string[]): number {
  const n = span.length;
  const m = vocab.length;
  let prev = Array.from({ length: m + 1 }, (_, j) => j * 0.9);
  for (let i = 1; i <= n; i++) {
    const cur = [i * 0.9];
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (1 - syllableSimilarity(span[i - 1], vocab[j - 1]));
      cur[j] = Math.min(sub, prev[j] + 0.9, cur[j - 1] + 0.9);
    }
    prev = cur;
  }
  return prev[m];
}

const THRESHOLD = 0.72;
/** 分数接近时优先完整同音音节更多的候选，避免动作库里的截断译名（如「哑铃翻」）抢走正确词 */
const SCORE_MARGIN = 0.08;

function overlapCount(a: string[], b: string[]): number {
  const counts = new Map<string, number>();
  for (const item of b) counts.set(item, (counts.get(item) ?? 0) + 1);
  let total = 0;
  for (const item of a) {
    const left = counts.get(item) ?? 0;
    if (left > 0) { total += 1; counts.set(item, left - 1); }
  }
  return total;
}

function bestMatch(spanSyllables: string[], bucket: Bucket): { surface: string; score: number; lead: number; tail: number } | undefined {
  const n = spanSyllables.length;
  if (n < 2) return undefined;
  // 召回键覆盖剥离边缘语气/数词后的首音节，避免「三个俯卧撑」里的「俯卧撑」漏召回
  const leadKeys = [fuzzyKey(spanSyllables[0])];
  for (let lead = 1; lead <= 2 && lead < n; lead++) {
    if (!LEAD_FILLERS.has(spanSyllables[lead - 1])) break;
    leadKeys.push(fuzzyKey(spanSyllables[lead]));
  }
  const candidates: VocabEntry[] = [];
  const seen = new Set<VocabEntry>();
  for (let count = Math.max(2, n - 3); count <= n + 1; count++) {
    const byKey = bucket.byCount.get(count);
    if (!byKey) continue;
    for (const firstKey of leadKeys) {
      for (const key of similarKeys(firstKey, bucket)) {
        for (const entry of byKey.get(key) ?? []) {
          if (!seen.has(entry)) { seen.add(entry); candidates.push(entry); }
        }
      }
    }
  }
  let best: { surface: string; score: number; lead: number; tail: number; overlap: number } | undefined;
  for (const entry of candidates) {
    // 边缘语气词残留允许剥离后再对齐
    for (let lead = 0; lead <= 2; lead++) {
      if (lead > 0 && !LEAD_FILLERS.has(spanSyllables[lead - 1])) break;
      for (let tail = 0; tail <= 2; tail++) {
        if (tail > 0 && !TAIL_FILLERS.has(spanSyllables[n - tail])) break;
        const trimmed = spanSyllables.slice(lead, n - tail);
        if (trimmed.length < 2 || Math.abs(trimmed.length - entry.syllables.length) > 1) continue;
        const distance = alignDistance(trimmed, entry.syllables);
        const score = 1 - distance / Math.max(trimmed.length, entry.syllables.length);
        if (score < THRESHOLD) continue;
        const overlap = overlapCount(trimmed, entry.syllables);
        const better = !best || score > best.score + SCORE_MARGIN
          || (Math.abs(score - best.score) <= SCORE_MARGIN && overlap > best.overlap)
          || (score === best.score && overlap === best.overlap
            && trimmed.length === entry.syllables.length && entry.surface.length < best.surface.length);
        if (better) best = { surface: entry.surface, score, lead, tail, overlap };
      }
    }
  }
  return best;
}

/** 提示词锚点：动作/饮食/部位表述之后的片段才参与拼音对齐，避免误改普通语句 */
const ANCHOR = /(?:做的是|做了|做过|做完|练了|练的是|练个|练一下|换成|改成|叫做|叫|吃了|喝了|吃|喝|加了|完成了|进行了|动作是|动作|还有|和|跟|是)/g;
const STOP = /[，,。！？!?、；;：:\s]/;
/** 片段右边界允许接续的字：语气/量词、连词、下一个动词；其余汉字视为词内续字，拒绝替换 */
const EDGE_NEXT = new Set(['了', '个', '这', '那', '一', '下', '我', '的', '呀', '啊', '吧', '吗', '呢', '哦', '么', '和', '跟', '与', '及', '还', '做', '练', '吃', '喝', '换', '改', '叫', '加', '完', '进', '是',
  '两', '三', '四', '五', '六', '七', '八', '九', '十']);

export function phoneticFix(text: string, vocabulary: string[]): string {
  if (!text || text.length > 200) return text;
  let bucket = bucketCache.get(vocabulary);
  if (!bucket) { bucket = buildBucket(vocabulary); bucketCache.set(vocabulary, bucket); }
  const syllables = syllablesOf(text);
  const chars = [...text];
  if (syllables.length !== chars.length) return text; // 含数字/字母连续串时不做拼音对齐，保守返回
  const replacements: Array<{ start: number; end: number; surface: string }> = [];
  ANCHOR.lastIndex = 0;
  let anchor: RegExpExecArray | null;
  while ((anchor = ANCHOR.exec(text))) {
    const from = anchor.index + anchor[0].length;
    for (let length = Math.min(10, chars.length - from); length >= 2; length--) {
      const end = from + length;
      if (STOP.test(chars[end - 1])) continue;
      const next = chars[end];
      if (next !== undefined && !STOP.test(next) && !EDGE_NEXT.has(next)) continue;
      if (replacements.some((r) => from < r.end && end > r.start)) continue;
      const match = bestMatch(syllables.slice(from, end), bucket);
      if (!match) continue;
      // 只替换对齐命中的核心片段，边缘语气/数词原样保留；原文已正确时不动
      const start = from + match.lead;
      const stop = end - match.tail;
      if (match.surface === text.slice(start, stop)) continue;
      replacements.push({ start, end: stop, surface: match.surface });
      break; // 最长优先，命中后不再试更短片段
    }
  }
  if (!replacements.length) return text;
  let out = text;
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, r.start) + r.surface + out.slice(r.end);
  }
  return out;
}