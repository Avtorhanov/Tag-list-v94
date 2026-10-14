// Tag list — локальное распознавание фото (фоновый поток).
// Движок Tesseract 5 (WebAssembly, LSTM) и модели rus+eng передаёт основной поток:
// поток сам ничего не скачивает, поэтому одинаково работает на GitHub Pages,
// в установленном PWA без сети и в APK (там файлы отдаёт приложение, а не сеть).
let T = null;
let apiText = null; // rus+eng: теги и задания
let apiTag = null;  // eng + белый список: только теги

function post(msg) { self.postMessage(msg); }

async function init({ coreUrl, models }) {
  importScripts(coreUrl);
  T = await self.TesseractCore({
    TesseractProgress(percent) {
      post({ type: 'progress', value: Math.max(0, Math.min(1, (percent - 30) / 70)) });
    }
  });
  for (const { code, data } of models) T.FS.writeFile(`${code}.traineddata`, new Uint8Array(data));
  apiText = new T.TessBaseAPI();
  if (apiText.Init(null, 'rus+eng', 1 /* только LSTM */) === -1) throw new Error('Модель rus+eng не загрузилась');
  apiTag = new T.TessBaseAPI();
  if (apiTag.Init(null, 'eng', 1) === -1) throw new Error('Модель eng не загрузилась');
  apiTag.SetVariable('tessedit_char_whitelist', '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-');
  return { ok: true };
}

function findAngle(api) {
  // Наклон строк определяется только при автоматической разметке страницы.
  api.SetVariable('tessedit_pageseg_mode', '3');
  if (api.SetImageFile(1, 0) === 1) throw new Error('Не удалось прочитать изображение');
  api.FindLines();
  const g = api.GetGradient ? api.GetGradient() : api.GetAngle();
  return Math.abs(g) >= 0.005 ? g : 0;
}

function pass(api, psm, angle) {
  api.SetVariable('tessedit_pageseg_mode', String(psm));
  if (api.SetImageFile(1, angle) === 1) throw new Error('Не удалось прочитать изображение');
  api.Recognize(null);
  const out = { text: api.GetUTF8Text(), tsv: api.GetTSVText(0), conf: api.MeanTextConf() };
  api.Clear();
  return out;
}

function recognize({ image, tagPass }) {
  T.FS.writeFile('/input', new Uint8Array(image));
  // Как на стенде: разрешение и пробелы задаются до поиска наклона — от них зависит разметка строк.
  for (const api of [apiText, apiTag]) {
    api.SetVariable('user_defined_dpi', '300');
    api.SetVariable('preserve_interword_spaces', '1');
  }
  const angle = findAngle(apiText);
  const main = pass(apiText, 3, angle);
  const tags = tagPass ? pass(apiTag, 11, angle) : null;
  return { ...main, tags, angleDeg: angle * 180 / Math.PI };
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data || {};
  try {
    let result;
    if (type === 'init') result = await init(payload);
    else if (type === 'recognize') result = recognize(payload);
    else throw new Error('Неизвестная команда');
    post({ id, ok: true, result });
  } catch (err) {
    post({ id, ok: false, error: String((err && err.message) || err) });
  }
};
