'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantReply, CandidateMemory, FoodItem, TodayPayload } from '@/lib/types';
import type { MealType } from '@/lib/date';
import FoodCard from '@/components/FoodCard';
import MemoryProposal from '@/components/MemoryProposal';
import Drawer from '@/components/Drawer';

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

    const target = t.profile?.target_kcal ?? 0;
    const protein = t.profile?.target_protein ?? 0;
    const greeting =
      !t.profile ? '可以拍照记录饮食，也可以告诉我想练哪个部位。' : t.consumed.kcal > 0
        ? `今天已摄入 ${t.consumed.kcal} kcal（目标 ${target}），还剩 ${Math.max(0, t.remainingKcal)} kcal；蛋白质 ${Math.round(
            t.consumed.protein,
          )}/${protein}g。`
        : `今天还没记录。你的目标是 ${target} kcal、蛋白质 ${protein}g。\n拍一张照片就能记一餐，也可以直接说「午饭吃了米饭 200g 和一个鸡腿」。`;

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
      { id: pendingId, role: 'assistant', kind: 'pending', text: '想一想' },
    ]);
    try {
      await postChat({ text }, pendingId);
    } catch (e) {
      failPending(pendingId, `出了点问题：${(e as Error).message}`);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startVoice() {
    if (typeof window === 'undefined') return;
    if (!window.isSecureContext) {
      setErr('语音输入需要 HTTPS 环境：当前是 HTTP，浏览器不会开放麦克风。手机请改用 https:// 地址访问（服务端运行 npm run dev:https），或在电脑浏览器打开 localhost。');
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setErr('这个浏览器不支持语音识别，试试 Chrome / Safari，或者直接打字。');
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
        setErr('麦克风没授权：点浏览器地址栏左侧的图标，把麦克风设为「允许」后重试。iPhone 还需在 设置 → Safari → 麦克风 选「允许」；安卓在 设置 → 应用 → 浏览器 → 权限 里开麦克风。');
        return;
      }
      setErr(`语音识别出错：${e.error}`);
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
    const pendingId = uid();
    const caption = input.trim();
    setInput('');
    try {
      const dataUrl = await compressImage(file);
      setMsgs((prev) => [
        ...prev,
        { id: uid(), role: 'user', image: dataUrl, text: caption || undefined },
        { id: pendingId, role: 'assistant', kind: 'pending', text: '看照片' },
      ]);
      await postChat({ image: dataUrl, text: caption || undefined }, pendingId);
    } catch (e) {
      failPending(pendingId, `照片处理失败：${(e as Error).message}`);
      setErr((e as Error).message);
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
  const consumed = today?.consumed.kcal ?? 0;
  const target = profile?.target_kcal ?? 0;
  const kcalPct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
  const protein = Math.round(today?.consumed.protein ?? 0);
  const targetProtein = profile?.target_protein ?? 0;
  const proteinPct = targetProtein > 0 ? Math.min(100, Math.round((protein / targetProtein) * 100)) : 0;
  const remaining = target - consumed;

  return (
    <div className="app">
      <header className="hdr">
        <div className="hdr-top">
          <div className="brand">
            <Link className="chat-back" href="/" aria-label="返回记录">
              ‹
            </Link>
            拍照记录
          </div>
          <div className="hdr-actions">
            <button
              className={`chip-btn ${speakOn ? 'on' : ''}`}
              onClick={() => {
                setSpeakOn((v) => !v);
                if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
              }}
              title={speakOn ? '语音播报已开' : '语音播报已关'}
            >
              {speakOn ? '🔊 播报' : '🔇 静音'}
            </button>
            <button className="chip-btn" onClick={() => setDrawer(true)}>
              今日记录
            </button>
          </div>
        </div>

        {profile && (
          <div className="stats">
            <div className="stat-row">
              <span className="stat-label">
                热量 · {remaining >= 0 ? `还剩 ${remaining} kcal` : `已超 ${Math.abs(remaining)} kcal`}
              </span>
              <span className="stat-value">
                <b>{consumed}</b> / {target} kcal
              </span>
              <div className={`bar ${remaining < 0 ? 'over' : ''}`}>
                <i style={{ width: `${kcalPct}%` }} />
              </div>
            </div>
            <div className="stat-row">
              <span className="stat-label">
                蛋白质 · 还差 {Math.max(0, targetProtein - protein)} g
              </span>
              <span className="stat-value">
                <b>{protein}</b> / {targetProtein} g
              </span>
              <div className="bar">
                <i style={{ width: `${proteinPct}%` }} />
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="chat" ref={scrollRef}>
        {msgs.map((m) => {
          if (m.role === 'user') {
            return (
              <div className="msg user" key={m.id}>
                {m.image && <img src={m.image} alt="上传的照片" />}
                {m.text && <div>{m.text}</div>}
              </div>
            );
          }
          if (m.kind === 'text') {
            return (
              <div className="msg ai" key={m.id}>
                <div className="bubble">{m.text}</div>
              </div>
            );
          }
          if (m.kind === 'pending') {
            return (
              <div className="msg ai pending" key={m.id}>
                <div className="bubble">
                  {m.text}
                  <span className="dots" />
                </div>
              </div>
            );
          }
          if (m.kind === 'food') {
            return (
              <div className="msg ai" key={m.id} style={{ maxWidth: '100%', width: '100%' }}>
                <FoodCard
                  mealType={m.mealType}
                  items={m.items}
                  note={m.note}
                  status={m.status}
                  onConfirm={(items) => confirmFood(m.draftId, items)}
                />
              </div>
            );
          }
          return (
            <div className="msg ai" key={m.id} style={{ maxWidth: '100%', width: '100%' }}>
              <MemoryProposal
                candidates={m.candidates}
                status={m.status}
                onSave={(c) => saveMemories(m.id, c)}
                onDismiss={() => dismissMemory(m.id)}
              />
            </div>
          );
        })}
      </main>

      {err && <div className="err">{err}</div>}

      <div className="quick">
        {['今天练胸', '今天练背', '今天练腿', '今天练肩'].map((q) => (
          <button key={q} onClick={() => void sendText(q)} disabled={busy}>
            {q}
          </button>
        ))}
      </div>

      <footer className="composer">
        <button
          className={`icon-btn mic ${listening ? 'on' : ''}`}
          onClick={() => (listening ? stopVoice() : startVoice())}
          disabled={busy}
          title="语音输入"
          aria-label="语音输入"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </button>
        <button className="icon-btn" onClick={() => fileRef.current?.click()} disabled={busy} title="拍照 / 相册" aria-label="拍照或从相册选择">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.1-1.8h6.4L15.8 6h2.7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9Z" />
            <circle cx="12" cy="12.8" r="3.4" />
          </svg>
        </button>
        <input
          value={input}
          placeholder={listening ? "正在听…说完会自动发送" : "吃了什么？或者今天想练什么…"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendText();
          }}
        />
        <button className="send" onClick={() => void sendText()} disabled={busy || !input.trim()}>
          发送
        </button>
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
