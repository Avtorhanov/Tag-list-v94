// Tag list — распознавание фото нейросетью PP-OCRv5 без интернета (v128).
// Второй локальный движок рядом с Tesseract (js/ocr-local.js); выбирается переключателем «Tesseract / OCRv5»
// в окне фото. Детектор находит каждую строку текста на снимке, распознаватель читает её выровненной —
// бирка под углом, вверх ногами, в перспективе и гравировка на стали читаются без подбора наклона.
// Файлы (всё лежит в приложении, сеть не нужна):
//   js/vendor/ort.wasm.min.js, ort-wasm-simd.wasm — ONNX Runtime Web 1.18.0 (MIT);
//   js/ocr-pp/PP-OCRv5_mobile_det.onnx, eslav_PP-OCRv5_mobile_rec.onnx, ppocrv5_eslav_dict.txt — модели PaddleOCR (Apache-2.0);
//   js/ocr-pp/worker.js — фоновый поток: детектор, вырезка строк, распознаватель, сборка текста.
// Поток создаётся из blob и сам ничего не скачивает (как у Tesseract) — так он работает и в APK.
(function(){
  const BASE=new URL('./js/ocr-pp/',document.baseURI).href,VENDOR=new URL('./js/vendor/',document.baseURI).href;
  const TX=(s,...a)=>typeof window.TX==='function'?window.TX(s,...a):String(s).replace(/\{(\d+)\}/g,(m,i)=>a[i]!==undefined?String(a[i]):m);
  const FILES={worker:BASE+'worker.js',ort:VENDOR+'ort.wasm.min.js',wasm:VENDOR+'ort-wasm-simd.wasm',det:BASE+'PP-OCRv5_mobile_det.onnx',rec:BASE+'eslav_PP-OCRv5_mobile_rec.onnx',dict:BASE+'ppocrv5_eslav_dict.txt'};
  const MAX_PIXELS=8.5e6;      // больше — снимок уменьшается (память телефона)
  const IDLE_MS=90000;         // поток с моделями (~200 МБ памяти) закрывается, если им не пользуются
  let worker=null,ready=null,reqId=0,idleTimer=0;const pending=new Map();

  // Нужен WebAssembly SIMD: iPhone с iOS 16.4, Android с WebView 91 и новее.
  function supported(){
    try{return typeof WebAssembly==='object'&&typeof Worker==='function'&&WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));}catch(_){return false;}
  }
  async function fetchOk(url,type){
    const r=await fetch(url);
    if(!r.ok)throw new Error(TX('Не найден файл распознавания {0} (HTTP {1})',url.split('/').pop(),r.status));
    return type==='text'?r.text():r.arrayBuffer();
  }
  function call(type,payload,transfer,onProgress){
    return new Promise((resolve,reject)=>{const id=++reqId;pending.set(id,{resolve,reject,onProgress});worker.postMessage({id,type,payload},transfer||[]);});
  }
  function dispose(){
    clearTimeout(idleTimer);idleTimer=0;
    const err=new Error(TX('Распознавание остановлено.'));for(const p of pending.values())p.reject(err);pending.clear();
    try{worker&&worker.terminate();}catch(_){}
    worker=null;ready=null;
  }
  function touch(){clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(!pending.size)dispose();else touch();},IDLE_MS);}
  function ensure(stage){
    touch();
    if(ready)return ready;
    const mine=ready=(async()=>{
      if(!supported())throw new Error(TX('OCRv5 не поддерживается на этом устройстве'));
      stage&&stage(TX('Запускаю OCRv5…'));
      const [workerSrc,ortSrc,wasm,det,rec,dict]=await Promise.all([fetchOk(FILES.worker,'text'),fetchOk(FILES.ort,'text'),fetchOk(FILES.wasm),fetchOk(FILES.det),fetchOk(FILES.rec),fetchOk(FILES.dict,'text')]);
      const workerUrl=URL.createObjectURL(new Blob([workerSrc],{type:'text/javascript'}));
      const ortUrl=URL.createObjectURL(new Blob([ortSrc],{type:'text/javascript'}));
      worker=new Worker(workerUrl);
      worker.onmessage=e=>{const m=e.data||{};const p=pending.get(m.id);if(!p)return;
        if(m.type==='progress'){p.onProgress&&p.onProgress(m.value);return;}
        pending.delete(m.id);m.ok?p.resolve(m.result):p.reject(new Error(TX(m.error)));};
      worker.onerror=e=>{const err=new Error(e.message||TX('Ошибка распознавания'));for(const p of pending.values())p.reject(err);pending.clear();};
      try{await call('init',{ortUrl,wasm,det,rec,dict},[wasm,det,rec]);}
      finally{URL.revokeObjectURL(workerUrl);URL.revokeObjectURL(ortUrl);}
      return true;
    })();
    mine.catch(()=>{if(ready===mine){ready=null;try{worker&&worker.terminate();}catch(_){}worker=null;}});
    return mine;
  }

  // Большая сторона снимка для детектора. 1280 px — мелкий текст бирки в общем кадре ещё находится, память потока
  // ~230 МБ; 960 px — ~150 МБ. Телефон с малой памятью (или тот, где 1280 однажды не хватило памяти) работает на 960.
  const SIDE_KEY='kipPpSide';
  function prefSide(){
    try{if(localStorage.getItem(SIDE_KEY)==='960')return 960;}catch(_){}
    return navigator.deviceMemory&&navigator.deviceMemory<=2?960:1280;
  }
  // source — ImageBitmap или canvas; region — {x,y,w,h} в пикселях source.
  // Ответ: {text, conf (0–100), angle (направление чтения, °; 180 — вверх ногами), ms, boxes, passes, lines:[…]}.
  async function recognize(source,region,{stage,progress,abort,side}={}){
    const t0=performance.now();
    const s=Math.min(1,Math.sqrt(MAX_PIXELS/Math.max(1,region.w*region.h)));
    const w=Math.max(1,Math.round(region.w*s)),h=Math.max(1,Math.round(region.h*s));
    const run=async sd=>{
      await ensure(stage);
      stage&&stage(TX('Распознаю на телефоне (OCRv5)…'));
      const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{willReadFrequently:true});
      g.imageSmoothingQuality='high';g.drawImage(source,region.x,region.y,region.w,region.h,0,0,w,h);
      const buf=g.getImageData(0,0,w,h).data.buffer;c.width=c.height=0;
      const job=call('recognize',{rgba:buf,w,h,side:sd},[buf],v=>progress&&progress(v));
      const id=reqId,watch=abort?setInterval(()=>{if(abort()&&worker)worker.postMessage({id,type:'cancel'});},150):0;
      try{return await job;}finally{clearInterval(watch);touch();}
    };
    const first=side||prefSide();let res;
    try{res=await run(first);}
    catch(e){
      // Не хватило памяти (или движок упал) на большом снимке — один повтор с детектором поменьше, в новом потоке.
      if((abort&&abort())||first<=960)throw e;
      console.warn('Tag list: OCRv5, повтор на 960 px',e);
      dispose();res=await run(960);
      try{localStorage.setItem(SIDE_KEY,'960');}catch(_){}
    }
    return {...res,ms:performance.now()-t0,scale:s};
  }
  window.PPOCR={recognize,warmUp:()=>ensure(),supported,dispose};
})();
