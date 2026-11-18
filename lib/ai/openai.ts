/**
 * 真实模型 provider：任何 OpenAI 兼容的 /chat/completions 接口。
 * 约定：模型只负责“认出是什么 + 估个克数”，营养换算全部交给 lib/core/enrich.ts。
 */
import type { MealType } from '../date';
import type { RawItem, Recognition, RecognizeInput, VisionProvider } from './types';

const SYSTEM_PROMPT = `你是健身饮食助手，负责把用户发来的图片或文字转成结构化数据。

只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块：
{
  "intent": "food" | "equipment" | "other",
  "meal_type": "breakfast" | "lunch" | "dinner" | "snack",
  "items": [
    { "name": "食物的中文名", "grams": 120, "kcal_100g": 116, "protein_100g": 2.6, "carb_100g": 25.9, "fat_100g": 0.3 }
  ],
  "equipment": "如果 intent=equipment，这里填器械名",
  "reply": "如果 intent=other，这里填给用户的一句话"
}

规则：
- 食物名称用常见中文叫法；看不清或不确定就不要猜，宁可在 items 里少给几项。
- grams 是你对份量的估计，允许有误差，但必须是 1–2000 之间的数字。
- 每 100g 的营养值按常见食物估算；不确定时可以省略，系统会用内置库补全。
- 一句话里提到多种食物就拆成多条 items。
- 如果用户只是在聊天、问训练问题，intent 用 other。`;

function stripFence(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? m[1] : t;
}

interface ModelJson {
  intent?: string;
  meal_type?: MealType;
  items?: Array<Record<string, unknown>>;
  equipment?: string;
  reply?: string;
}

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function createOpenAIProvider(): VisionProvider {
  const base = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY || '';
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  return {
    name: 'openai',

    async recognize({ text, imageDataUrl, memoryBlock }: RecognizeInput): Promise<Recognition> {
      if (!apiKey) throw new Error('AI_API_KEY 未配置，请在 .env.local 里填写');

      const content: unknown[] = [];
      if (text) content.push({ type: 'text', text });
      if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl } });
      if (!content.length) return { kind: 'other', text: '发一张照片或说一句话吧。' };

      const system = memoryBlock ? `${SYSTEM_PROMPT}\n\n关于用户的已知事实（用于判断份量与食物偏好）：\n${memoryBlock}` : SYSTEM_PROMPT;

      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`模型接口 ${res.status}：${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = data.choices?.[0]?.message?.content ?? '';
      let parsed: ModelJson;
      try {
        parsed = JSON.parse(stripFence(raw)) as ModelJson;
      } catch {
        return { kind: 'other', text: raw.slice(0, 300) || '模型没有返回可解析的内容。' };
      }

      const intent = parsed.intent ?? 'other';
      if (intent === 'food') {
        const num = (v: unknown): number | undefined => {
          if (v === undefined || v === null || v === '') return undefined;
          const n = Number(v);
          return Number.isFinite(n) ? n : undefined;
        };
        const items: RawItem[] = [];
        for (const it of parsed.items ?? []) {
          const name = String(it.name ?? '').trim();
          if (!name) continue;
          const grams = Number(it.grams);
          items.push({
            name,
            grams: Number.isFinite(grams) && grams > 0 ? Math.min(2000, Math.round(grams)) : 100,
            kcal_100g: num(it.kcal_100g),
            protein_100g: num(it.protein_100g),
            carb_100g: num(it.carb_100g),
            fat_100g: num(it.fat_100g),
            confidence: 0.85,
          });
        }

        if (!items.length) return { kind: 'other', text: '这张图我没能确定是什么食物，换个角度再拍一张？' };
        const mealType = parsed.meal_type && MEALS.includes(parsed.meal_type) ? parsed.meal_type : undefined;
        return { kind: 'food', items, mealType };
      }

      if (intent === 'equipment') {
        return { kind: 'equipment', name: parsed.equipment ?? '未知器械' };
      }

      return { kind: 'other', text: parsed.reply?.trim() || '我在。说说你吃了什么，或者今天想练什么？' };
    },
  };
}
