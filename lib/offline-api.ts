'use client';

import { muscleById, muscleMatchesExercise, type MuscleGroup } from './muscles';
import { sculptureGroup } from './sculpture-groups';
import type { PlanItem, SetRow } from './types';
import {
  appendOutbox,
  readOfflineExercises,
  readOfflineSnapshot,
  readOutbox,
  replaceOutbox,
  requestPersistentStorage,
  writeOfflineExercises,
  writeOfflineSnapshot,
  type OfflineExercise,
  type OfflineSnapshot,
} from './offline-store';

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function localTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function ensureSnapshot(): Promise<OfflineSnapshot> {
  const existing = await readOfflineSnapshot();
  if (existing) return existing;
  const today = localTodayStr();
  return {
    syncedAt: '',
    today,
    planDate: today,
    activeSession: null,
    plan: [],
    currentSets: [],
    recentSets: [],
    demoMap: {},
  };
}

/** 离线时按 /api/exercises 完全一致的口径过滤本地缓存的 1,324 个动作 */
async function queryOfflineExercises(url: URL) {
  const all = (await readOfflineExercises()) ?? [];
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const groupId = url.searchParams.get('group');
  const muscleId = url.searchParams.get('muscle');
  const pref = url.searchParams.get('preference');
  const equipments = url.searchParams.getAll('equipment').filter(Boolean);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

  let label: string | null = null;
  let matchGroups: MuscleGroup[] | null = null;

  if (groupId) {
    const g = sculptureGroup(groupId);
    if (g) {
      label = g.label;
      matchGroups = g.members.map((id) => muscleById(id)).filter((m): m is MuscleGroup => Boolean(m));
    }
  } else if (muscleId) {
    const m = muscleById(muscleId);
    if (m) {
      label = m.label;
      matchGroups = [m];
    }
  }

  let filtered = all.filter((ex) => {
    if (pref === 'liked' && ex.preference !== 'liked') return false;
    if (equipments.length > 0 && !equipments.includes(ex.equipment)) return false;
    if (matchGroups && !matchGroups.some((g) => muscleMatchesExercise(g, ex))) return false;
    if (q) {
      const hay = `${ex.zh_name} ${ex.name} ${ex.target} ${ex.body_part}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // 常练动作优先排前
  filtered = [...filtered].sort((a, b) => (a.preference === 'liked' ? -1 : 0) - (b.preference === 'liked' ? -1 : 0));
  const slice = filtered.slice(offset, offset + limit).map((e) => ({ ...e, desc: e.steps[0] ?? '' }));
  const nextOffset = offset + slice.length < filtered.length ? offset + slice.length : null;
  return { label, total: filtered.length, items: slice, nextOffset };
}

/** 从服务端拉取最新完整离线包并预热 Service Worker 静态资源 */
export async function syncOfflineBootstrap(): Promise<{ exercises: number; syncedAt: string } | null> {
  await requestPersistentStorage();
  await flushOfflineOutbox();
  const pending = await readOutbox();
  const res = await fetch('/api/offline/bootstrap', { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as OfflineSnapshot & { exercises: OfflineExercise[] };
  await writeOfflineExercises(data.exercises ?? []);
  if (pending.length === 0) {
    await writeOfflineSnapshot({
      syncedAt: data.syncedAt,
      today: data.today,
      planDate: data.planDate,
      activeSession: data.activeSession,
      plan: data.plan,
      currentSets: data.currentSets,
      recentSets: data.recentSets,
      demoMap: data.demoMap,
    });
  }
  const extraUrls = [
    '/models/fitcheck-sculpture-tripo-v1.glb',
    '/models/sculpture-muscle-male-fine-v2.json',
    '/models/sculpture-muscle-male-fine-v2.bin',
    '/draco/draco_decoder.js',
    '/draco/draco_decoder.wasm',
    ...Object.values(data.demoMap ?? {}).map((m) => m.image).filter((x): x is string => Boolean(x)),
  ];
  navigator.serviceWorker?.controller?.postMessage({ type: 'WARM_OFFLINE', urls: extraUrls });
  return { exercises: data.exercises?.length ?? 0, syncedAt: data.syncedAt };
}

/** 连回电脑后按顺序重放离线操作队列，并自动映射离线临时 ID */
export async function flushOfflineOutbox(): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  const items = await readOutbox();
  if (items.length === 0) return 0;
  const planIdMap = new Map<number, number>();
  const sessionIdMap = new Map<number, number>();
  const setIdMap = new Map<number, number>();
  let synced = 0;

  for (let i = 0; i < items.length; i += 1) {
    const m = items[i];
    const body = m.body ? { ...m.body } : undefined;
    let url = m.url;

    if (body) {
      if (typeof body.sessionId === 'number' && sessionIdMap.has(body.sessionId)) body.sessionId = sessionIdMap.get(body.sessionId);
      if (typeof body.planItemId === 'number' && planIdMap.has(body.planItemId)) body.planItemId = planIdMap.get(body.planItemId);
      if (typeof body.firstPlanItemId === 'number' && planIdMap.has(body.firstPlanItemId)) body.firstPlanItemId = planIdMap.get(body.firstPlanItemId);
      if (typeof body.previousSetId === 'number' && setIdMap.has(body.previousSetId)) body.previousSetId = setIdMap.get(body.previousSetId);
      if (typeof body.id === 'number') {
        if (url.startsWith('/api/session/set') && setIdMap.has(body.id)) body.id = setIdMap.get(body.id);
        else if (url === '/api/session' && sessionIdMap.has(body.id)) body.id = sessionIdMap.get(body.id);
        else if (url === '/api/plan' && planIdMap.has(body.id)) body.id = planIdMap.get(body.id);
      }
      if (Array.isArray(body.reorder)) {
        body.reorder = (body.reorder as number[]).map((id) => planIdMap.get(id) ?? id);
      }
    }
    const u = new URL(url, window.location.origin);
    const qid = Number(u.searchParams.get('id'));
    if (Number.isFinite(qid) && qid < 0) {
      const mapped = url.startsWith('/api/plan') ? planIdMap.get(qid) : setIdMap.get(qid);
      if (mapped) { u.searchParams.set('id', String(mapped)); url = u.pathname + u.search; }
    }

    try {
      const res = await fetch(url, {
        method: m.method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        await replaceOutbox(items.slice(i));
        return synced;
      }
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      const localId = typeof body?._localId === 'number' ? body._localId : null;
      if (localId !== null) {
        if (url === '/api/plan' && (data.item as { id?: number })?.id) planIdMap.set(localId, (data.item as { id: number }).id);
        if (url === '/api/session' && (data.session as { id?: number })?.id) sessionIdMap.set(localId, (data.session as { id: number }).id);
        if (url === '/api/session/set' && Array.isArray(data.sets)) {
          const last = (data.sets as SetRow[]).at(-1);
          if (last?.id) setIdMap.set(localId, last.id);
        }
      }
      synced += 1;
    } catch {
      await replaceOutbox(items.slice(i));
      return synced;
    }
  }
  await replaceOutbox([]);
  return synced;
}

async function handleOfflineMutation(method: string, url: URL, rawBody?: string): Promise<Response> {
  const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  const snap = await ensureSnapshot();
  const exercises = (await readOfflineExercises()) ?? [];
  const exById = new Map(exercises.map((e) => [e.id, e]));

  if (url.pathname === '/api/plan') {
    if (method === 'POST') {
      const date = String(body.date || snap.activeSession?.date || snap.today);
      const ids = Array.isArray(body.exerciseIds) ? (body.exerciseIds as string[]) : body.exerciseId ? [String(body.exerciseId)] : [];
      const created: PlanItem[] = [];
      let lastDemo: OfflineSnapshot['demoMap'][string] | undefined;
      for (const exId of ids) {
        const ex = exById.get(exId);
        if (!ex) continue;
        const localId = -(Date.now() + Math.floor(Math.random() * 1000));
        const item: PlanItem = {
          id: localId,
          date,
          exercise_id: ex.id,
          name: ex.zh_name || ex.name,
          body_part: ex.body_part,
          target: ex.target,
          equipment: ex.equipment,
          sets: Number(body.sets || 3),
          reps: Number(body.reps || 10),
          weight: Number(body.weight || 0),
          rest_sec: Number(body.restSec || 90),
          position: snap.plan.length + created.length,
          done: 0,
          supplemental: body.supplemental ? 1 : 0,
          created_at: new Date().toISOString(),
        };
        created.push(item);
        lastDemo = { image: ex.image || undefined, hasAnimation: ex.hasAnimation, hasSculpture: ex.hasSculpture, mp4Url: ex.mp4Url, kfSheetUrl: ex.kfSheetUrl };
        snap.demoMap[ex.id] = lastDemo;
      }
      snap.plan = [...snap.plan, ...created];
      await writeOfflineSnapshot(snap);
      await appendOutbox({ method: 'POST', url: url.pathname, body: { ...body, _localId: created[0]?.id } });
      return jsonRes({ item: created[0], demonstration: lastDemo, items: snap.plan });
    }
    if (method === 'PATCH' && Array.isArray(body.reorder)) {
      const byId = new Map(snap.plan.map((p) => [p.id, p]));
      const reordered: PlanItem[] = [];
      (body.reorder as number[]).forEach((id, idx) => {
        const p = byId.get(id);
        if (p) reordered.push({ ...p, position: idx });
      });
      snap.plan = reordered;
      await writeOfflineSnapshot(snap);
      await appendOutbox({ method: 'PATCH', url: url.pathname, body });
      return jsonRes({ ok: true, items: snap.plan });
    }
    if (method === 'DELETE') {
      const id = Number(url.searchParams.get('id'));
      snap.plan = snap.plan.filter((p) => p.id !== id);
      await writeOfflineSnapshot(snap);
      await appendOutbox({ method: 'DELETE', url: url.pathname + url.search });
      return jsonRes({ ok: true, items: snap.plan });
    }
  }

  if (url.pathname === '/api/session') {
    if (method === 'POST') {
      if (!snap.activeSession) {
        const localId = -Date.now();
        snap.activeSession = { id: localId, startedAt: new Date().toISOString(), date: snap.today };
        await writeOfflineSnapshot(snap);
        await appendOutbox({ method: 'POST', url: url.pathname, body: { ...body, _localId: localId } });
      }
      return jsonRes({ session: { id: snap.activeSession.id, started_at: snap.activeSession.startedAt, date: snap.activeSession.date } });
    }
    if (method === 'PATCH') {
      snap.activeSession = null;
      snap.currentSets = [];
      await writeOfflineSnapshot(snap);
      await appendOutbox({ method: 'PATCH', url: url.pathname, body });
      return jsonRes({ ok: true });
    }
  }

  if (url.pathname === '/api/session/set') {
    if (method === 'POST') {
      const localId = -Date.now();
      const row: SetRow = {
        id: localId,
        session_id: Number(body.sessionId),
        plan_item_id: Number(body.planItemId),
        exercise_id: String(body.exerciseId),
        exercise_name: String(body.exerciseName),
        body_part: String(body.bodyPart),
        target: String(body.target),
        set_index: Number(body.setIndex || 1),
        weight: Number(body.weight || 0),
        reps: Number(body.reps || 1),
        duration_sec: Number(body.durationSec || 0),
        rest_sec: Number(body.restSec || 90),
        actual_rest_sec: null,
        created_at: new Date().toISOString(),
      };
      if (body.previousSetId && body.previousRestSec != null) {
        snap.currentSets = snap.currentSets.map((s) => (s.id === body.previousSetId ? { ...s, actual_rest_sec: Number(body.previousRestSec) } : s));
        snap.recentSets = snap.recentSets.map((s) => (s.id === body.previousSetId ? { ...s, actual_rest_sec: Number(body.previousRestSec) } : s));
      }
      snap.currentSets = [...snap.currentSets, row];
      snap.recentSets = [...snap.recentSets, row];
      await writeOfflineSnapshot(snap);
      await appendOutbox({ method: 'POST', url: url.pathname, body: { ...body, _localId: localId } });
      return jsonRes({ sets: snap.currentSets });
    }
    if (method === 'PATCH') {
      const id = Number(body.id);
      let updated: SetRow | undefined;
      const patch = (s: SetRow) => (s.id === id ? (updated = { ...s, weight: Number(body.weight), reps: Number(body.reps) }) : s);
      snap.currentSets = snap.currentSets.map(patch);
      snap.recentSets = snap.recentSets.map(patch);
      await writeOfflineSnapshot(snap);
      await appendOutbox({ method: 'PATCH', url: url.pathname, body });
      return jsonRes({ set: updated });
    }
    if (method === 'DELETE') {
      const id = Number(url.searchParams.get('id'));
      snap.currentSets = snap.currentSets.filter((s) => s.id !== id);
      snap.recentSets = snap.recentSets.filter((s) => s.id !== id);
      await writeOfflineSnapshot(snap);
      await appendOutbox({ method: 'DELETE', url: url.pathname + url.search });
      return jsonRes({ allSets: snap.currentSets });
    }
  }

  if (url.pathname === '/api/exercise-preferences' && method === 'PUT') {
    const exId = String(body.exerciseId || '');
    const pref = body.preference === 'liked' || body.preference === 'disliked' ? body.preference : null;
    await writeOfflineExercises(exercises.map((e) => (e.id === exId ? { ...e, preference: pref } : e)));
    await appendOutbox({ method: 'PUT', url: url.pathname, body });
    return jsonRes({ ok: true });
  }

  return jsonRes({ error: '当前离线，该操作需联网后使用' }, 503);
}

/** 联网时走服务端并静默同步快照；断网或服务端不可达时自动切换至手机本地数据库 */
export async function offlineFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input, window.location.origin);
  const method = (init?.method ?? 'GET').toUpperCase();
  const tryOffline = async () => {
    if (method === 'GET' && url.pathname === '/api/exercises') {
      return jsonRes(await queryOfflineExercises(url));
    }
    if (method === 'GET' && url.pathname === '/api/plan') {
      const snap = await ensureSnapshot();
      return jsonRes({ items: snap.plan });
    }
    return handleOfflineMutation(method, url, typeof init?.body === 'string' ? init.body : undefined);
  };

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return tryOffline();
  }

  const ctrl = new AbortController();
  const timeout = window.setTimeout(() => ctrl.abort(), 3500);
  const onParentAbort = () => ctrl.abort();
  init?.signal?.addEventListener('abort', onParentAbort, { once: true });
  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    if (method !== 'GET' && res.ok) {
      void syncOfflineBootstrap().catch(() => {});
    }
    return res;
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    return tryOffline();
  } finally {
    window.clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', onParentAbort);
  }
}
