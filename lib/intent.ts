/** 一句话进来：是在「陈述」还是在「提问」—— 纯函数，前后端共用 */

const QUESTION_WORDS =
  /(吗|呢|么|多少|几|怎么|怎样|如何|为什么|为啥|哪|什么|啥|是不是|能不能|可不可以|有没有|会不会|要不要|该不该|应该|推荐|区别|多久|多大|多高|多重|多快|算不算|够不够|好不好|对不对|请教|请问)/;

export interface Intent {
  kind: 'question' | 'record';
  /** 命中的问句线索，便于调试 */
  hint?: string;
}

/** 陈述句：去记录；疑问句：去问答 */
export function detectIntent(text: string): Intent {
  const t = String(text ?? '').trim();
  if (!t) return { kind: 'record' };
  if (/[?？]/.test(t)) return { kind: 'question', hint: '问号' };

  const m = QUESTION_WORDS.exec(t);
  if (m) {
    // 「练了多久」是问，但「多久」出现在「练了40分钟」这种陈述里不会命中
    return { kind: 'question', hint: m[1] };
  }
  return { kind: 'record' };
}

export function isQuestion(text: string): boolean {
  return detectIntent(text).kind === 'question';
}
