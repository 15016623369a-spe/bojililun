import { estimateNutrition } from './ledger-nutrition';
import { parseSchema, validateParse } from './ledger-contract';
import foods from '../data/food-reference.json';
import dictionary from '../data/exercises-seed.json';
import { detectIntent } from './intent';
import type { Draft, Parsed, Source } from './ledger';
import type { Item } from './calculations';
function explicitScaleWeight(text: string): number | null {
  // Only apply to single-item records and explicit statements about how the weight was measured.
  if (!/下锅前|烹调前|带骨重量|帶骨重量|生重|熟重|净重|淨重/.test(text)) return null;
  const grams = new Set(
    Array.from(
      text.matchAll(/(\d+(?:\.\d+)?)\s*(千克|公斤|kg|克|g|斤)(?![a-z])/gi),
      ([, value, unit]) => Number(value) * (/kg|千克|公斤/i.test(unit) ? 1000 : unit === '斤' ? 500 : 1),
    ),
  );
  return grams.size === 1 ? [...grams][0] : null;
}

export async function parseInput(text: string, photo: string | undefined, source: Source): Promise<Parsed> {
  const note = text.match(/(?:备注[：:]?)([^，,。；;]+)/)?.[1]?.trim() ?? null;
  const base = {
    logged_at: new Date().toISOString(),
    confidence: 'estimated' as const,
    raw_text: text || null,
    note,
    feeling_tags: ['有点力竭', '轻松', '疲劳'].filter((tag) => text.includes(tag)),
  };
  const compatible =
    process.env.AI_API_KEY && ['openai', 'compatible'].includes(process.env.AI_PROVIDER ?? '');
  const deepseek = !compatible && !photo && process.env.DEEPSEEK_API_KEY;
  if (compatible || deepseek) {
    try {
      const url = deepseek
        ? 'https://api.deepseek.com'
        : process.env.AI_BASE_URL || 'https://api.openai.com/v1';
      const key = deepseek || process.env.AI_API_KEY;
      const model = deepseek
        ? process.env.DEEPSEEK_MODEL || 'deepseek-chat'
        : process.env.AI_MODEL || 'gpt-4o-mini';
      const content: unknown[] = [{ type: 'text', text: text || '记录图中的食物或训练' }];
      if (photo) content.push({ type: 'image_url', image_url: { url: photo } });
      const res = await fetch(url.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `输出 JSON，提问返回 {route:"qa",question}，陈述返回 {route:"record",records:[...]}，混合吃练称重要拆多条。每条含 entry_type(meal/workout/body_metrics/plan_draft),summary_title,note,feeling_tags,confidence(exact/estimated)。饮食 items 含 food_name（净食材名，例如鸡腿肉）、food_state(raw/cooked/unknown，以所报重量称量时状态为准)、weight_basis(bone_in/edible/unknown)、portion_text、estimated_grams（用户报的原始重量，不提前扣骨）、kcal整数,protein_g,carbs_g,fat_g,confidence。估算只限单项，未知用null。训练 exercises:[{exercise_name,sets:[{weight_kg,reps,duration_sec}]}]，未报组数 sets:[]，勿猜测。体征 weight_kg,body_fat_pct。note 由用户维护，返回 null。做法和估算依据只写对应食物的 portion_text，不为“没吃别的”建食物项。区分做饭用料与实际吃下的重量：例如用500克鸡肉煲汤、撇去浮油，应记鸡肉汤一份，把原料重量和撇油写入对应食物的 portion_text；食物可辨认时，请你根据用户原话、做法和常见食用份量，对每一项实际摄入的克数、蛋白、碳水、脂肪、千卡给出最合理的单点估计。未说明份量时在portion_text写明“暂按…”的假设，整项标estimated。只提到喝汤时按喝下的汤估算，不把整锅肉算进去；提到也吃了肉才计入肉。用户提供包装标注或实测数据时优先保留。只有无法辨认食物或无法合理假设时留null。不要把用户觉得脂肪少写成确切脂肪数。纯照片将描述放raw_text。结构必须符合：${JSON.stringify(parseSchema)}。可选 quick_pick：每张只问一个明确的高影响歧义，用户已经说明时不要追问。默认假设填写到 items，记录先保存。饮食选项必须有2-4个具体标签，使用 kind=meal，edits 仅改已有 item_index（从0开始）的 measured_grams、food_state、weight_basis，可传 [] 表示该项就是默认；服务端会加跳过。若歧义涉及混合餐总重，先拆为可计算食材（鸡肉、牛肉、米饭等），给每种解释对应的各食材克数，别把同一个500克分配给每种食材。例如“500克鸡肉做的鸡肉牛肉饭”，问“500克指鸡肉还是整份饭？”，给“500克指鸡肉”和“500克是整份饭”两项，整份饭解释里各食材的克数合计500。饮品糖度或是否喝汤可把糖或汤作为独立明细，用克数（0=没吃）表达。训练只在缺少组数时给 kind=workout，exercise_index 对应动作，提供2-4个具体组数，不擅自补入默认训练组。不要在选项写热量或营养值。参考份量：${JSON.stringify(foods)}`,
            },
            { role: 'user', content },
          ],
        }),
      });
      if (!res.ok) throw Error('解析服务暂时不可用');
      const out = JSON.parse((await res.json()).choices[0].message.content);
      // Optional suggestions are independently validated so malformed AI patches cannot drop a record.
      if (out.route === 'record' && Array.isArray(out.records)) {
        for (const record of out.records) {
          if (record && typeof record === 'object' && record.quick_pick !== undefined) {
            try {
              validateParse({ route: 'record', records: [record] });
            } catch {
              delete record.quick_pick;
            }
          }
        }
      }
      validateParse(out);
      if (out.route === 'qa' && typeof out.question === 'string') return out;
      if (out.route !== 'record' || !Array.isArray(out.records)) throw Error('解析格式异常');
      return {
        route: 'record',
        records: out.records.map((r: Draft) => ({
          ...base,
          ...r,
          note,
          ...(r.entry_type === 'meal'
            ? {
                items: r.items?.map((i) =>
                  estimateNutrition(
                    i,
                    true,
                    out.records.length === 1 && r.items?.length === 1 && i.weight_basis === 'bone_in'
                      ? explicitScaleWeight(text)
                      : null,
                  ),
                ),
              }
            : {}),
          logged_at: base.logged_at,
          raw_text: text || r.raw_text || null,
          confidence: source === 'photo' ? 'estimated' : r.confidence,
        })),
      };
    } catch (error) {
      if (photo || !text.trim()) throw error;
      // Text can still be recorded with the local parser if the provider is unavailable.
    }
  }
  if (photo) throw Error('照片识别暂不可用，照片已保留，可稍后重试');
  if (detectIntent(text).intent === 'question') return { route: 'qa', question: text };
  const records: Draft[] = [];
  const number = (v: string) =>
    Number(
      (
        { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<
          string,
          number
        >
      )[v] ?? v,
    );
  for (const part of text.split(/[，,。；;\n]/).filter(Boolean)) {
    if (/^(?:我|然后|就|我就)*(?:没|没有|没再)(?:吃|喝)/.test(part.trim())) continue;
    const weight = part.match(/(?:体重|称了?|重)\s*(\d+(?:\.\d+)?)\s*(kg|公斤|千克|斤)?/i);
    if (weight)
      records.push({
        ...base,
        entry_type: 'body_metrics',
        summary_title: '体重',
        weight_kg: Number(weight[1]) / (weight[2] === '斤' ? 2 : 1),
        confidence: 'exact',
      });
    const moves = dictionary.filter((e) => [e.name_zh, ...e.aliases].some((n) => part.includes(n)));
    if (moves.length) {
      const count = part.match(/(\d+|[一二两三四五六七八九十])\s*组/),
        kg = part.match(/(\d+(?:\.\d+)?)\s*(kg|公斤)/i),
        reps = part.match(/(\d+)\s*次/);
      if (count && number(count[1]) > 300) throw Error('组数过多');
      records.push({
        ...base,
        entry_type: /想练|计划/.test(part) ? 'plan_draft' : 'workout',
        summary_title: moves.map((m) => m.name_zh).join('、'),
        exercises: moves.map((m) => ({
          ...m,
          exercise_id: m.id,
          exercise_name: m.name_zh,
          sets: Array.from({ length: count ? number(count[1]) : 0 }, () => ({
            weight_kg: kg ? Number(kg[1]) : null,
            reps: reps ? Number(reps[1]) : null,
            duration_sec: null,
          })),
        })),
      });
    }
    const candidates = foods.filter((f) => part.includes(f.food_name));
    const items = candidates
      .filter((f) => !candidates.some((other) => other !== f && other.food_name.includes(f.food_name)))
      .map((f) => {
        const before = part.slice(0, part.indexOf(f.food_name));
        const amount = before.match(
          /(\d+(?:\.\d+)?|[一二两三四五六七八九十半])\s*(克|g|杯|碗|份|个|根|片|勺)\s*$/i,
        );
        const quantity = amount ? (amount[1] === '半' ? 0.5 : number(amount[1])) : 1;
        const factor = amount && /克|g/i.test(amount[2]) ? quantity / f.estimated_grams : quantity;
        const scaled = (n: number) => Math.round(n * factor * 1000) / 1000;
        return {
          ...f,
          portion_text: amount ? amount[0].trim() : f.portion_text,
          estimated_grams: scaled(f.estimated_grams),
          kcal: Math.round(f.kcal * factor),
          protein_g: scaled(f.protein_g),
          carbs_g: scaled(f.carbs_g),
          fat_g: scaled(f.fat_g),
          confidence: 'estimated' as const,
        };
      });
    if (items.length || /吃|喝|加餐/.test(part))
      records.push({
        ...base,
        entry_type: 'meal',
        summary_title: items.map((i) => i.food_name).join('、') || part,
        items: items.length
          ? items.map((i) => estimateNutrition(i, false))
          : [{ food_name: part, confidence: 'estimated' } as Item],
      });
  }
  if (!records.length) throw Error('请补充食物名、动作名或体重');
  return { route: 'record', records };
}
