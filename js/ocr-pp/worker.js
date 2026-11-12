// Tag list — распознавание фото нейросетью PP-OCRv5 (фоновый поток), v128.
// Два шага, как в PaddleOCR: детектор строк PP-OCRv5_mobile_det находит на снимке каждую строку текста
// повёрнутым прямоугольником, распознаватель eslav_PP-OCRv5_mobile_rec (русский + латиница + цифры)
// читает строку, вырезанную из исходного снимка в полном разрешении и выровненную.
// Поэтому наклон, поворот на 90°/180° и перспектива бирки не мешают: каждая строка выравнивается сама.
// Модели считает ONNX Runtime Web 1.18.0 (WebAssembly + SIMD, один поток).
// Движок, модели и словарь передаёт основной поток (js/ocr-pp.js): поток сам ничего не скачивает,
// поэтому одинаково работает на GitHub Pages, в установленном PWA без сети и в APK.
'use strict';
let ORT = null, detS = null, recS = null, chars = null, cancelled = 0;

// thresh, boxThresh, unclip — как в конфигурации PP-OCRv5_mobile_det (PaddleOCR): 0.3 / 0.6 / 1.5.
// side — большая сторона снимка для детектора; drop — строки с уверенностью ниже отбрасываются.
const CFG = { side: 1280, thresh: 0.3, boxThresh: 0.6, unclip: 1.5, minSide: 3, drop: 0.5, recH: 48, recW: 320, recMaxW: 2400, maxTiles: 6, smallText: 15 };

const post = m => self.postMessage(m);
const tick = () => new Promise(r => setTimeout(r, 0));   // пропустить сообщение «стоп» между строками
const r32 = v => Math.max(32, Math.round(v / 32) * 32);

async function init({ ortUrl, wasm, det, rec, dict }) {
  // Файл WebAssembly отдаётся из памяти: движок запрашивает его через fetch, а запросы фоновых потоков
  // в APK не всегда доходят до «локального сервера» приложения.
  const realFetch = self.fetch;
  self.fetch = (u, o) => /ort-wasm-simd\.wasm(\?|$)/.test(String((u && u.url) || u))
    ? Promise.resolve(new Response(wasm, { status: 200, headers: { 'Content-Type': 'application/wasm' } }))
    : realFetch(u, o);
  importScripts(ortUrl);
  ORT = self.ort;
  ORT.env.logLevel = 'error';
  ORT.env.wasm.numThreads = 1;     // без SharedArrayBuffer: GitHub Pages не отдаёт заголовки изоляции
  ORT.env.wasm.simd = true;
  ORT.env.wasm.proxy = false;
  ORT.env.wasm.wasmPaths = { 'ort-wasm-simd.wasm': 'https://tag-list.invalid/ort-wasm-simd.wasm' };
  const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  detS = await ORT.InferenceSession.create(new Uint8Array(det), opt);
  recS = await ORT.InferenceSession.create(new Uint8Array(rec), opt);
  self.fetch = realFetch;
  const list = String(dict || '').replace(/\r/g, '').split('\n');
  if (list.length && list[list.length - 1] === '') list.pop();
  chars = [''].concat(list, [' ']);   // 0 — «пусто» (CTC), последний — пробел
  return { ok: true, chars: chars.length };
}

// ------------------------------------------------------------------ снимок
// Целочисленное уменьшение k×k усреднением (для больших снимков — без ряби на мелком тексте).
function shrink(img, k) {
  const w = Math.floor(img.w / k), h = Math.floor(img.h / k), s = img.d, d = new Uint8ClampedArray(w * h * 4), kk = k * k;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < k; j++) { let i = ((y * k + j) * img.w + x * k) * 4; for (let q = 0; q < k; q++, i += 4) { r += s[i]; g += s[i + 1]; b += s[i + 2]; } }
    const o = (y * w + x) * 4; d[o] = r / kk; d[o + 1] = g / kk; d[o + 2] = b / kk; d[o + 3] = 255;
  }
  return { d, w, h };
}
function level(img, k) {
  if (k <= 1) return img;
  img.pyr = img.pyr || {};
  return img.pyr[k] || (img.pyr[k] = shrink(img, k));
}

