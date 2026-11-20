export type IntentKind = 'question' | 'new_record' | 'correction' | 'completion';

export interface IntentResult {
  intent: IntentKind;
  confidence: number;
  source: 'jev' | 'fallback';
}

const QUESTION_WORDS = /(多少|几(?:组|次|个|克|分钟|小时|天|餐)|怎么|怎样|如何|为什么|为啥|哪(?:个|些|种|里|儿|块)|什么|啥|是不是|能不能|可不可以|有没有|会不会|要不要|该不该|区别|多久|多大|多高|多重|多快|算不算|够不够|好不好|对不对|请教|请问|[吗呢么]$)/;

/** Deterministic emergency classifier. Jev is used by the server route when configured. */
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
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return fallback;
  try {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.TYPESAFE_JEV_MODEL || 'jev-latest',
        state: { raw_text: text },
        questions: { intent: {
          type: 'choice',
          instructions: 'Classify the user utterance by its primary intent in a fitness and food journal. A question asks for information and must not create a record. new_record states a new food, workout, sleep, or other event. correction changes an existing record. completion says an existing planned exercise or workout was completed.',
          criteria: {
            question: 'Asks a question or requests an estimate, explanation, or advice; do not write it to the journal.',
            new_record: 'Reports a new food, workout, sleep, or other event to add to the journal.',
            correction: 'Corrects, replaces, or changes details of an existing record.',
            completion: 'Says a planned exercise or workout has been completed.',
          },
        } },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return fallback;
    const data = await response.json() as { answers?: { intent?: { choice?: string; confidence?: number } } };
    const choice = data.answers?.intent?.choice;
    const confidence = data.answers?.intent?.confidence;
    if (!['question', 'new_record', 'correction', 'completion'].includes(choice ?? '') || typeof confidence !== 'number') return fallback;
    return { intent: choice as IntentKind, confidence: Math.max(0, Math.min(1, confidence)), source: 'jev' };
  } catch {
    return fallback;
  }
}

/** Kept for older callers; intent classification for user submissions happens server-side. */
export function isQuestion(text: string): boolean {
  return detectIntent(text).intent === 'question';
}
