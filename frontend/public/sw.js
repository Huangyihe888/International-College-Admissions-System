/* 自毁 SW — 清空所有缓存后注销 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', () => {
  self.registration.unregister();
  caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
