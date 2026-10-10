// Tag list — service worker (v81).
// Даёт работу без интернета: приложение открывается из кэша, когда сети нет.
// Свежие файлы берутся из сети (network-first с таймаутом), кэш — запасной путь.
// OCR (api.ocr.space) никогда не кэшируется и всегда идёт напрямую в сеть.
const CACHE_PREFIX = 'tag-list-';
const CACHE_NAME = CACHE_PREFIX + 'v81-1';
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/ocr.js',
  './js/vendor/xlsx.full.min.js',
  './manifest.webmanifest',
  './favicon-64.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];
const NETWORK_TIMEOUT_MS = 3500;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(APP_SHELL.map(url =>
        // cache:'reload' — мимо HTTP-кэша браузера, чтобы не сохранить старую версию.
        fetch(new Request(url, { cache: 'reload' }))
          .then(res => { if (res.ok) return cache.put(url, res); })
          .catch(() => {})
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      // Удаляем только старые кэши этого приложения: на github.io у одного
      // аккаунта общий origin, чужие кэши трогать нельзя.
      keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

function networkFirst(request, cacheKey) {
  return new Promise(resolve => {
    let settled = false;
    const fallback = () => caches.match(cacheKey || request, { ignoreSearch: true })
      .then(cached => cached || (request.mode === 'navigate' ? caches.match('./index.html') : null));
    const timer = setTimeout(() => {
      fallback().then(cached => { if (cached && !settled) { settled = true; resolve(cached); } });
    }, NETWORK_TIMEOUT_MS);
    fetch(request).then(response => {
      clearTimeout(timer);
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(cacheKey || request, copy)).catch(() => {});
      }
      if (!settled) { settled = true; resolve(response); }
    }).catch(() => {
      clearTimeout(timer);
      fallback().then(cached => {
        if (!settled) { settled = true; resolve(cached || Response.error()); }
      });
    });
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // OCR и прочие внешние запросы — без SW.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }
  if (url.pathname.endsWith('/js/vendor/xlsx.full.min.js')) {
    // Библиотека Excel меняется только вместе с версией — сначала кэш.
    event.respondWith(caches.match(request, { ignoreSearch: true }).then(c => c || networkFirst(request)));
    return;
  }
  event.respondWith(networkFirst(request));
});
