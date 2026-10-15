// Tag list — локальное распознавание фото без интернета (v101).
// Tesseract 5 (WebAssembly) в фоновом потоке, модели rus+eng лежат в js/ocr-local/.
// Что делается поверх движка, чтобы перечни КИП читались как таблица:
//  • масштаб под размер букв: узкий скриншот или выделенный столбец увеличивается, огромное фото уменьшается;
//  • длинный список режется на полосы с перекрытием (предел холста iPhone ~16 Мп), слова из перекрытия — один раз;
//  • строки собираются по координатам слов — иначе Tesseract читает столбцами и задания отрываются от тегов;
//  • второй проход только по тегам (латиница, цифры, «-») подставляет тег в ту же строку, где первый его не прочитал.
(function(){
  const BASE=new URL('./js/ocr-local/',document.baseURI).href;
  // v107: сообщения — через TX (js/i18n.js), без него — по-русски.
  const TX=(s,...a)=>typeof window.TX==='function'?window.TX(s,...a):String(s).replace(/\{(\d+)\}/g,(m,i)=>a[i]!==undefined?String(a[i]):m);
  const FILES={simd:'tesseract-core-simd-lstm.wasm.js',plain:'tesseract-core-lstm.wasm.js',worker:'worker.js',rus:'rus.traineddata',eng:'eng.traineddata'};
  let worker=null,ready=null,reqId=0;const pending=new Map();let onProgress=null;

  function simdSupported(){try{return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));}catch(_){return false;}}
  async function fetchOk(name,type){
    const r=await fetch(BASE+name);
    if(!r.ok)throw new Error(TX('Не найден файл распознавания {0} (HTTP {1})',name,r.status));
    return type==='text'?r.text():r.arrayBuffer();
  }
  function call(type,payload,transfer){
    return new Promise((resolve,reject)=>{const id=++reqId;pending.set(id,{resolve,reject});worker.postMessage({id,type,payload},transfer||[]);});
  }
  // Поток и движок создаются из blob: поток не делает собственных запросов —
  // в APK запросы фоновых потоков не всегда проходят через «локальный сервер» приложения.
  function ensure(stage){
    if(ready)return ready;
    ready=(async()=>{
      if(typeof WebAssembly!=='object')throw new Error(TX('Браузер не поддерживает WebAssembly'));
      stage&&stage(TX('Запускаю распознавание…'));
      const simd=simdSupported();
      const [workerSrc,coreSrc,rus,eng]=await Promise.all([fetchOk(FILES.worker,'text'),fetchOk(simd?FILES.simd:FILES.plain,'text'),fetchOk(FILES.rus),fetchOk(FILES.eng)]);
      const workerUrl=URL.createObjectURL(new Blob([workerSrc],{type:'text/javascript'}));
      const coreUrl=URL.createObjectURL(new Blob([coreSrc],{type:'text/javascript'}));
      worker=new Worker(workerUrl);
      worker.onmessage=e=>{const m=e.data||{};
        if(m.type==='progress'){onProgress&&onProgress(m.value);return;}
        const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.ok?p.resolve(m.result):p.reject(new Error(TX(m.error)));};
      worker.onerror=e=>{const err=new Error(e.message||TX('Ошибка распознавания'));for(const p of pending.values())p.reject(err);pending.clear();};
      await call('init',{coreUrl,models:[{code:'rus',data:rus},{code:'eng',data:eng}]},[rus,eng]);
      return true;
    })();
    ready.catch(()=>{ready=null;try{worker&&worker.terminate();}catch(_){}worker=null;});
    return ready;
  }

  function chooseScale(w){return w<1800?Math.min(3.5,1800/w):(w>3200?3200/w:1);}
  // Серый + растяжение контраста: убирает цветной фон и тень, не теряя тонкие штрихи.
  function prepare(source,sx,sy,sw,sh,scale){
    const w=Math.max(1,Math.round(sw*scale)),h=Math.max(1,Math.round(sh*scale));
    const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{willReadFrequently:true});
    g.imageSmoothingQuality='high';g.drawImage(source,sx,sy,sw,sh,0,0,w,h);
    const img=g.getImageData(0,0,w,h),d=img.data,n=w*h,gray=new Uint8ClampedArray(n),hist=new Uint32Array(256);
    for(let i=0,j=0;j<n;i+=4,j++){const v=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000|0;gray[j]=v;hist[v]++;}
    let lo=0,hi=255,acc=0;for(let v=0;v<256;v++){acc+=hist[v];if(acc>n*.01){lo=v;break;}}
    acc=0;for(let v=255;v>=0;v--){acc+=hist[v];if(acc>n*.01){hi=v;break;}}
    const span=Math.max(1,hi-lo);
    for(let i=0,j=0;j<n;i+=4,j++){const v=Math.max(0,Math.min(255,(gray[j]-lo)*255/span));d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;}
    g.putImageData(img,0,0);return c;
  }
  function planStrips(H,scale){
    const stripH=Math.round(1700/scale),ov=Math.round(220/scale);
    if(H*scale<=2300)return [{y0:0,h:H,ownTop:0,ownBottom:H}];
    const strips=[];let y=0;
    for(;;){const h=Math.min(stripH,H-y);strips.push({y0:y,h});if(y+h>=H)break;y+=stripH-ov;}
    strips.forEach((st,i)=>{st.ownTop=i===0?0:st.y0+ov/2;st.ownBottom=i===strips.length-1?H:st.y0+st.h-ov/2;});
    return strips;
  }
  function wordsFromTsv(tsv,strip,scale){
    const out=[];
    for(const line of String(tsv||'').split('\n')){
      const c=line.split('\t');if(c.length<12||c[0]!=='5')continue;
      const text=c.slice(11).join('\t').trim();if(!text)continue;
      const top=strip.y0+(+c[7])/scale,height=(+c[9])/scale,cy=top+height/2;
      if(cy<strip.ownTop||cy>=strip.ownBottom)continue;
      out.push({text,left:(+c[6])/scale,width:(+c[8])/scale,height,cy});
    }
    return out;
  }
  function rowsFromWords(input){
    const words=input.slice();if(!words.length)return {rows:[],medH:10};
    const hs=words.map(w=>w.height).sort((a,b)=>a-b),medH=hs[hs.length>>1]||10;
    words.sort((a,b)=>a.cy-b.cy);
    const rows=[];
    for(const w of words){
      const row=rows[rows.length-1];
      if(row&&Math.abs(w.cy-row.cy)<=medH*.55){row.words.push(w);row.cy=(row.cy*(row.words.length-1)+w.cy)/row.words.length;}
      else rows.push({cy:w.cy,words:[w]});
    }
    return {medH,rows:rows.map(r=>{
      r.words.sort((a,b)=>a.left-b.left);
      let out='',prevRight=null;
      for(const w of r.words){if(prevRight!==null)out+=(w.left-prevRight>medH*1.6)?'  ':' ';out+=w.text;prevRight=w.left+w.width;}
      return {cy:r.cy,text:out};
    })};
  }
  const rowTags=text=>extractTagRecordsFromText(text).map(r=>r.tag);
  // Сопоставление по положению строки, а не по похожести: соседние теги часто отличаются одной цифрой.
  function mergeByRows(a,b){
    const tol=Math.max(a.medH,b.medH)*.6,rows=a.rows.map(r=>({...r})),used=new Set();
    for(const br of b.rows){
      const tags=rowTags(br.text);if(!tags.length)continue;
      let best=-1,bd=1e9;rows.forEach((r,i)=>{const d=Math.abs(r.cy-br.cy);if(d<bd){bd=d;best=i;}});
      if(best>=0&&bd<=tol){
        if(used.has(best))continue;used.add(best);const r=rows[best];
        // Первый проход тег не прочитал: убираем его искажённую копию («2631-111-304», «PT-1O1») и номер строки, чтобы они не попали в задание.
        if(!rowTags(r.text).length)r.text=tags.join(' ')+' '+r.text.replace(/(^|\s)[|\[(]?(?:\d{1,5}[-–—]|[A-Z]{2,6}[-–—]?\d)\S*/g,' ').replace(/^\s*[|\[(]?\d{1,4}[|\])]?\s+/,'');
      }
      else rows.push({cy:br.cy,text:tags.join(' ')});
    }
    rows.sort((x,y)=>x.cy-y.cy);
    return rows.map(r=>r.text).join('\n');
  }

  // source — ImageBitmap или canvas; region — {x,y,w,h} в пикселях source.
  async function recognize(source,region,{stage,progress}={}){
    await ensure(stage);
    const scale=chooseScale(region.w),strips=planStrips(region.h,scale);
    const wordsA=[],wordsB=[];let conf=0,confW=0;const t0=performance.now();
    for(let k=0;k<strips.length;k++){
      const st=strips[k];
      stage&&stage(strips.length>1?TX('Распознаю на телефоне: часть {0} из {1}…',k+1,strips.length):TX('Распознаю на телефоне…'));
      onProgress=v=>progress&&progress((k+v)/strips.length);
      const canvas=prepare(source,region.x,region.y+st.y0,region.w,st.h,scale);
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
      const buf=await blob.arrayBuffer();
      const r=await call('recognize',{image:buf,tagPass:true},[buf]);
      wordsA.push(...wordsFromTsv(r.tsv,st,scale));
      if(r.tags)wordsB.push(...wordsFromTsv(r.tags.tsv,st,scale));
      conf+=r.conf*st.h;confW+=st.h;
    }
    onProgress=null;
    const text=mergeByRows(rowsFromWords(wordsA),rowsFromWords(wordsB));
    return {text,ms:performance.now()-t0,conf:Math.round(conf/Math.max(1,confW)),parts:strips.length};
  }
  window.LocalOCR={recognize,warmUp:()=>ensure()};
})();