// Участок снимка (rx, ry, rw, rh) → вход детектора dw×dh: каналы B, G, R, нормировка как в PaddleOCR.
function detTensor(img, rx, ry, rw, rh, dw, dh) {
  const f = Math.max(rw / dw, rh / dh), k = f >= 2 ? Math.floor(f) : 1, s = level(img, k), d = s.d, W = s.w, H = s.h;
  const out = new Float32Array(3 * dw * dh), plane = dw * dh, sx = rw / dw / k, sy = rh / dh / k, ox = rx / k, oy = ry / k;
  for (let y = 0; y < dh; y++) {
    let fy = (y + 0.5) * sy - 0.5 + oy; if (fy < 0) fy = 0; else if (fy > H - 1) fy = H - 1;
    const y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      let fx = (x + 0.5) * sx - 0.5 + ox; if (fx < 0) fx = 0; else if (fx > W - 1) fx = W - 1;
      const x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), wx = fx - x0;
      const a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, e = (y1 * W + x1) * 4;
      const w00 = (1 - wx) * (1 - wy), w01 = wx * (1 - wy), w10 = (1 - wx) * wy, w11 = wx * wy, i = y * dw + x;
      out[i] = ((d[a + 2] * w00 + d[b + 2] * w01 + d[c + 2] * w10 + d[e + 2] * w11) / 255 - 0.485) / 0.229;
      out[plane + i] = ((d[a + 1] * w00 + d[b + 1] * w01 + d[c + 1] * w10 + d[e + 1] * w11) / 255 - 0.456) / 0.224;
      out[2 * plane + i] = ((d[a] * w00 + d[b] * w01 + d[c] * w10 + d[e] * w11) / 255 - 0.406) / 0.225;
    }
  }
  return out;
}

