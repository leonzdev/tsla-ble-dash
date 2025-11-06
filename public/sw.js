// Minimal service worker to satisfy PWA install criteria
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// No-op fetch handler (ensures SW controls the page)
self.addEventListener('fetch', (event) => {
  // Pass-through
  event.respondWith(fetch(event.request));
});

