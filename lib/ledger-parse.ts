import { parseSchema, validateParse } from './ledger-contract';
import foods from '../data/food-reference.json';
import dictionary from '../data/exercises-seed.json';
import { detectIntent } from './intent';
import type { Draft, Parsed, Source } from './ledger';
import type { Item } from './calculations';
export async function parseInput(text: string, photo: string | undefined, source: Source): Promise<Parsed> {
  if (detectIntent(text).intent === 'question') return { route: 'qa', question: text };
  const note = text.match(/(?:备注[：:]?)([^，,。；;]+)/)?.[1]?.trim() ?? null;
  const base = {
    logged_at: new Date().toISOString(),
    confidence: 'estimated' as const,
    raw_text: text || null,
    note,
    feeling_tags: ['有点力竭', '轻松', '疲劳'].filter((tag) => text.includes(tag)),
  };
  if (process.env.AI_API_KEY && ['openai', 'compatible'].includes(process.env.AI_PROVIDER ?? 'mock')) {
    const content: unknown[] = [{ type: 'text', text: text || '记录图中的食物或训练' }];
    if (photo) content.push({ type: 'image_url', image_url: { url: photo } });
    const res = await fetch(
      (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.AI_API_KEY, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model: process.env.AI_MODEL || 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `输出 JSON，提问返回 {route:"qa",question}，陈述返回 {route:"record",records:[...]}，混合吃练称重要拆多条。每条含 entry_type(meal/workout/body_metrics/plan_draft),summary_title,note,feeling_tags,confidence(exact/estimated)。饮食 items 含 food_name,portion_text,estimated_grams,kcal整数,protein_g,carbs_g,fat_g,confidence。估算只限单项，未知用null。训练 exercises:[{exercise_name,sets:[{weight_kg,reps,duration_sec}]}]，未报组数 sets:[]，勿猜测。体征 weight_kg,body_fat_pct。保留睡眠外食等备注。纯照片将描述放raw_text。结构必须符合：${JSON.stringify(parseSchema)}。参考份量：${JSON.stringify(foods)}`,
            },
            { role: 'user', content },
          ],
        }),
      },
    );
    if (!res.ok) throw Error('解析服务暂时不可用');
    const out = JSON.parse((await res.json()).choices[0].message.content);
    validateParse(out);
    if (out.route === 'qa' && typeof out.question === 'string') return out;
    if (out.route !== 'record' || !Array.isArray(out.records)) throw Error('解析格式异常');
    return {
      route: 'record',
      records: out.records.map((r: Draft) => ({
        ...base,
        ...r,
        logged_at: base.logged_at,
        raw_text: text || r.raw_text || null,
        confidence: source === 'photo' ? 'estimated' : r.confidence,
      })),
    };
  }
  if (photo) throw Error('照片解析需要配置视觉模型，可直接输入文字');
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
        items: items.length ? items : [{ food_name: part, confidence: 'estimated' } as Item],
      });
  }
  if (!records.length) throw Error('请补充食物名、动作名或体重');
  return { route: 'record', records };
}