// ------------------------------------------------------------------ детектор: карта вероятности → рамки строк
// Как DBPostProcess в PaddleOCR: порог → связные области → наименьший по площади прямоугольник области →
// средняя вероятность внутри него → расширение (unclip). Прямоугольник — центр, направление стороны w, размеры.
function hull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
function minRect(h) {
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const p = h[i], q = h[(i + 1) % h.length]; let ex = q[0] - p[0], ey = q[1] - p[1]; const L = Math.hypot(ex, ey); if (L < 1e-6) continue;
    ex /= L; ey /= L;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const t of h) { const u = t[0] * ex + t[1] * ey, v = -t[0] * ey + t[1] * ex; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) { const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2; best = { area, cx: uc * ex - vc * ey, cy: uc * ey + vc * ex, ux: ex, uy: ey, w: u1 - u0, h: v1 - v0 }; }
  }
  return best;
}
function dbBoxes(p, W, H) {
  const n = W * H, seen = new Uint8Array(n), stack = new Int32Array(n), rowId = new Int32Array(H), mn = new Int32Array(H), mx = new Int32Array(H), out = [];
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (seen[s] || !(p[s] > CFG.thresh)) continue;
    id++; let sp = 0, y0 = H, y1 = -1; stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const j = stack[--sp], x = j % W, y = (j - x) / W;
      if (rowId[y] !== id) { rowId[y] = id; mn[y] = mx[y] = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } else { if (x < mn[y]) mn[y] = x; if (x > mx[y]) mx[y] = x; }
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W || (!dx && !dy)) continue;
          const k = yy * W + xx; if (!seen[k] && p[k] > CFG.thresh) { seen[k] = 1; stack[sp++] = k; }
        }
      }
    }
    if (y1 - y0 < 1) continue;
    const pts = [];
    for (let y = y0; y <= y1; y++) { pts.push([mn[y], y]); if (mx[y] !== mn[y]) pts.push([mx[y], y]); }
    if (pts.length < 3) continue;
    const r = minRect(hull(pts));
    if (!r || Math.min(r.w, r.h) < CFG.minSide) continue;
    // Средняя вероятность внутри прямоугольника.
    const hw = r.w / 2 + 0.5, hh = r.h / 2 + 0.5, ex = Math.abs(r.ux) * hw + Math.abs(r.uy) * hh, ey = Math.abs(r.uy) * hw + Math.abs(r.ux) * hh;
    const bx0 = Math.max(0, Math.floor(r.cx - ex)), bx1 = Math.min(W - 1, Math.ceil(r.cx + ex)), by0 = Math.max(0, Math.floor(r.cy - ey)), by1 = Math.min(H - 1, Math.ceil(r.cy + ey));
    let sum = 0, cnt = 0;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const dx = x - r.cx, dy = y - r.cy;
      if (Math.abs(dx * r.ux + dy * r.uy) <= hw && Math.abs(-dx * r.uy + dy * r.ux) <= hh) { sum += p[y * W + x]; cnt++; }
    }
    const score = cnt ? sum / cnt : 0;
    if (score < CFG.boxThresh) continue;
    const d = r.w * r.h * CFG.unclip / (2 * (r.w + r.h)), w = r.w + 2 * d, h = r.h + 2 * d;
    if (Math.min(w, h) < CFG.minSide + 2) continue;
    out.push({ cx: r.cx, cy: r.cy, ux: r.ux, uy: r.uy, w, h, score });
    if (out.length >= 1000) break;
  }
  return out;
}
// Длинная сторона — вдоль строки; направление чтения: слева направо, у вертикальной строки — сверху вниз
// (сторона «вверх ногами» выбирается позже — чтением).
function orient(b) {
  let { ux, uy, w, h } = b;
  const swap = () => { const t = w; w = h; h = t; const a = ux; ux = -uy; uy = a; };
  if (h > w * 1.5) swap();
  else if (w < h * 1.5 && Math.abs(uy) > Math.abs(ux)) swap();
  if (Math.abs(ux) >= Math.abs(uy) ? ux < 0 : uy < 0) { ux = -ux; uy = -uy; }
  return { cx: b.cx, cy: b.cy, ux, uy, w, h, score: b.score };
}
async function detect(img, rx, ry, rw, rh, scale) {
  const dw = r32(rw * scale), dh = r32(rh * scale), x = detTensor(img, rx, ry, rw, rh, dw, dh);
  const res = await detS.run({ [detS.inputNames[0]]: new ORT.Tensor('float32', x, [1, 3, dh, dw]) });
  const p = res[detS.outputNames[0]].data, kx = rw / dw, ky = rh / dh;
  return dbBoxes(p, dw, dh).map(b => {
    const ax = b.ux * kx, ay = b.uy * ky, la = Math.hypot(ax, ay) || 1, lb = Math.hypot(b.uy * kx, b.ux * ky) || 1;
    return orient({ cx: rx + (b.cx + 0.5) * kx - 0.5, cy: ry + (b.cy + 0.5) * ky - 0.5, ux: ax / la, uy: ay / la, w: b.w * la, h: b.h * lb, score: b.score });
  });
}

