export type RecordDraft = {
  request_id: string;
  source: 'manual' | 'voice' | 'photo';
  text: string;
  photo?: string;
  logged_at: string;
};

const memory = new Map<string, RecordDraft>();

function draftStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('fitcheck-records', 1);
    opening.onerror = () => reject(opening.error);
    opening.onupgradeneeded = () => opening.result.createObjectStore('drafts', { keyPath: 'request_id' });
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('drafts', mode);
      const request = run(tx.objectStore('drafts'));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

export function createRecordDraft(source: RecordDraft['source'], text: string, photo?: string): RecordDraft {
  return { request_id: crypto.randomUUID(), source, text, photo, logged_at: new Date().toISOString() };
}

export async function recordDrafts() {
  const stored = await draftStore('readonly', (store) => store.getAll()).catch((): RecordDraft[] => []);
  return [...new Map([...stored.map((draft) => [draft.request_id, draft] as const), ...memory]).values()]
    .sort((a, b) => a.logged_at.localeCompare(b.logged_at));
}

export async function keepRecordDraft(draft: RecordDraft) {
  memory.set(draft.request_id, draft);
  await draftStore('readwrite', (store) => store.put(draft)).catch(() => undefined);
  window.dispatchEvent(new Event('fitcheck-record-drafts'));
}

export async function removeRecordDraft(id: string) {
  memory.delete(id);
  await draftStore('readwrite', (store) => store.delete(id)).catch(() => undefined);
  window.dispatchEvent(new Event('fitcheck-record-drafts'));
}

const sending = new Map<string, Promise<{ route?: string; question?: string }>>();

export function sendRecordDraft(draft: RecordDraft) {
  const existing = sending.get(draft.request_id);
  if (existing) return existing;
  const request = (async () => {
    await keepRecordDraft(draft);
    const res = await fetch('/api/ledger', {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const result = await res.json() as { route?: string; question?: string; error?: string };
    if (!res.ok) throw Error(result.error || '记录失败，请重试');
    await removeRecordDraft(draft.request_id);
    return result;
  })().finally(() => sending.delete(draft.request_id));
  sending.set(draft.request_id, request);
  return request;
}
