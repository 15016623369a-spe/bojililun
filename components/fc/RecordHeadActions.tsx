'use client';

import { CameraIcon, KeyboardIcon } from './icons';

/** 记录页要打开的录入方式：打字面板，或者直接拍照 / 选照片 */
export type RecordIntent = 'compose' | 'photo';

export const RECORD_EVENT = 'fitcheck-record';

/**
 * 发出录入请求，返回记录页有没有接住（记录页挂着 LogScreen 时会 preventDefault）。
 * 底部导航的「记录」在记录页上轻点时也用它：接住就打开面板，没接住（如回看某一天）照常去今天的记录页。
 */
export function requestRecord(intent: RecordIntent): boolean {
  const event = new CustomEvent<RecordIntent>(RECORD_EVENT, { detail: intent, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** 记录页右上角：打字、拍照。原来底部「按住说话」那一行去掉后，这两个入口挪到这里；语音仍是长按底部「记录」。 */
export default function RecordHeadActions() {
  return (
    <div className="head-actions">
      <button type="button" className="head-icon" aria-label="打字记一条" title="打字" onClick={() => requestRecord('compose')}>
        <KeyboardIcon />
      </button>
      <button type="button" className="head-icon" aria-label="拍照或选照片" title="拍照" onClick={() => requestRecord('photo')}>
        <CameraIcon />
      </button>
    </div>
  );
}