// ------------------------------------------------------------------ распознаватель
// Строка вырезается из исходного снимка вдоль своего прямоугольника: высота 48, ширина — по пропорции.
function lineTensor(img, b, flip) {
  let ux = b.ux, uy = b.uy; if (flip) { ux = -ux; uy = -uy; }
  const vx = -uy, vy = ux, H = CFG.recH, ow = Math.min(CFG.recMaxW, Math.max(8, Math.ceil(H * b.w / b.h))), W = Math.max(CFG.recW, ow);
  const t = new Float32Array(3 * H * W), plane = H * W, d = img.d, iw = img.w, ih = img.h;
  const f = b.h / H, n = f <= 1.25 ? 1 : Math.min(4, Math.ceil(f)), nn = n * n;
  for (let j = 0; j < H; j++) for (let i = 0; i < ow; i++) {
    let r = 0, g = 0, bl = 0;
    for (let c = 0; c < n; c++) for (let a = 0; a < n; a++) {
      const du = ((i + (a + 0.5) / n) / ow - 0.5) * b.w, dv = ((j + (c + 0.5) / n) / H - 0.5) * b.h;
      let fx = b.cx + ux * du + vx * dv, fy = b.cy + uy * du + vy * dv;
      if (fx < 0) fx = 0; else if (fx > iw - 1) fx = iw - 1; if (fy < 0) fy = 0; else if (fy > ih - 1) fy = ih - 1;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(iw - 1, x0 + 1), y1 = Math.min(ih - 1, y0 + 1), wx = fx - x0, wy = fy - y0;
      const p = (y0 * iw + x0) * 4, q = (y0 * iw + x1) * 4, s = (y1 * iw + x0) * 4, e = (y1 * iw + x1) * 4;
      const w00 = (1 - wx) * (1 - wy), w01 = wx * (1 - wy), w10 = (1 - wx) * wy, w11 = wx * wy;
      r += d[p] * w00 + d[q] * w01 + d[s] * w10 + d[e] * w11;
      g += d[p + 1] * w00 + d[q + 1] * w01 + d[s + 1] * w10 + d[e + 1] * w11;
      bl += d[p + 2] * w00 + d[q + 2] * w01 + d[s + 2] * w10 + d[e + 2] * w11;
    }
    const k = j * W + i;
    t[k] = bl / nn / 127.5 - 1; t[plane + k] = g / nn / 127.5 - 1; t[2 * plane + k] = r / nn / 127.5 - 1;
  }
  return { t, W };
}
async function readLine(img, b, flip) {
  const { t, W } = lineTensor(img, b, flip);
  const res = await recS.run({ [recS.inputNames[0]]: new ORT.Tensor('float32', t, [1, 3, CFG.recH, W]) });
  const o = res[recS.outputNames[0]], T = o.dims[1], C = o.dims[2], p = o.data;
  if (C !== chars.length) throw new Error('Словарь не подходит к модели распознавания');
  let text = '', sum = 0, cnt = 0, last = 0;
  for (let i = 0; i < T; i++) {
    let k = 0, m = p[i * C];
    for (let c = 1; c < C; c++) { const v = p[i * C + c]; if (v > m) { m = v; k = c; } }
    if (k && k !== last) { text += chars[k]; sum += m; cnt++; }
    last = k;
  }
  return { text: text.trim(), conf: cnt ? sum / cnt : 0 };
}
// Вес чтения при выборе стороны: уверенность важнее длины — перевёрнутая строка читается «уверенным мусором» редко.
const weight = r => r.conf * r.conf * Math.min(16, r.text.replace(/\s/g, '').length);

async function readAll(img, lines, id, progress) {
  // Горизонтальные и вертикальные строки — отдельно: у каждой группы своя сторона «вверх ногами».
  const groups = [[], []];
  for (const b of lines) groups[Math.abs(b.ux) >= Math.abs(b.uy) ? 0 : 1].push(b);
  let done = 0;
  const step = async () => { done++; progress(done / Math.max(1, lines.length)); if (done % 6 === 0) { await tick(); if (cancelled >= id) throw new Error('Распознавание остановлено.'); } };
  for (const g of groups) {
    if (!g.length) continue;
    // Сторона — по трём самым длинным строкам: читаются как есть и перевёрнутыми.
    const long = g.filter(b => b.w >= b.h * 2), probe = (long.length ? long : g).slice().sort((p, q) => q.w * q.h - p.w * p.h).slice(0, 3);
    let sn = 0, sf = 0;
    for (const b of probe) { b.n = await readLine(img, b, false); b.f = await readLine(img, b, true); sn += weight(b.n); sf += weight(b.f); }
    const flip = sf > sn * 1.15;
    for (const b of g) {
      const r = (flip ? b.f : b.n) || await readLine(img, b, flip);
      b.text = r.text; b.conf = r.conf; b.flip = flip; delete b.n; delete b.f;
      await step();
    }
  }
}

