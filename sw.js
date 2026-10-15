// Tag list — service worker (v107).
// Даёт работу без интернета: приложение открывается из кэша, когда сети нет.
// Свежие файлы берутся из сети (network-first с таймаутом), кэш — запасной путь.
// OCR (api.ocr.space) никогда не кэшируется и всегда идёт напрямую в сеть.
// v101: движок и модели локального распознавания (js/ocr-local/, ~16 МБ) кэшируются при установке,
// чтобы фото распознавалось без интернета с первого же раза.
const CACHE_PREFIX = 'tag-list-';
const CACHE_NAME = CACHE_PREFIX + 'v107-1'; // v107: язык интерфейса RU / EN
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/i18n.js', // v107: язык интерфейса RU / EN
  './js/i18n-en.js', // v107: английский словарь
  './js/tag-format.js', // v105: разбор тегов по формату
  './js/app.js',
  './js/ocr.js',
  './js/gas.js',
  './js/loop.js',
  './js/elec.js', // v106: конвертор «Электроэнергетика»
  './js/ocr-local.js',
  './js/ocr-local/worker.js',
  './js/ocr-local/tesseract-core-simd-lstm.wasm.js',
  './js/ocr-local/tesseract-core-lstm.wasm.js',
  './js/ocr-local/rus.traineddata',
  './js/ocr-local/eng.traineddata',
  './css/fonts/ibm-plex-mono-cyrillic-500-normal.woff2',
  './css/fonts/ibm-plex-mono-latin-500-normal.woff2',
  './css/fonts/ibm-plex-mono-cyrillic-600-normal.woff2',
  './css/fonts/ibm-plex-mono-latin-600-normal.woff2',
  './js/vendor/xlsx.full.min.js',
  './manifest.webmanifest',
  './splash-tags.webp', // v99: картинка заставки
  // Иконки с ?v=: при смене картинки меняется адрес, и установленное приложение
  // (Android/Chrome) замечает новую иконку, а не берёт старую из кэша.
  './favicon-64.png?v=96-3',
  './icon-180.png?v=96-3',
  './icon-192.png?v=96-3',
  './icon-512.png?v=96-3',
  './icon-192-maskable.png?v=96-3',
  './icon-512-maskable.png?v=96-3'
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
  if (url.pathname.endsWith('/js/vendor/xlsx.full.min.js') || url.pathname.includes('/js/ocr-local/')) {
    // Библиотека Excel и движок распознавания меняются только вместе с версией — сначала кэш.
    event.respondWith(caches.match(request, { ignoreSearch: true }).then(c => c || networkFirst(request)));
    return;
  }
  event.respondWith(networkFirst(request));
});
