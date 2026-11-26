'use client';

import type { PlanItem, SetRow } from './types';

export interface OfflineDemoMedia {
  image?: string;
  hasAnimation: boolean;
  hasSculpture?: boolean;
  mp4Url?: string;
  kfSheetUrl?: string;
}

export interface OfflineExercise {
  id: string;
  name: string;
  zh_name: string;
  body_part: string;
  target: string;
  equipment: string;
  secondary_muscles: string;
  image: string;
  hasAnimation: boolean;
  hasSculpture?: boolean;
  mp4Url?: string;
  kfSheetUrl?: string;
  mechanic: string;
  movement_pattern: string;
  metabolic_demand: string;
  met_range: string;
  fatigue_level: string;
  recommended_rep_range: string;
  steps: string[];
  preference: 'liked' | 'disliked' | null;
}

export interface OfflineSnapshot {
  syncedAt: string;
  today: string;
  planDate: string;
  activeSession: { id: number; startedAt: string; date?: string } | null;
  plan: PlanItem[];
  currentSets: SetRow[];
  recentSets: SetRow[];
  demoMap: Record<string, OfflineDemoMedia>;
}

export interface OfflineMutation {
  id: string;
  ts: number;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  body?: Record<string, unknown>;
}

const DB_NAME = 'fitcheck_offline_v1';
const STORE = 'kv';
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}

export const readOfflineSnapshot = () => kvGet<OfflineSnapshot>('snapshot');
export const writeOfflineSnapshot = (snap: OfflineSnapshot) => kvSet('snapshot', snap);
export const readOfflineExercises = () => kvGet<OfflineExercise[]>('exercises');
export const writeOfflineExercises = (list: OfflineExercise[]) => kvSet('exercises', list);
export const readOutbox = async () => (await kvGet<OfflineMutation[]>('outbox')) ?? [];
export const replaceOutbox = (items: OfflineMutation[]) => kvSet('outbox', items);

export async function appendOutbox(item: Omit<OfflineMutation, 'id' | 'ts'>): Promise<OfflineMutation[]> {
  const list = await readOutbox();
  const next = [...list, { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ts: Date.now() }];
  await replaceOutbox(next);
  return next;
}

export async function exportOfflineBackupJson(): Promise<string> {
  const [snapshot, outbox] = await Promise.all([readOfflineSnapshot(), readOutbox()]);
  return JSON.stringify({
    schemaVersion: 1,
    app: 'FitCheck',
    exportedAt: new Date().toISOString(),
    snapshot,
    outbox,
  }, null, 2);
}

export async function importOfflineBackupJson(rawText: string): Promise<{ setsCount: number; planCount: number }> {
  const parsed = JSON.parse(rawText) as {
    schemaVersion?: number;
    app?: string;
    snapshot?: OfflineSnapshot | null;
    outbox?: OfflineMutation[];
  };
  if (parsed.app !== 'FitCheck' || parsed.schemaVersion !== 1 || !parsed.snapshot) {
    throw new Error('备份文件格式不对，请选择 FitCheck 导出的备份文件');
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(parsed.snapshot, 'snapshot');
    tx.objectStore(STORE).put(Array.isArray(parsed.outbox) ? parsed.outbox : [], 'outbox');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return {
    setsCount: (parsed.snapshot.recentSets?.length ?? 0) + (parsed.snapshot.currentSets?.length ?? 0),
    planCount: parsed.snapshot.plan?.length ?? 0,
  };
}
