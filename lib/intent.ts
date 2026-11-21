export type IntentKind = 'question' | 'new_record' | 'correction' | 'completion';

export interface IntentResult {
  intent: IntentKind;
  confidence: number;
  source: 'deepseek' | 'fallback';
}

const QUESTION_WORDS = /(多少|几(?:组|次|个|克|分钟|小时|天|餐)|怎么|怎样|如何|为什么|为啥|哪(?:个|些|种|里|儿|块)|什么|啥|是不是|能不能|可不可以|有没有|会不会|要不要|该不该|区别|多久|多大|多高|多重|多快|算不算|够不够|好不好|对不对|请教|请问|[吗呢么]$)/;

/** Deterministic emergency classifier. */
export function detectIntent(text: string): IntentResult {
  const t = String(text ?? '').trim().replace(/[。！!，,]+$/, '');
  if (/[?？]/.test(t) || QUESTION_WORDS.test(t)) return { intent: 'question', confidence: 0.96, source: 'fallback' };
  if (/(应该是|改成|改为|更正|其实是|实际是|记错|不对，|不对,)/.test(t)) return { intent: 'correction', confidence: 0.88, source: 'fallback' };
  if (/(已完成|完成了|做完了|练完了|刚做完|已经完成|结束训练)/.test(t)) return { intent: 'completion', confidence: 0.86, source: 'fallback' };
  return { intent: 'new_record', confidence: 0.72, source: 'fallback' };
}

export async function classifyIntent(rawText: string): Promise<IntentResult> {
  const text = rawText.trim();
  const fallback = detectIntent(text);
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return fallback;
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是健身饮食记录应用的意图分类器。只输出 JSON：{"intent":"question|new_record|correction|completion","confidence":0到1之间的数字}。question 是询问知识/估算/建议；new_record 是新增饮食、训练、睡眠等事件；correction 是修改已有记录；completion 是表示已有计划动作或训练已完成。不要根据句中包含的食物/动作名把提问归为新记录。' },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return fallback;
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { intent?: string; confidence?: number };
    const choice = parsed.intent;
    const confidence = parsed.confidence;
    if (!['question', 'new_record', 'correction', 'completion'].includes(choice ?? '') || typeof confidence !== 'number') return fallback;
    return { intent: choice as IntentKind, confidence: Math.max(0, Math.min(1, confidence)), source: 'deepseek' };
  } catch {
    return fallback;
  }
}

/** Kept for older callers; intent classification for user submissions happens server-side. */
export function isQuestion(text: string): boolean {
  return detectIntent(text).intent === 'question';
}
