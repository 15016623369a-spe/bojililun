/** 记录页要打开的录入方式：打字面板，或者直接拍照 / 选照片 */
export type RecordIntent = 'compose' | 'photo';

export const RECORD_EVENT = 'fitcheck-record';

/**
 * 发出录入请求，返回记录页有没有接住（记录页挂着 LogScreen 时会 preventDefault）。
 * 记录页导航右边的话筒圆钮、在记录页上轻点底部「记录」都用它：接住就打开「记一条」面板；
 * 没接住（如回看某一天）照常去今天的记录页。
 */
export function requestRecord(intent: RecordIntent): boolean {
  const event = new CustomEvent<RecordIntent>(RECORD_EVENT, { detail: intent, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