// Бирка (до трёх строк с тегом): строка с тегом читается ещё трижды — с чуть другой рамкой (ниже, выше, уже).
// Мелкая гравировка даёт в одном чтении то «400B», то «4008»; ошибки разных вырезок не совпадают, поэтому тег
// выбирается голосованием (вес — уверенность чтения), при равенстве остаётся первое чтение.
// Список из многих тегов (распечатка, экран) так не перечитывается: текст там чистый, а время выросло бы втрое.
const TAG_LIKE = /\d{2,5}[-–—][A-ZА-ЯЁ]{1,6}[-–—]\d{1,5}[A-ZА-ЯЁ]{0,2}\d?/g;
const LOOK = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'Ё': 'E' };
const latin = t => t.toUpperCase().replace(/[АВЕКМНОРСТХУЁ]/g, c => LOOK[c]).replace(/[–—]/g, '-');
const tagTokens = text => { const up = text.toUpperCase(), out = []; let m; TAG_LIKE.lastIndex = 0; while ((m = TAG_LIKE.exec(up))) out.push({ at: m.index, len: m[0].length, key: latin(m[0]) }); return out; };
async function voteTags(img, lines, id) {
  const tagged = lines.filter(b => b.text && b.conf >= CFG.drop && tagTokens(b.text).length);
  if (!tagged.length || tagged.length > 3) return;
  for (const b of tagged) {
    const main = tagTokens(b.text), reads = [{ tokens: main, conf: b.conf }];
    for (const v of [{ h: b.h * 0.85 }, { h: b.h * 1.1 }, { w: b.w * 0.95 }]) {
      const r = await readLine(img, { ...b, ...v }, b.flip), tk = tagTokens(r.text);
      if (tk.length === main.length) reads.push({ tokens: tk, conf: r.conf });
    }
    await tick(); if (cancelled >= id) throw new Error('Распознавание остановлено.');
    if (reads.length < 3) continue;
    let text = b.text;
    for (let i = main.length - 1; i >= 0; i--) {
      const votes = new Map(); for (const r of reads) votes.set(r.tokens[i].key, (votes.get(r.tokens[i].key) || 0) + r.conf);
      let best = main[i].key, bw = votes.get(best);
      for (const [k, wgt] of votes) if (wgt > bw * 1.001) { best = k; bw = wgt; }
      if (best !== main[i].key) { text = text.slice(0, main[i].at) + best + text.slice(main[i].at + main[i].len); b.voted = true; }
    }
    b.text = text;
  }
}

// Строки → текст: в системе координат текста (по общему направлению чтения) собираются ряды, в ряду — слева направо.
function assemble(lines) {
  const ok = lines.filter(b => b.text && b.conf >= CFG.drop);
  if (!ok.length) return { text: '', angle: 0, conf: 0 };
  let sx = 0, sy = 0;
  for (const b of ok) { const s = (b.flip ? -1 : 1) * b.w; sx += b.ux * s; sy += b.uy * s; }
  const L = Math.hypot(sx, sy) || 1, ex = sx / L, ey = sy / L;
  for (const b of ok) { b.tu = b.cx * ex + b.cy * ey; b.tv = -b.cx * ey + b.cy * ex; }
  ok.sort((a, b) => a.tv - b.tv);
  const rows = [];
  for (const b of ok) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(b.tv - row.tv) <= Math.min(b.h, row.h) * 0.5) { row.items.push(b); row.tv = (row.tv * (row.items.length - 1) + b.tv) / row.items.length; row.h = (row.h * (row.items.length - 1) + b.h) / row.items.length; }
    else rows.push({ tv: b.tv, h: b.h, items: [b] });
  }
  const text = rows.map(row => {
    row.items.sort((a, b) => a.tu - b.tu);
    let s = '', right = null;
    for (const b of row.items) { if (right !== null) s += (b.tu - b.w / 2 - right > row.h * 1.2) ? '  ' : ' '; s += b.text; right = b.tu + b.w / 2; }
    return s;
  }).join('\n');
  let cs = 0, cw = 0; for (const b of ok) { const n = b.text.length; cs += b.conf * n; cw += n; }
  return { text, angle: Math.round(Math.atan2(ey, ex) * 180 / Math.PI), conf: Math.round(100 * cs / Math.max(1, cw)) };
}

