'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import AskSheet from './AskSheet';
import { CameraIcon } from './icons';
import { RECORD_EVENT, type RecordIntent } from './record-intent';
import TabBar from './TabBar';
import Timeline from './Timeline';
import { createRecordDraft, keepRecordDraft, recordDrafts, removeRecordDraft, sendRecordDraft, type RecordDraft } from '@/lib/record-drafts';

const EXAMPLES = [
  '高位下拉 4 组 12 次 60 公斤，划船 4 组 12 次 50 公斤',
  '午饭吃了牛肉面和卤蛋',
  '晚上练了肩，推举和侧平举',
];

/** 压缩后再上传，别把 4MB 的原图塞进请求体 */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读不了这张图'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function LogScreen({ ledgerHasRecords, empty = false }: { ledgerHasRecords: boolean; /** 今天还没有记录：话筒放大放在页面中间 */ empty?: boolean }) {
  const router = useRouter();

  const [phase, setPhase] = useState<'idle' | 'busy'>('idle');
  const [toast, setToast] = useState('');
  const [ask, setAsk] = useState<string | null>(null);

  const [sheet, setSheet] = useState<'compose' | 'edit' | null>(null);
  // 收起时先播完下滑动画再卸载，面板不会一下子消失
  const [sheetClosing, setSheetClosing] = useState(false);
  const closeTimer = useRef(0);
  const closeSheet = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setSheetClosing(true);
    closeTimer.current = window.setTimeout(() => { setSheet(null); setSheetClosing(false); setPhoto(null); }, 280);
  }, []);
  const showSheet = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setSheetClosing(false);
    setSheet('compose');
  }, []);
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<RecordDraft[]>([]);
  const [recordError, setRecordError] = useState('');
  const [activeRequest, setActiveRequest] = useState('');
  const [editingDraft, setEditingDraft] = useState<RecordDraft | null>(null);
  // 右上角拍照选好的图：先放进「记一条」面板，可以补一句再记下来
  const [photo, setPhoto] = useState<string | null>(null);
  const working = phase === 'busy';
  const busyRef = useRef(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let mounted = true;
    const sync = () => void recordDrafts().then((next) => { if (mounted) setDrafts(next); });
    sync();
    window.addEventListener('fitcheck-record-drafts', sync);
    return () => { mounted = false; window.removeEventListener('fitcheck-record-drafts', sync); };
  }, []);

  const submit = useCallback(async (draft: RecordDraft) => {
    if (busyRef.current) { await keepRecordDraft(draft); return; }
    busyRef.current = true;
    setRecordError('');
    setActiveRequest(draft.request_id);
    setPhase('busy');
    closeSheet();
    try {
      const result = await sendRecordDraft(draft);
      if (result.route === 'qa' && result.question) setAsk(result.question);
      else if (result.route === 'plan') {
        setToast(result.message || '已加入今日计划');
        router.push('/train');
      } else {
        router.refresh();
        setToast(draft.source === 'photo' ? '已记下 · 热量为估算' : '已记下');
      }
    } catch (e) {
      setRecordError(e instanceof TypeError ? '刚才网络断了一下，内容已经先存下来了，等网好了点重试就行。' : (e as Error).message);
    } finally {
      setPhase('idle');
      setActiveRequest('');
      busyRef.current = false;
    }
  }, [router, closeSheet]);

  const photoInput = useRef<HTMLInputElement>(null);

  const openComposer = showSheet;

  // 右上角的打字、拍照按钮发来的请求（见 RecordHeadButtons / record-intent）
  useEffect(() => {
    const onRecord = (event: Event) => {
      const intent = (event as CustomEvent<RecordIntent>).detail;
      event.preventDefault();
      if (intent === 'photo') {
        if (!busyRef.current) photoInput.current?.click();
      } else openComposer();
    };
    window.addEventListener(RECORD_EVENT, onRecord);
    return () => window.removeEventListener(RECORD_EVENT, onRecord);
  }, [openComposer]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      // 选好照片后打开「记一条」，照片放在里面，可以补一句说明再记下来
      setPhoto(await compressImage(file));
      setEditingDraft(null);
      showSheet();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  /** 面板里的「记下来」：有照片时，训练挂图、饮食走拍照识别 */
  const submitComposer = async () => {
    const value = text.trim();
    if (working) return;
    if (photo) {
      setText('');
      await submit(createRecordDraft('photo', value, photo));
      return;
    }
    if (!value) {
      setToast('说点什么，或者加张照片');
      return;
    }
    setText('');
    setEditingDraft(null);
    await submit(editingDraft ? { ...editingDraft, text: value } : createRecordDraft('manual', value));
  };

  const recoverySlot = drafts.length > 0 ? document.getElementById('record-recovery-slot') : null;

  return (
    <>
      {recoverySlot && createPortal(<section className="record-recovery" aria-label="待保存的记录">
        {drafts.map((draft) => <article key={draft.request_id}>
          <header className="record-recovery-head">
            <div>
              <span>{activeRequest === draft.request_id ? '正在保存' : '待保存'}</span>
              <strong>{draft.source === 'photo' ? '照片记录' : draft.source === 'voice' ? '语音记录' : '文字记录'}</strong>
              {draft.text && <p>{draft.text}</p>}
            </div>
            {draft.photo && <img src={draft.photo} alt="待保存的照片" />}
          </header>
          {!working && <div className="record-recovery-actions">
            <button type="button" className="record-retry" onClick={() => void submit(draft)}>重试保存</button>
            {draft.source !== 'photo' && <button type="button" onClick={() => {
              setText(draft.text);
              showSheet();
              setEditingDraft(draft);
            }}>编辑</button>}
            <button type="button" onClick={() => { void removeRecordDraft(draft.request_id); setRecordError(''); }}>移除草稿</button>
          </div>}
        </article>)}
        {recordError && <p role="alert">{recordError}</p>}
      </section>, recoverySlot)}

      {!ledgerHasRecords && <Timeline entries={[]} />}

      {/* 空的一天只放一句话；录音键就是底部导航中间那颗话筒 */}
      {empty && <div className="record-empty">
        <b>今天还没有记录</b>
        <span>按住下方的话筒说一句<br />右上角可以打字或拍照</span>
      </div>}

      <div className="fc-dock" aria-busy={working}>
        <div className="fc-dock-inner">
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (!file) return;
              void onFile(file);
            }}
            hidden
          />
          {working && <p className="journal-status" role="status">正在记入手账…</p>}
          {/* 导航中间那颗话筒就是「记录」：按住说话，在记录页上轻点直接进语音输入 */}
          <TabBar active="log" />
        </div>
      </div>

      {/* 记一条：只从右上角的打字、拍照打开；语音直接用导航中间的话筒 */}
      {sheet === 'compose' && (
        <div className="fc-mask record-sheet" data-closing={sheetClosing || undefined} onClick={() => !working && closeSheet()}>
          <div className="fc-sheet" role="dialog" aria-modal="true" aria-label="记一条" onClick={(e) => e.stopPropagation()}>
            <i className="record-sheet-grab" aria-hidden="true" />
            <h3>{editingDraft ? '继续编辑记录' : '记一条'}</h3>

            {!photo && <div className="fc-examples">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" onClick={() => setText(x)}>
                  {x}
                </button>
              ))}
            </div>}

            {photo && <div className="record-sheet-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="要记下的照片" />
              <button type="button" aria-label="去掉这张照片" onClick={() => setPhoto(null)}>×</button>
            </div>}

            <textarea
              className="fc-input"
              placeholder={photo ? '补一句说明，可以不写' : '例如：高位下拉 4 组 12 次 60 公斤'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus={!photo}
            />

            <div className="fc-compose-bar">
              <button
                type="button"
                className="fc-attach"
                disabled={working}
                onClick={() => photoInput.current?.click()}
              >
                <CameraIcon /> {photo ? '换一张照片' : '加一张照片'}
              </button>
            </div>

            <div className="fc-sheet-actions">
              <button type="button" className="fc-btn ghost" onClick={closeSheet}>
                取消
              </button>
              <button
                type="button"
                className="fc-btn primary"
                onClick={() => void submitComposer()}
                disabled={working}
              >
                {working ? '处理中…' : '记下来'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ask && <AskSheet question={ask} onClose={() => setAsk(null)} />}

      {toast && <div className="fc-toast">{toast}</div>}
    </>
  );
}
