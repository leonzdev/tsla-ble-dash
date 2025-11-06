// Simple offline + update flow
const CACHE_NAME = 'tsla-ble-cache-v1';
const ASSET_DESTS = new Set(['script', 'style', 'image', 'font']);

self.addEventListener('install', (event) => {
  // Activate new SW immediately after install (we'll coordinate reload in page)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Claim clients so this SW controls open pages
      await self.clients.claim();
      // Cleanup old caches
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    })(),
  );
});

// Support page-initiated updates
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // Network-first for navigations (HTML) so updates are detected quickly
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const netResp = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put('index.html', netResp.clone());
          return netResp;
        } catch (_) {
          const cached = await caches.match('index.html');
          if (cached) return cached;
          // Fallback to default fetch if nothing cached
          return fetch(req);
        }
      })(),
    );
    return;
  }

  // Cache-first for static assets (scripts, styles, images, fonts)
  if (ASSET_DESTS.has(req.destination)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const netResp = await fetch(req);
          cache.put(req, netResp.clone());
          return netResp;
        } catch (_) {
          // If offline and not cached, bubble up error
          throw _;
        }
      })(),
    );
  }
});