async function recognize({ rgba, w, h, side }, id) {
  const img = { d: new Uint8ClampedArray(rgba), w, h }, t0 = Date.now(), big = Math.max(w, h), SIDE = side > 0 ? side : CFG.side;
  const progress = v => post({ type: 'progress', id, value: Math.max(0, Math.min(1, v)) });
  // Первый проход: весь снимок, большая сторона — до 1280 px (маленький участок увеличивается).
  const s1 = big > SIDE ? SIDE / big : (big < 640 ? Math.min(3, 640 / big) : 1);
  let lines = await detect(img, 0, 0, w, h, s1), passes = 1;
  progress(0.3); await tick();
  if (cancelled >= id) throw new Error('Распознавание остановлено.');
  // Второй проход — высокий снимок с мелким текстом (длинный перечень, скриншот): полосами во всю ширину,
  // в масштабе, где ширина укладывается в 1280 px. Строка из перекрытия полос берётся один раз — по центру.
  let s2 = Math.min(1, SIDE / w);
  if (s2 >= s1 * 1.25) {
    const hs = lines.map(b => b.h * s1).sort((a, b) => a - b), med = hs.length ? hs[hs.length >> 1] : 0;
    if (!lines.length || med < CFG.smallText) {
      const ov = 120 / s2; let tileH = SIDE / s2, n = Math.max(1, Math.ceil((h - ov) / (tileH - ov)));
      if (n > CFG.maxTiles) { n = CFG.maxTiles; tileH = (h + (n - 1) * ov) / n; s2 = SIDE / tileH; }
      const all = [];
      for (let i = 0; i < n; i++) {
        const y0 = Math.round(i * (tileH - ov)), hh = Math.min(Math.round(tileH), h - y0), top = i ? y0 + ov / 2 : 0, bottom = i === n - 1 ? h : y0 + hh - ov / 2;
        for (const b of await detect(img, 0, y0, w, hh, s2)) if (b.cy >= top && b.cy < bottom) all.push(b);
        progress(0.3 + 0.2 * (i + 1) / n); await tick();
        if (cancelled >= id) throw new Error('Распознавание остановлено.');
      }
      if (all.length >= lines.length) { lines = all; passes = 2; }
    }
  }
  const base = passes === 2 ? 0.5 : 0.3;
  await readAll(img, lines, id, v => progress(base + (1 - base) * v * 0.92));
  await voteTags(img, lines, id);
  progress(1);
  const out = assemble(lines);
  return { ...out, ms: Date.now() - t0, boxes: lines.length, passes, lines: lines.map(b => ({ text: b.text, conf: +b.conf.toFixed(3), cx: Math.round(b.cx), cy: Math.round(b.cy), w: Math.round(b.w), h: Math.round(b.h), a: Math.round(Math.atan2(b.uy, b.ux) * 180 / Math.PI), flip: !!b.flip })) };
}

// Задания выполняются строго по очереди: после «Стоп» новое чтение может прийти раньше, чем остановится прежнее,
// а модель считает только один снимок за раз. «Стоп» (cancel) очереди не ждёт.
let queue = Promise.resolve();
self.onmessage = (e) => {
  const { id, type, payload } = e.data || {};
  if (type === 'cancel') { cancelled = Math.max(cancelled, id | 0); return; }
  queue = queue.then(async () => {
    try {
      let result;
      if (type === 'init') result = await init(payload);
      else if (type === 'recognize') result = await recognize(payload, id);
      else throw new Error('Неизвестная команда');
      post({ id, ok: true, result });
    } catch (err) {
      post({ id, ok: false, error: String((err && err.message) || err) });
    }
  });
};
