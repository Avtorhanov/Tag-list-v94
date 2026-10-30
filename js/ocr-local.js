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
  // Выровненный участок (бирка): крупный шрифт хуже читается, чем средний — около 1200 px по ширине.
  function chooseScaleBlock(w){return w<1000?Math.min(3.5,1200/w):(w>2000?2000/w:1);}
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
  async function recognize(source,region,{stage,progress,block}={}){
    await ensure(stage);
    const scale=block?chooseScaleBlock(region.w):chooseScale(region.w),strips=planStrips(region.h,scale);
    const wordsA=[],wordsB=[];let conf=0,confW=0;const t0=performance.now();
    for(let k=0;k<strips.length;k++){
      const st=strips[k];
      stage&&stage(strips.length>1?TX('Распознаю на телефоне: часть {0} из {1}…',k+1,strips.length):TX('Распознаю на телефоне…'));
      onProgress=v=>progress&&progress((k+v)/strips.length);
      const canvas=prepare(source,region.x,region.y+st.y0,region.w,st.h,scale);
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
      const buf=await blob.arrayBuffer();
      const r=await call('recognize',{image:buf,tagPass:true,block:!!block},[buf]);
      wordsA.push(...wordsFromTsv(r.tsv,st,scale));
      if(r.tags)wordsB.push(...wordsFromTsv(r.tags.tsv,st,scale));
      conf+=r.conf*st.h;confW+=st.h;
    }
    onProgress=null;
    const text=mergeByRows(rowsFromWords(wordsA),rowsFromWords(wordsB));
    return {text,ms:performance.now()-t0,conf:Math.round(conf/Math.max(1,confW)),parts:strips.length};
  }

  // ---------------------------------------------------------------- v119: выравнивание участка
  // Движок читает строки только при наклоне примерно до ±5–10°, а повёрнутый на 90°/180° текст не читает совсем.
  // levelCanvas — участок, повёрнутый на deg градусов по часовой: сначала на целое число четвертей (без потерь),
  // затем на остаток с расширением холста (углы не обрезаются) и фоном цвета рамки участка.
  function borderMedian(g,w,h){
    const d=g.getImageData(0,0,w,h).data,v=[];
    for(let x=0;x<w;x+=4)for(const y of [0,h-1]){const i=(y*w+x)*4;v.push((d[i]+d[i+1]+d[i+2])/3);}
    for(let y=0;y<h;y+=4)for(const x of [0,w-1]){const i=(y*w+x)*4;v.push((d[i]+d[i+1]+d[i+2])/3);}
    v.sort((a,b)=>a-b);return Math.round(v[v.length>>1]||128);
  }
  function levelCanvas(source,region,deg){
    const qn=Math.round(deg/90),q=((qn%4)+4)%4,fine=deg-qn*90,sw=region.w,sh=region.h;
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(q%2?sh:sw));c.height=Math.max(1,Math.round(q%2?sw:sh));
    const g=c.getContext('2d',{willReadFrequently:true});
    g.translate(c.width/2,c.height/2);g.rotate(q*Math.PI/2);g.drawImage(source,region.x,region.y,sw,sh,-sw/2,-sh/2,sw,sh);
    if(Math.abs(fine)<0.05)return c;
    const rad=fine*Math.PI/180,W=c.width,H=c.height,m=borderMedian(g,W,H);
    const o=document.createElement('canvas');
    o.width=Math.round(Math.abs(W*Math.cos(rad))+Math.abs(H*Math.sin(rad)));o.height=Math.round(Math.abs(W*Math.sin(rad))+Math.abs(H*Math.cos(rad)));
    const go=o.getContext('2d');go.fillStyle=`rgb(${m},${m},${m})`;go.fillRect(0,0,o.width,o.height);
    go.translate(o.width/2,o.height/2);go.rotate(rad);go.drawImage(c,-W/2,-H/2);
    c.width=c.height=0;return o;
  }
  // Наклон строк по тёмным мелким пятнам (буквы, модули QR) внутри круга: поиск угла −40…+40°, на котором
  // горизонтальная гистограмма пятен самая «рваная». Рамка бирки и фон в круг не попадают.
  function estimateSkew(source,region){
    const W=600,s=W/region.w,w=W,h=Math.max(1,Math.round(region.h*s));
    const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{willReadFrequently:true});
    g.drawImage(source,region.x,region.y,region.w,region.h,0,0,w,h);
    const d=g.getImageData(0,0,w,h).data,gray=new Float32Array(w*h);
    for(let i=0,j=0;j<w*h;i+=4,j++)gray[j]=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000;
    const I=new Float64Array((w+1)*(h+1));
    for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=gray[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+row;}}
    const r=15,R=Math.min(w,h)/2,pts=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      if(Math.hypot(x-w/2,y-h/2)>=R)continue;
      const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1),y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);
      const mean=(I[y1*(w+1)+x1]-I[y0*(w+1)+x1]-I[y1*(w+1)+x0]+I[y0*(w+1)+x0])/((x1-x0)*(y1-y0));
      if(gray[y*w+x]<mean*0.82&&mean>40)pts.push(x-w/2,y-h/2);
    }
    const n=pts.length/2;if(n<50)return 0;
    const bins=Math.ceil(Math.hypot(w,h))+2,off=bins/2;let best=0,bs=-1;
    for(let a=-40;a<=40;a++){
      const rad=a*Math.PI/180,sn=Math.sin(rad),cs=Math.cos(rad),hist=new Float32Array(bins);
      for(let k=0;k<n;k++)hist[(pts[2*k]*sn+pts[2*k+1]*cs+off)|0]++;
      let sc=0;for(let k=0;k<bins;k++)sc+=hist[k]*hist[k];
      if(sc>bs){bs=sc;best=a;}
    }
    return best;
  }
  // Оценка чтения: теги с номером установки (2104-PG-447B1) весят больше, чем обрывки без неё.
  function scoreRead(res){
    const tags=extractTagRecordsFromText(res.text).map(r=>r.tag);
    const strictTags=tags.filter(t=>/^\d{2,5}-[A-Z]{1,5}-\d{1,5}[A-Z0-9]{0,2}$/.test(t));
    return {tags,strict:strictTags,score:strictTags.length*100+tags.length*10+res.conf/20};
  }
  async function recognizeLeveled(source,region,deg,opts){
    const c=levelCanvas(source,region,deg);
    try{const res=await recognize(c,{x:0,y:0,w:c.width,h:c.height},{...opts,block:true});return {...res,angle:deg,...scoreRead(res)};}
    finally{c.width=c.height=0;}
  }
  const norm180=a=>{a=((a%360)+360)%360;return a>180?a-360:a;};
  // Подбор угла: оценка наклона φ, чтение при φ и φ±5°; если нет ни одного тега с установкой — тот же набор для
  // φ+180° (бирка вверх ногами), затем φ±90° (текст вертикально). Останавливается на первом наборе с тегом.
  async function autoLevel(source,region,{stage,progress,abort}={}){
    await ensure(stage);
    const phi=estimateSkew(source,region),t0=performance.now();
    const groups=[phi,phi+180,phi+90,phi-90];let best=null,done=0;const total=groups.length*3;
    for(const base of groups){
      for(const d of [0,-5,5]){
        if(abort&&abort())return best;
        if(best&&performance.now()-t0>30000)return best; // не дольше ~30 с на фото
        stage&&stage(TX('Выравниваю: угол {0}°…',Math.round(norm180(base+d))));
        const r=await recognizeLeveled(source,region,norm180(base+d),{});
        done++;progress&&progress(done/total);
        if(!best||r.score>best.score)best=r;
      }
      if(best&&best.score>=100)break;
    }
    return best;
  }
  window.LocalOCR={recognize,warmUp:()=>ensure(),levelCanvas,estimateSkew,recognizeLeveled,autoLevel,score:scoreRead};
})();
