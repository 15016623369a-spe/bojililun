'use client';

import { CameraIcon, KeyboardIcon } from './icons';
import { requestRecord } from './record-intent';

/**
 * 记录页右上角：打字、拍照（11 月 25 日用户要求从导航旁挪到这里）。
 * 打字打开「记一条」面板；拍照先选照片，再在「记一条」里补一句、记下来。说话用底部导航中间的话筒。
 */
export default function RecordHeadButtons() {
  return (
    <div className="record-head-btns">
      <button type="button" aria-label="打字记一条" onClick={() => requestRecord('compose')}><KeyboardIcon /></button>
      <button type="button" aria-label="拍照或选照片" onClick={() => requestRecord('photo')}><CameraIcon /></button>
    </div>
  );
}
