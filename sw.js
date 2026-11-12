// Tag list — service worker (v128).
// Даёт работу без интернета: приложение открывается из кэша, когда сети нет.
// Свежие файлы берутся из сети (network-first с таймаутом), кэш — запасной путь.
// OCR (api.ocr.space) никогда не кэшируется и всегда идёт напрямую в сеть.
// v101: движок и модели локального распознавания (js/ocr-local/, ~16 МБ) кэшируются при установке,
// чтобы фото распознавалось без интернета с первого же раза.
// v128: второй локальный движок — OCRv5 (js/ocr-pp/ и ONNX Runtime в js/vendor/, ~23 МБ) — кэшируется так же.
const CACHE_PREFIX = 'tag-list-';
const CACHE_NAME = CACHE_PREFIX + 'v128-1'; // v128: второй локальный движок распознавания — нейросеть PP-OCRv5 (переключатель «Tesseract / OCRv5» в окне фото): бирки и шильдики под углом, вверх ногами, гравировка на стали — без интернета; сверка тега с фото с тэг-листом — подсказка «В списке есть похожий тег»; v127: уборка — удалён устаревший js/ocr.js (не подключался с v118) и его строка в кэше; v126: верхняя панель выпадает и убирается плавно; фото в окне обрезки всегда вписано в экран и не закрывает кнопки (в v125 высокое или повёрнутое фото выталкивало ряд кнопок за экран); поиск бирки настроен на реальных фото с объекта — отсев решёток и фактуры, голосование нескольких чтений, мелкие надписи в таблице шильдика, кабельные бирки «откуда / куда»; v125: шапка сворачивается стрелкой в строке «Сохранено…»; окно обрезки на весь экран с одним рядом кнопок; форматы для любых списков — готовые наборы, любой текст, свой вариант с любым образцом; поля заданий в списке найденного увеличиваются при касании; поиск бирки на фото перед чтением; v124: окно обрезки фото на весь экран — фото занимает всё свободное место; v123: увеличение фото и автозум рамки в окне обрезки; v122: убраны подсказки в окне фото и таймер переключателя разделов; v121: длинные окна прокручиваются (кнопки обрезки не уходят за экран), Android — системный выбор до 9 фото с подготовкой в фоне
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/i18n.js', // v107: язык интерфейса RU / EN
  './js/i18n-en.js', // v107: английский словарь
  './js/tag-format.js', // v105: разбор тегов по формату
  './js/tag-photos.js', // v112: фото к заданию тега
  './js/tag-camera.js', // v114: серийная съёмка фото к тегу
  './js/app.js',
  './js/gas.js',
  './js/loop.js',
  './js/elec.js', // v106: конвертор «Электроэнергетика»
  './js/ocr-local.js',
  './js/ocr-local/worker.js',
  './js/ocr-local/tesseract-core-simd-lstm.wasm.js',
  './js/ocr-local/tesseract-core-lstm.wasm.js',
  './js/ocr-local/rus.traineddata',
  './js/ocr-local/eng.traineddata',
  './js/ocr-pp.js', // v128: OCRv5 — нейросеть PP-OCRv5 на ONNX Runtime Web
  './js/ocr-pp/worker.js',
  './js/ocr-pp/PP-OCRv5_mobile_det.onnx',
  './js/ocr-pp/eslav_PP-OCRv5_mobile_rec.onnx',
  './js/ocr-pp/ppocrv5_eslav_dict.txt',
  './js/vendor/ort.wasm.min.js',
  './js/vendor/ort-wasm-simd.wasm',
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
  if (url.pathname.endsWith('/js/vendor/xlsx.full.min.js') || url.pathname.includes('/js/ocr-local/')
      || /\/js\/ocr-pp\/[^/]+\.(?:onnx|txt)$/.test(url.pathname) || /\/js\/vendor\/ort[.-][^/]+$/.test(url.pathname)) {
    // Библиотека Excel, движки распознавания и модели меняются только вместе с версией — сначала кэш.
    // v128: модели OCRv5 и ONNX Runtime — так же; js/ocr-pp/worker.js — обычным порядком (это код приложения).
    event.respondWith(caches.match(request, { ignoreSearch: true }).then(c => c || networkFirst(request)));
    return;
  }
  event.respondWith(networkFirst(request));
});
