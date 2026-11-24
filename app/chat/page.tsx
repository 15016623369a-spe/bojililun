'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantReply, CandidateMemory, FoodItem, TodayPayload } from '@/lib/types';
import type { MealType } from '@/lib/date';
import FoodCard from '@/components/FoodCard';
import MemoryProposal from '@/components/MemoryProposal';
import Drawer from '@/components/Drawer';
import { createRecordDraft, sendRecordDraft } from '@/lib/record-drafts';
import Icon from '@/components/ui/Icon';

type Msg =
  | { id: string; role: 'user'; text?: string; image?: string }
  | { id: string; role: 'assistant'; kind: 'text'; text: string }
  | { id: string; role: 'assistant'; kind: 'pending'; text: string }
  | {
      id: string;
      role: 'assistant';
      kind: 'food';
      draftId: string;
      mealType: MealType;
      items: FoodItem[];
      photoUrl?: string;
      note?: string;
      status: 'open' | 'confirmed';
    }
  | {
      id: string;
      role: 'assistant';
      kind: 'memory';
      candidates: CandidateMemory[];
      status: 'open' | 'saved' | 'dismissed';
    };

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function toMsg(r: AssistantReply): Msg {
  switch (r.kind) {
    case 'text':
      return { id: uid(), role: 'assistant', kind: 'text', text: r.text };
    case 'summary':
      return { id: uid(), role: 'assistant', kind: 'text', text: r.text };
    case 'food_card':
      return {
        id: uid(),
        role: 'assistant',
        kind: 'food',
        draftId: r.draftId,
        mealType: r.mealType,
        items: r.items,
        photoUrl: r.photoUrl,
        note: r.note,
        status: 'open',
      };
    case 'memory_proposal':
      return { id: uid(), role: 'assistant', kind: 'memory', candidates: r.candidates, status: 'open' };
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const max = 1024;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Page() {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [today, setToday] = useState<TodayPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [input, setInput] = useState('');
  const [speakOn, setSpeakOn] = useState(true);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refreshToday = useCallback(async () => {
    try {
      const t = (await fetch('/api/today', { cache: 'no-store' }).then((r) => r.json())) as TodayPayload;
      setToday(t);
    } catch {
      /* 忽略：UI 会保留旧数据 */
    }
  }, []);

  const boot = useCallback(async () => {
    const t = (await fetch('/api/today', { cache: 'no-store' }).then((r) => r.json())) as TodayPayload;
    setToday(t);

    const greeting = '拍一张照片记下这一餐，也可以直接写下吃了什么。';

    const init: Msg[] = [{ id: uid(), role: 'assistant', kind: 'text', text: greeting }];

    if (t.pendingDraft) {
      init.push({
        id: uid(),
        role: 'assistant',
        kind: 'food',
        draftId: t.pendingDraft.draftId,
        mealType: t.pendingDraft.mealType,
        items: t.pendingDraft.items,
        photoUrl: t.pendingDraft.photoUrl,
        note: t.pendingDraft.note,
        status: 'open',
      });
    }
    setMsgs(init);
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  function speak(text: string) {
    if (!speakOn || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const clean = text.replace(/[#*`>\-]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean.slice(0, 220));
    u.lang = 'zh-CN';
    u.rate = 1.03;
    window.speechSynthesis.speak(u);
  }

  function appendReplies(pendingId: string, replies: AssistantReply[]) {
    for (const r of replies) {
      if (r.kind === 'text' || r.kind === 'summary') speak(r.text);
      if (r.kind === 'food_card')
        speak(
          `识别到 ${r.items.map((i) => `${i.name}${i.grams}克`).join('、')}，确认后就会记入今天的记录。`,
        );
    }
    setMsgs((prev) => {
      const idx = prev.findIndex((m) => m.id === pendingId);
      const next = [...prev];
      const mapped = replies.map(toMsg);
      if (idx >= 0) next.splice(idx, 1, ...mapped);
      else next.push(...mapped);
      return next;
    });
  }

  function failPending(pendingId: string, text: string) {
    setMsgs((prev) =>
      prev.map((m) => (m.id === pendingId ? { id: pendingId, role: 'assistant', kind: 'text', text } : m)),
    );
  }

  async function postChat(body: { text?: string; image?: string }, pendingId: string) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { replies?: AssistantReply[]; error?: string };
    if (!res.ok || !data.replies) throw new Error(data.error ?? '请求失败');
    appendReplies(pendingId, data.replies);
    router.refresh();
    await refreshToday();
  }

  async function sendText(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput('');
    setErr('');
    setBusy(true);
    const pendingId = uid();
    setMsgs((prev) => [
      ...prev,
      { id: uid(), role: 'user', text },
      { id: pendingId, role: 'assistant', kind: 'pending', text: '正在看' },
    ]);
    try {
      await postChat({ text }, pendingId);
    } catch (e) {
      failPending(pendingId, (e as Error).message);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startVoice() {
    if (typeof window === 'undefined') return;
    if (!window.isSecureContext) {
      setErr('当前不是加密连接（HTTP），浏览器不允许打开麦克风。请改用 https:// 地址访问，或者直接打字。');
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setErr('当前浏览器不支持语音输入，试试 Safari 或 Chrome，或者直接打字。');
      return;
    }
    setErr('');
    const rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e: any) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        text += r[0].transcript;
        if (r.isFinal) finalText += r[0].transcript;
      }
      setInput(text);
    };
    rec.onerror = (e: any) => {
      setListening(false);
      if (e.error === 'aborted' || e.error === 'no-speech') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setErr('未开启麦克风权限，请在浏览器地址栏或系统设置里允许访问麦克风，或者直接打字。');
        return;
      }
      setErr(`语音识别出错，请重试（${e.error}）`);
    };
    rec.onend = () => {
      setListening(false);
      const said = (finalText || '').trim();
      if (said) {
        setInput('');
        void sendText(said);
      }
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setErr('语音启动失败，请重试；还不行就直接打字。');
    }
  }

  function stopVoice() {
    recRef.current?.stop();
    setListening(false);
  }

  async function sendImage(file: File) {
    if (busy) return;
    setErr('');
    setBusy(true);
    const caption = input.trim();
    try {
      const image = await compressImage(file);
      const result = await sendRecordDraft(createRecordDraft('photo', caption, image)).catch(() => null);
      setInput('');
      router.push('/log');
      if (result) router.refresh();
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmFood(draftId: string, items: FoodItem[]) {
    const res = await fetch('/api/meals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId, items }),
    });
    const data = (await res.json()) as { reply?: AssistantReply; error?: string };
    if (!res.ok) {
      setErr(data.error ?? '记录失败');
      throw new Error(data.error ?? '记录失败');
    }
    setMsgs((prev) => {
      const updated = prev.map((m) =>
        m.role === 'assistant' && m.kind === 'food' && m.draftId === draftId
          ? { ...m, status: 'confirmed' as const }
          : m,
      );
      return data.reply ? [...updated, toMsg(data.reply)] : updated;
    });
    await refreshToday();
  }

  async function saveMemories(msgId: string, candidates: CandidateMemory[]) {
    const res = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidates }),
    });
    if (!res.ok) {
      setErr('记忆保存失败');
      throw new Error('记忆保存失败');
    }
    setMsgs((prev) =>
      prev.map((m) =>
        m.id === msgId && m.role === 'assistant' && m.kind === 'memory' ? { ...m, status: 'saved' as const } : m,
      ),
    );
    await refreshToday();
  }

  function dismissMemory(msgId: string) {
    setMsgs((prev) =>
      prev.map((m) =>
        m.id === msgId && m.role === 'assistant' && m.kind === 'memory'
          ? { ...m, status: 'dismissed' as const }
          : m,
      ),
    );
  }

  async function deleteMeal(id: number) {
    await fetch(`/api/meals?id=${id}`, { method: 'DELETE' });
    await refreshToday();
  }

  async function deleteMemory(id: number) {
    await fetch(`/api/memory?id=${id}`, { method: 'DELETE' });
    await refreshToday();
  }

  const profile = today?.profile;
  const hasFood = msgs.some((m) => m.role === 'assistant' && m.kind === 'food');
  const target = profile?.target_kcal ?? 0;
  const targetProtein = profile?.target_protein ?? 0;
  const targets = profile ? {
    protein: targetProtein || 120,
    carb: target ? Math.round(target * .5 / 4) : 280,
    fat: target ? Math.round(target * .3 / 9) : 70,
  } : undefined;
  return (
    <div className="snap">
      <header className="snap-head">
        <Link className="snap-back" href="/log" aria-label="返回记录"><Icon name="chevron-left" size={20} stroke={2} />记录</Link>
        <div className="journal-head-actions">
          <span className="journal-head-label">饮食识别</span>
          <button type="button" className="journal-head-circle" aria-pressed={speakOn}
            aria-label={speakOn ? '关闭语音播报' : '打开语音播报'} title={speakOn ? '语音播报已开' : '语音播报已关'}
            onClick={() => {
              setSpeakOn((v) => !v);
              if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
            }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />{speakOn ? <path d="M15.5 9a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11" /> : <path d="m16 9.5 5 5m0-5-5 5" />}
            </svg>
          </button>
          <button type="button" className="journal-head-circle" aria-label="今日饮食记录" onClick={() => setDrawer(true)}><Icon name="list" size={17} stroke={1.9} /></button>
        </div>
      </header>

      <main className="snap-thread" ref={scrollRef}>
        {msgs.map((m, index) => {
          if (m.role === 'user') {
            const next = msgs[index + 1] as (Msg & { kind?: string }) | undefined;
            const scanning = next?.role === 'assistant' && next.kind === 'pending';
            // 识别结果卡里已经有这张照片，就不再单独显示一遍
            if (m.image && !m.text && next?.role === 'assistant' && next.kind === 'food') return null;
            return (
              <div className="snap-msg user" key={m.id}>
                {m.image && !(next?.role === 'assistant' && next.kind === 'food') && <div className="snap-photo" data-scanning={(scanning && Boolean(m.image)) || undefined}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.image} alt="上传的照片" />
                  <span className="snap-scan" aria-hidden="true" />
                </div>}
                {m.text && <div className="snap-bubble">{m.text}</div>}
              </div>
            );
          }
          if (m.kind === 'text') {
            return <div className="snap-msg ai" key={m.id}><p>{m.text}</p></div>;
          }
          if (m.kind === 'pending') {
            return <div className="snap-msg ai pending" key={m.id} role="status"><p>{m.text === '看照片' ? '正在识别这一餐' : m.text}<span className="snap-dots" aria-hidden="true"><i /><i /><i /></span></p></div>;
          }
          if (m.kind === 'food') {
            const prev = msgs[index - 1];
            const photo = m.photoUrl ?? (prev?.role === 'user' ? prev.image : undefined);
            return (
              <div className="snap-msg snap-slot" key={m.id}>
                <FoodCard mealType={m.mealType} items={m.items} note={m.note} status={m.status} photoUrl={photo} targets={targets}
                  onConfirm={(items) => confirmFood(m.draftId, items)} />
              </div>
            );
          }
          return (
            <div className="snap-msg snap-slot" key={m.id}>
              <MemoryProposal candidates={m.candidates} status={m.status}
                onSave={(c) => saveMemories(m.id, c)} onDismiss={() => dismissMemory(m.id)} />
            </div>
          );
        })}

        {!hasFood && !busy && <button type="button" className="snap-capture" onClick={() => fileRef.current?.click()}>
          <span className="snap-capture-icon"><Icon name="camera" size={30} stroke={1.6} /></span>
          <b>拍一张这顿饭</b>
          <small>识别后可以改份量，再记入这一餐</small>
        </button>}
      </main>

      {err && <p className="snap-err" role="alert">{err}</p>}

      <div className="snap-quick">
        {['今天练胸', '今天练背', '今天练腿', '今天练肩'].map((q) => (
          <button key={q} type="button" onClick={() => void sendText(q)} disabled={busy}>{q}</button>
        ))}
      </div>

      <footer className="snap-composer">
        <button type="button" className={`snap-icon${listening ? ' on' : ''}`}
          onClick={() => (listening ? stopVoice() : startVoice())} disabled={busy} title="语音输入" aria-label="语音输入">
          <Icon name="mic" size={20} />
        </button>
        <input
          value={input}
          placeholder={listening ? '正在听…说完会自动发送' : '吃了什么？或者今天想练什么…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendText(); }}
        />
        {input.trim()
          ? <button type="button" className="snap-icon ink" onClick={() => void sendText()} disabled={busy} aria-label="发送"><Icon name="arrow-up" size={20} stroke={2.2} /></button>
          : <button type="button" className="snap-icon ink" onClick={() => fileRef.current?.click()} disabled={busy} title="拍照 / 相册" aria-label="拍照或从相册选择"><Icon name="camera" size={20} /></button>}
      </footer>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void sendImage(f);
          e.target.value = '';
        }}
      />

      {drawer && (
        <Drawer
          today={today}
          onClose={() => setDrawer(false)}
          onDeleteMeal={deleteMeal}
          onDeleteMemory={deleteMemory}
        />
      )}
    </div>
  );
}
