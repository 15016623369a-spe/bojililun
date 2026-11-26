const CACHE_NAME = 'fitcheck-offline-v1';
const CORE_PAGES = ['/train', '/body', '/review', '/me', '/log'];
const CORE_ASSETS = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

function cleanResponse(res) {
  if (!res || !res.redirected) return res;
  const headers = new Headers(res.headers);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'WARM_OFFLINE') return;
  const urls = [...new Set([...CORE_PAGES, ...CORE_ASSETS, ...(Array.isArray(msg.urls) ? msg.urls : [])])];
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const u of urls) {
        try {
          const res = await fetch(u, { credentials: 'same-origin' });
          if (res.ok) await cache.put(u, cleanResponse(res.clone()));
        } catch { /* ignore individual asset failure */ }
      }
      const clients = await self.clients.matchAll();
      for (const client of clients) client.postMessage({ type: 'WARM_OFFLINE_DONE', count: urls.length });
    }),
  );
});

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/_next/static/')
    || pathname.startsWith('/icons/')
    || pathname.startsWith('/models/')
    || pathname.startsWith('/draco/')
    || pathname.startsWith('/plan-poses/')
    || pathname.startsWith('/exercises/')
    || pathname.startsWith('/sculpture-exercises/')
  );
}

async function fetchWithTimeout(request, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(request, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) await cache.put(req, cleanResponse(res.clone()));
          return res;
        } catch {
          return new Response('', { status: 503 });
        }
      }),
    );
    return;
  }

  // 页面导航与 Next.js 路由切换：优先连网（2.5 秒超时），离线立即退回本地缓存
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const res = await fetchWithTimeout(req, 2500);
        if (res.ok) await cache.put(req, cleanResponse(res.clone()));
        return res;
      } catch {
        const exact = await cache.match(req);
        if (exact) return exact;
        const byPath = await cache.match(url.pathname);
        if (byPath) return byPath;
        const fallback = await cache.match('/train');
        if (fallback) return fallback;
        return new Response('离线缓存尚未就绪，请先连网打开一次 FitCheck。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    }),
  );
});
