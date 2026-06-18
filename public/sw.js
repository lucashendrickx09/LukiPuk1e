// Stockpile service worker.
// 1) Speeds up reopens by caching the app shell: hashed static assets are
//    served cache-first (instant, and safe because their filenames change on
//    each deploy), while the HTML document is network-first so new deploys show
//    up, falling back to cache when offline.
// 2) Powers on-device notifications via registration.showNotification().
// API calls (Finnhub/Stooq/Anthropic) are cross-origin and pass straight
// through to the network — only the app's own files are cached.

const CACHE = 'stockpile-shell-v1';
const ASSET_RE = /\/_expo\/|\.(?:js|css|png|jpe?g|gif|svg|webp|woff2?|ttf|ico|json|map)$/i;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // leave API/data calls alone
  if (url.pathname.endsWith('/sw.js')) return;

  // App document: network-first (fresh deploys), cache fallback when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(req);
          return cached || (await caches.match(self.registration.scope)) || Response.error();
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first for instant reopens.
  if (ASSET_RE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) {
          return cached;
        }
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.status === 200 && fresh.type === 'basic') {
            const cache = await caches.open(CACHE);
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          return Response.error();
        }
      })(),
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(self.registration.scope);
    }),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Stockpile', {
      body: data.body || '',
      tag: data.tag,
    }),
  );
});
