'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { TrainingMutationPreview } from '@/lib/core/journal';
import type { JournalEntry } from '@/lib/journal';
import AskSheet from './fc/AskSheet';
import JournalIcon from './JournalIcon';
import RecordCards from './RecordCards';

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export default function RecordToday({ date, entries, workoutSaved }: { date: string; entries: JournalEntry[]; workoutSaved: boolean }) {
  const router = useRouter();
  const rec = useRef<Recognition | null>(null);
  const lock = useRef(false);
  const [recording, setRecording] = useState(false);
  const [heard, setHeard] = useState('');
  const [editing, setEditing] = useState(false);
  const [ask, setAsk] = useState<{ question: string }>();
  const [mutation, setMutation] = useState<{ preview: TrainingMutationPreview; text: string }>();
  const [text, setText] = useState('');
  const [status, setStatus] = useState(workoutSaved ? '训练已自动归档' : '');
  const [freshId, setFreshId] = useState<string>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pastEntry, setPastEntry] = useState<JournalEntry>();
  const [conflict, setConflict] = useState<{
    text: string;
    planned: string[];
    actual: string[];
    mode: 'region' | 'exercise';
    target?: { ordinal: number; exerciseName: string };
    spokenExercise?: string;
    options?: Array<{ id: string; name: string; zh_name: string; equipment: string }>;
    selectedId?: string;
    search: string;
    results: Array<{ id: string; name: string; zh_name: string; equipment: string }>;
    searching: boolean;
  }>();
  const request = useRef<{ text: string; id: string } | null>(null);

  useEffect(() => () => {
    if (rec.current) {
      rec.current.onend = null;
      rec.current.abort();
    }
  }, []);

  useEffect(() => {
    if (!freshId) return;
    const timer = setTimeout(() => setFreshId(undefined), 5000);
    return () => clearTimeout(timer);
  }, [freshId]);

  useEffect(() => {
    if (!status || pastEntry) return;
    const timer = setTimeout(() => setStatus(''), 5000);
    return () => clearTimeout(timer);
  }, [status, pastEntry]);

  async function save(value: string, resolution?: 'actual', replacementExerciseId?: string) {
    if (lock.current || !value.trim()) return;
    setAsk(undefined);
    lock.current = true;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const classification = await fetch('/api/intent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw_text: value }),
      });
      const classified = await classification.json() as { intent?: string; error?: string };
      if (!classification.ok || !classified.intent) throw new Error(classified.error || '意图识别失败，请重试');
      if (classified.intent === 'question') {
        setAsk({ question: value.trim() });
        setText('');
        setEditing(false);
        setConflict(undefined);
        return;
      }
      if (request.current?.text !== value) {
        request.current = { text: value, id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      }
      const response = await fetch('/api/journal', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: value, requestId: request.current.id, intent: classified.intent, resolution, replacementExerciseId }),
      });
      const result = await response.json();
      if (response.status === 409 && result.conflict) {
        const options = result.conflict.options ?? [];
        setConflict({
          text: value,
          planned: result.conflict.planned,
          actual: result.conflict.actual,
          mode: result.conflict.mode ?? 'region',
          target: result.conflict.target,
          spokenExercise: result.conflict.spokenExercise,
          options,
          selectedId: options[0]?.id,
          search: '',
          results: [],
          searching: false,
        });
        return;
      }
      if (!response.ok) throw new Error(result.error || '记录失败，请重试');
      if (result.preview) {
        setMutation({ preview: result.preview as TrainingMutationPreview, text: value });
        setText('');
        setEditing(false);
        return;
      }
      const entry: JournalEntry = result.entry;
      const corrected = entry.id.startsWith('session-');
      const plannedTraining = entry.kind === 'training' && entry.payload?.planned;
      const replacedName = conflict?.options?.find((option) => option.id === replacementExerciseId)?.zh_name
        || conflict?.results.find((option) => option.id === replacementExerciseId)?.zh_name;
      setConflict(undefined);
      setStatus(corrected ? '已更正原训练记录' : plannedTraining ? '已识别为训练安排'
        : resolution === 'actual' && conflict?.mode === 'exercise' ? `已替换为「${replacedName ?? '所选动作'}」，原有语音记录已清理，训练表格已更新`
          : resolution === 'actual' ? `已确认实际练${conflict?.actual.join('、') ?? ''}，不相符记录与原有语音记录已清理`
            : entry.kind === 'training' ? '已记录训练'
              : entry.kind === 'meal' ? '已记录为饮食' : entry.kind === 'sleep' ? '已记录为睡眠' : '已记录');
      setFreshId(corrected ? undefined : entry.id);
      setPastEntry(!plannedTraining && entry.date !== date ? entry : undefined);
      setText('');
      setEditing(false);
      request.current = null;
      router.refresh();
    } catch (err) {
      setText(value);
      setEditing(true);
      setError((err as Error).message);
    } finally {
      setSaving(false);
      lock.current = false;
    }
  }

  async function searchExercises() {
    if (!conflict || !conflict.search.trim() || conflict.searching) return;
    setConflict({ ...conflict, searching: true });
    try {
      const response = await fetch(`/api/exercises?q=${encodeURIComponent(conflict.search.trim())}&limit=8`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '搜索失败');
      setConflict((current) => current ? { ...current, results: result.items ?? [], searching: false } : current);
    } catch {
      setConflict((current) => current ? { ...current, searching: false } : current);
      setError('动作搜索失败，请重试');
    }
  }

  async function confirmMutation() {
    if (!mutation || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/journal', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmMutation: mutation.preview }),
      });
      const result = await response.json();
      if (!response.ok || !result.entry) throw new Error(result.error || '确认失败，请重试');
      setMutation(undefined);
      setStatus(mutation.preview.intent === 'completion' ? '训练已确认完成' : '训练记录已更正');
      setFreshId(undefined);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  function startVoice() {
    if (rec.current || lock.current) return;
    setError('');
    setConflict(undefined);
    if (!window.isSecureContext) {
      setError('语音输入需要 HTTPS：请把地址换成 https:// 开头再试（电脑上用 localhost 也可以）。当前是 HTTP，浏览器不会开放麦克风。');
      return;
    }
    const host = window as Window & {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Speech = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Speech) {
      setError('此浏览器暂不支持语音识别，请用 Chrome / Safari，或点左侧键盘图标打字。');
      return;
    }
    const capture = new Speech();
    rec.current = capture;
    capture.lang = 'zh-CN';
    capture.continuous = true;
    capture.interimResults = true;
    let finalText = '';
    let partialText = '';
    let failed = false;
    capture.onresult = (event) => {
      finalText = '';
      partialText = '';
      for (const result of Array.from(event.results)) {
        if (result.isFinal) finalText += result[0].transcript;
        else partialText += result[0].transcript;
      }
      setHeard((finalText + partialText).trim());
    };
    capture.onerror = ({ error: reason }) => {
      failed = true;
      if (reason === 'aborted') return;
      if (reason === 'not-allowed' || reason === 'service-not-allowed') {
        setError('麦克风没授权：点浏览器地址栏左侧的图标，把麦克风设为「允许」；iPhone 在 设置 → Safari → 麦克风 选「允许」。授权后重新按住说话。');
      } else if (reason === 'network') {
        setError('语音识别服务连不上（浏览器自带识别需要联网），检查一下网络再试。');
      } else {
        setError('这次语音没有识别成功，再按住试一次。');
      }
    };
    capture.onend = () => {
      rec.current = null;
      setRecording(false);
      setHeard('');
      const spoken = (finalText + partialText).trim();
      if (spoken && !failed) void save(spoken);
      else if (!failed) setError('没有听到内容，再按住试一次。');
    };
    try {
      capture.start();
      setRecording(true);
      setHeard('');
    } catch {
      rec.current = null;
      setError('语音暂时无法启动，再按住试一次。');
    }
  }

  function deleted(entry: JournalEntry) {
    if (entry.id === freshId) setFreshId(undefined);
    if (entry.id === pastEntry?.id) setPastEntry(undefined);
    setStatus(entry.id === freshId ? '已撤销' : '已删除记录');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(text);
  }

  const conflictOptions = conflict
    ? [...(conflict.options ?? []), ...conflict.results.filter((result) => !(conflict.options ?? []).some((option) => option.id === result.id))]
    : [];
  const selectedOption = conflictOptions.find((option) => option.id === conflict?.selectedId);

  return <>
    {status && <p className="journal-status" role="status"><JournalIcon name="check" />{status}
      {pastEntry && <Link href={`/history?period=day&date=${pastEntry.date}`}>查看 {pastEntry.date}</Link>}
    </p>}
    {pastEntry && <RecordCards entries={[pastEntry]} freshId={freshId} onDeleted={deleted}
      onSaved={(entry) => setPastEntry(entry.date === date ? undefined : entry)} />}
    {entries.length ? <RecordCards entries={[...entries].reverse()} freshId={freshId} onDeleted={deleted} />
      : <div className="journal-empty"><JournalIcon name="record" /><p>今天还没有记录</p><span>说说吃了什么、练了什么，或昨晚睡得怎么样。</span></div>}
    <div className="journal-input-dock">
      {ask && <AskSheet key={ask.question} docked question={ask.question} onClose={() => setAsk(undefined)}
        onFollowUp={(question) => setAsk({ question })}
        onLogged={(id) => {
          setAsk(undefined);
          setStatus('已记为今日饮食');
          if (id) setFreshId(`meal-${id}`);
        }} />}
      {mutation && <div className="training-conflict" role="alertdialog" aria-modal="false" aria-labelledby="mutation-title">
        <b id="mutation-title">请确认训练变更</b>
        <p>「{mutation.preview.exerciseName}」组数：{mutation.preview.beforeSets} 组 → {mutation.preview.afterSets} 组。</p>
        <small>{mutation.text}</small>
        <div>
          <button className="journal-quiet" disabled={saving} onClick={() => { setMutation(undefined); setStatus('已取消，训练记录未修改'); }}>取消</button>
          <button className="journal-primary" disabled={saving} onClick={() => void confirmMutation()}>{saving ? '正在保存…' : '确认修改'}</button>
        </div>
      </div>}
      {conflict && <div className="training-conflict" role="alertdialog" aria-modal="false" aria-labelledby="training-conflict-title">
        {conflict.mode === 'exercise' && conflict.target ? <>
          <b id="training-conflict-title">确认是否替换动作</b>
          <p>今日第 {conflict.target.ordinal} 个动作是「<b>{conflict.target.exerciseName}</b>」，语音里识别到「<b>{conflict.spokenExercise}</b>」。请选择实际做的动作：</p>
          <div className="conflict-options" role="radiogroup" aria-label="替换动作">
            {conflictOptions.map((option) => <label key={option.id} className={conflict.selectedId === option.id ? 'selected' : ''}>
              <input type="radio" name="replacement-exercise" checked={conflict.selectedId === option.id}
                onChange={() => setConflict({ ...conflict, selectedId: option.id })} />
              <span><b>{option.zh_name || option.name}</b><small>{option.equipment}</small></span>
            </label>)}
            {conflictOptions.length === 0 && <small>动作库没有直接匹配「{conflict.spokenExercise}」，请用下方搜索选择实际做的动作。</small>}
          </div>
          <div className="conflict-search">
            <input aria-label="搜索其他动作" placeholder="搜索其他动作，如「杠铃卧推」" value={conflict.search}
              onChange={(event) => setConflict({ ...conflict, search: event.target.value })}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchExercises(); } }} />
            <button className="journal-quiet" type="button" disabled={conflict.searching || !conflict.search.trim()} onClick={() => void searchExercises()}>
              {conflict.searching ? '搜索中…' : '搜索'}
            </button>
          </div>
          <small>确认后会替换该动作，并保留原有组数、重量与计时；今天原有的语音补充记录会被删除，只保留最终训练表格。取消则不做任何修改。</small>
          <div>
            <button className="journal-quiet" disabled={saving} onClick={() => { setConflict(undefined); setStatus('已取消，原计划与记录未修改'); }}>取消</button>
            <button className="journal-primary" disabled={saving || !conflict.selectedId}
              onClick={() => void save(conflict.text, 'actual', conflict.selectedId)}>
              {saving ? '正在替换…' : `替换为${(selectedOption?.zh_name || selectedOption?.name) ?? '所选动作'}`}
            </button>
          </div>
        </> : <>
          <b id="training-conflict-title">确认今天实际练了什么</b>
          <p>今日计划或训练记录包含「{conflict.planned.join('、')}」，这句话里实际识别到「{conflict.actual.join('、')}」。</p>
          <small>确认后会移除今天不相符的计划和训练记录，并删除原有语音补充记录，只保留最终表格；取消则不做任何修改。</small>
          <div>
            <button className="journal-quiet" disabled={saving} onClick={() => { setConflict(undefined); setStatus('已取消，原计划与记录未修改'); }}>取消</button>
            <button className="journal-primary" disabled={saving} onClick={() => void save(conflict.text, 'actual')}>
              {saving ? '正在确认…' : `实际练${conflict.actual.join('、')}`}
            </button>
          </div>
        </>}
      </div>}
      {error && <p className="journal-error" role="alert">{error}</p>}
      {recording && <div className="voice-live" role="status">
        <span className="voice-live-dot" aria-hidden="true" />
        <div>
          <b>正在听…松手发送</b>
          <p>{heard || '直接说话，比如「午饭牛肉面加一个卤蛋」'}</p>
        </div>
      </div>}
      {editing && !conflict && <form className="journal-entry-form" onSubmit={submit}>
        <label htmlFor="journal-text">记录或提问</label>
        <textarea id="journal-text" autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder="午饭牛肉面加一个卤蛋" maxLength={1000} />
        <div><button type="button" className="journal-quiet" onClick={() => { setEditing(false); setText(''); setError(''); }}>关闭</button>
          <button className="journal-primary" disabled={saving || !text.trim()}>发送</button></div>
      </form>}
      <div className="journal-composer">
        <button className="journal-icon-button" aria-label="键盘输入" onClick={() => { setAsk(undefined); setEditing(true); setError(''); }}><JournalIcon name="keyboard" /></button>
        <button className={`journal-primary voice-action ${recording ? 'recording' : ''}`} disabled={saving}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            startVoice();
          }}
          onPointerUp={() => rec.current?.stop()}
          onPointerCancel={() => rec.current?.abort()}
          onClick={(event) => {
            if (event.detail === 0) {
              if (rec.current) rec.current.stop();
              else startVoice();
            }
          }}
          onContextMenu={(event) => event.preventDefault()}>
          <JournalIcon name="microphone" />{saving ? '正在记录…' : recording ? '松手发送' : '按住说话'}
        </button>
        <Link className="journal-icon-button" href="/chat" aria-label="拍照记录"><JournalIcon name="photo" /></Link>
      </div>
    </div>
  </>;
}
