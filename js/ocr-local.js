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
  function prepare(source,sx,sy,sw,sh,scale,flat){
    const w=Math.max(1,Math.round(sw*scale)),h=Math.max(1,Math.round(sh*scale));
    const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{willReadFrequently:true});
    g.imageSmoothingQuality='high';g.drawImage(source,sx,sy,sw,sh,0,0,w,h);
    const img=g.getImageData(0,0,w,h),d=img.data,n=w*h,gray=new Uint8ClampedArray(n),hist=new Uint32Array(256);
    for(let i=0,j=0;j<n;i+=4,j++){const v=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000|0;gray[j]=v;}
    // v120: бирка — блики и тень на металле: яркость делится на размытый фон (окно ~1/12 участка).
    if(flat){
      const I=new Float64Array((w+1)*(h+1));
      for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=gray[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+row;}}
      const r=Math.max(10,Math.round(Math.min(w,h)/12)),out=new Uint8ClampedArray(n);
      for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);
        for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1);
          const bg=(I[y1*(w+1)+x1]-I[y0*(w+1)+x1]-I[y1*(w+1)+x0]+I[y0*(w+1)+x0])/((x1-x0)*(y1-y0));
          out[y*w+x]=Math.min(255,gray[y*w+x]*200/Math.max(8,bg));}}
      gray.set(out);
    }
    for(let j=0;j<n;j++)hist[gray[j]]++;
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
  async function recognize(source,region,{stage,progress,block,flat}={}){
    await ensure(stage);
    const scale=block?chooseScaleBlock(region.w):chooseScale(region.w),strips=planStrips(region.h,scale);
    const wordsA=[],wordsB=[];let conf=0,confW=0;const t0=performance.now();
    for(let k=0;k<strips.length;k++){
      const st=strips[k];
      stage&&stage(strips.length>1?TX('Распознаю на телефоне: часть {0} из {1}…',k+1,strips.length):TX('Распознаю на телефоне…'));
      onProgress=v=>progress&&progress((k+v)/strips.length);
      const canvas=prepare(source,region.x,region.y+st.y0,region.w,st.h,scale,!!flat);
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
  // v120: направление строк по соседству букв (метод «докструм»). Участок → бинаризация по местному среднему
  // (тёмный текст на светлом и, отдельно, светлый на тёмном) → связные пятна → оставляем похожие на буквы
  // (размер, пропорции, заполненность) → для каждой буквы 3 ближайших соседа похожей высоты → углы пар.
  // Буквы в строке стоят ближе, чем строки друг к другу, поэтому мода углов — направление строки в диапазоне
  // −90…+90°; рамка бирки и крупные пятна в расчёт не попадают. Остаётся неоднозначность 0°/180° — её решает чтение.
  function binarize(gray,w,h,dark){
    const I=new Float64Array((w+1)*(h+1));
    for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=gray[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+row;}}
    const r=Math.max(8,Math.round(Math.min(w,h)/40)),m=new Uint8Array(w*h);
    for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);
      for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1);
        const mean=(I[y1*(w+1)+x1]-I[y0*(w+1)+x1]-I[y1*(w+1)+x0]+I[y0*(w+1)+x0])/((x1-x0)*(y1-y0)),v=gray[y*w+x];
        m[y*w+x]=dark?(v<mean*0.85&&mean-v>10?1:0):(v>mean*1.15&&v-mean>10?1:0);}}
    return m;
  }
  function blobs(m,w,h){
    const lab=new Int32Array(w*h),out=[],stack=[];let id=0;
    for(let i=0;i<w*h;i++){
      if(!m[i]||lab[i])continue;id++;lab[i]=id;stack.push(i);
      let n=0,sx=0,sy=0,x0=w,x1=0,y0=h,y1=0;
      while(stack.length){const j=stack.pop(),x=j%w,y=(j-x)/w;n++;sx+=x;sy+=y;
        if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
        for(const k of [j-1,j+1,j-w,j+w]){if(k<0||k>=w*h)continue;if((k===j-1&&x===0)||(k===j+1&&x===w-1))continue;if(m[k]&&!lab[k]){lab[k]=id;stack.push(k);}}}
      out.push({n,cx:sx/n,cy:sy/n,bw:x1-x0+1,bh:y1-y0+1});
    }
    return out;
  }
  function letterAngles(gray,w,h,dark){
    const H=Math.min(w,h),all=blobs(binarize(gray,w,h,dark),w,h);
    // Похожие на буквы: не точки и не рамка; размер берётся по большей стороне — у повёрнутой буквы рамка шире.
    const L=all.filter(b=>{const s=Math.max(b.bw,b.bh),t=Math.min(b.bw,b.bh);return s>=6&&s<=H*0.25&&t>=2&&s/t<=6&&b.n/(b.bw*b.bh)>0.12&&b.n/(b.bw*b.bh)<0.95;});
    if(L.length<8)return {n:L.length,hist:null,L};
    const hist=new Float32Array(360); // шаг 0,5°, угол −90…+90
    const put=(a,wt)=>{if(a<=-90)a+=180;if(a>90)a-=180;hist[Math.min(359,Math.max(0,Math.round((a+90)*2)))]+=wt;};
    // Сетка для поиска соседей.
    const cell=Math.max(8,Math.round(H/12)),gw=Math.ceil(w/cell),gh=Math.ceil(h/cell),grid=new Map();
    L.forEach((b,i)=>{b.s=Math.max(b.bw,b.bh);const k=Math.floor(b.cx/cell)+Math.floor(b.cy/cell)*gw;(grid.get(k)||grid.set(k,[]).get(k)).push(i);});
    for(const b of L){
      const gx=Math.floor(b.cx/cell),gy=Math.floor(b.cy/cell),near=[];
      for(let yy=gy-2;yy<=gy+2;yy++)for(let xx=gx-2;xx<=gx+2;xx++){if(xx<0||yy<0||xx>=gw||yy>=gh)continue;
        for(const j of grid.get(xx+yy*gw)||[]){const o=L[j];if(o===b)continue;const r=o.s/b.s;if(r<0.6||r>1.67)continue;
          const d=Math.hypot(o.cx-b.cx,o.cy-b.cy);if(d<=b.s*2.6)near.push([d,o]);}}
      near.sort((p,q)=>p[0]-q[0]);
      for(const [d,o] of near.slice(0,2))put(Math.atan2(o.cy-b.cy,o.cx-b.cx)*180/Math.PI,1/(1+d/b.s));
    }
    return {n:L.length,hist,L};
  }
  function estimateSkew(source,region){
    const S=800,s=Math.min(1,S/Math.max(region.w,region.h)),w=Math.max(1,Math.round(region.w*s)),h=Math.max(1,Math.round(region.h*s));
    const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{willReadFrequently:true});
    g.drawImage(source,region.x,region.y,region.w,region.h,0,0,w,h);
    const d=g.getImageData(0,0,w,h).data,gray=new Float32Array(w*h);c.width=c.height=0;
    for(let i=0,j=0;j<w*h;i+=4,j++)gray[j]=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000;
    let best=null;
    for(const dark of [true,false]){
      const r=letterAngles(gray,w,h,dark);if(!r.hist)continue;
      // Сглаживание по кругу (±2°), мода и уточнение по соседним бинам.
      const sm=new Float32Array(360);
      for(let k=0;k<360;k++){let v=0;for(let t=-4;t<=4;t++)v+=r.hist[(k+t+360)%360]*(1-Math.abs(t)/5);sm[k]=v;}
      let k0=0;for(let k=1;k<360;k++)if(sm[k]>sm[k0])k0=k;
      const total=sm.reduce((p,q)=>p+q,0),peak=sm[k0]/Math.max(1e-6,total);
      if(!best||peak*Math.sqrt(r.n)>best.q)best={q:peak*Math.sqrt(r.n),angle:k0/2-90,n:r.n,L:r.L};
    }
    if(!best)return 0;
    // Уточнение: центры букв ровной строки ложатся в узкие полосы. Ищем ±6° вокруг найденного направления и
    // вокруг перпендикулярного: где полосы резче, там и строки (снимает путаницу «строка или столбец»).
    const L=best.L,sizes=L.map(b=>b.s).sort((p,q)=>p-q),bin=Math.max(1.5,sizes[sizes.length>>1]*0.3);
    const sharp=a=>{const rad=a*Math.PI/180,sn=Math.sin(rad),cs=Math.cos(rad),m=new Map();
      for(const b of L){const k=Math.round((-b.cx*sn+b.cy*cs)/bin);m.set(k,(m.get(k)||0)+1);}
      let q=0;for(const v of m.values())q+=v*v;return q/(L.length*L.length);};
    let fine={q:-1,a:best.angle};
    for(const base of [best.angle,best.angle+90])for(let t=-6;t<=6;t+=0.5){const a=base+t,q=sharp(a);if(q>fine.q)fine={q,a};}
    let a=fine.a;if(a>90)a-=180;if(a<=-90)a+=180;
    // Строка под углом a к горизонтали → поворот по часовой на −a выравнивает её.
    return Math.round(-a*2)/2;
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
  // v120: согласование тегов из нескольких чтений одного участка под соседними углами.
  // Похожие теги (одна длина и до 3 отличий, либо до 2 правок) — один тег; каждый знак выбирается голосованием,
  // вес чтения — его уверенность. Остаётся тег, найденный хотя бы в двух чтениях; если таких нет — самый уверенный одиночный.
  function editDist(a,b){const m=a.length,n=b.length,d=Array.from({length:m+1},(_,i)=>[i]);for(let j=1;j<=n;j++)d[0][j]=j;
    for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[m][n];}
  function similar(a,b){if(a.length===b.length){let h=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])h++;return h<=3;}return editDist(a,b)<=2;}
  function consensus(reads){
    const clusters=[];
    reads.forEach((r,ri)=>{for(const t of new Set(r.strict)){
      let c=clusters.find(c=>similar(c.items[0].t,t));if(!c){c={items:[]};clusters.push(c);}
      c.items.push({t,w:Math.max(5,r.conf),ri});}});
    const sup=c=>new Set(c.items.map(x=>x.ri)).size;
    // Нужно подтверждение двумя чтениями; если подтверждённых нет — берётся самый уверенный одиночный тег.
    let need=reads.length>=3?2:1;if(!clusters.some(c=>sup(c)>=need))need=1;
    const pool=need===1&&reads.length>=3?clusters.sort((p,q)=>q.items.reduce((a,x)=>a+x.w,0)-p.items.reduce((a,x)=>a+x.w,0)).slice(0,1):clusters,out=[];
    for(const c of pool){
      const support=sup(c);if(support<need)continue;
      // Длина — самая частая (по весу); знаки — голосованием среди тегов этой длины.
      const lw=new Map();for(const x of c.items)lw.set(x.t.length,(lw.get(x.t.length)||0)+x.w);
      const len=[...lw.entries()].sort((p,q)=>q[1]-p[1])[0][0],same=c.items.filter(x=>x.t.length===len);
      let tag="";for(let i=0;i<len;i++){const v=new Map();for(const x of same)v.set(x.t[i],(v.get(x.t[i])||0)+x.w);tag+=[...v.entries()].sort((p,q)=>q[1]-p[1])[0][0];}
      if(!/^\d{2,5}-[A-Z]{1,5}-\d{1,5}[A-Z0-9]{0,2}$/.test(tag))tag=same.sort((p,q)=>q.w-p.w)[0].t;
      out.push({tag,support});
    }
    return out.sort((p,q)=>q.support-p.support).map(x=>x.tag);
  }
  // Подбор угла (v120):
  //  1) наклон φ — по соседству букв (estimateSkew) или угол, выставленный вручную (opts.angle);
  //  2) сторона: φ и φ+180° (вверх ногами) с шагом 2° (±4°), затем φ±90°; при ручном угле сторону задал человек —
  //     только φ±4°; затем запасные чтения без выравнивания фона;
  //  3) уточнение: до 4 чтений при соседних углах (±1…4°), теги согласуются голосованием.
  // Не дольше ~30 с на фото; «Стоп» прерывает.
  async function autoLevel(source,region,{stage,progress,abort,angle}={}){
    await ensure(stage);
    const manual=typeof angle==="number"&&isFinite(angle);
    const phi=manual?angle:estimateSkew(source,region),t0=performance.now();
    // Чтение бирки очень чувствительно к углу (на одной бирке 199° и 201° читаются, 200° — нет), а оценка наклона
    // ошибается на 2–3°. Поэтому сторона ищется перебором с шагом 2° вокруг φ и φ+180°, затем φ±90°;
    // после первого тега с установкой — ещё чтения при соседних углах и голосование.
    const offs=[0,2,-2,4,-4];
    const sides=manual?offs.map(d=>phi+d):offs.flatMap(d=>[phi+d,phi+180+d]).concat([phi+90,phi-90,phi+92,phi-88,phi+88,phi-92]);
    // Без выравнивания фона — запасные чтения: на части бирок (мелкая гравировка) оно мешает.
    const spare=manual?[[phi-1,false],[phi+1,false]]:[[phi-1,false],[phi+1,false],[phi+179,false],[phi+181,false]];
    const total=sides.length+spare.length;let done=0,side=null,first=null;const tried=new Set();
    const read=async(a,flat=true)=>{stage&&stage(TX('Выравниваю: угол {0}°…',Math.round(norm180(a))));tried.add(Math.round(norm180(a)*2)+(flat?'f':'p'));
      const r=await recognizeLeveled(source,region,norm180(a),{flat});done++;progress&&progress(Math.min(.9,done/total));return {...r,flat};};
    const late=()=>performance.now()-t0>30000;
    for(const [a,flat] of sides.map(a=>[a,true]).concat(spare)){
      if(abort&&abort())return first;
      const r=await read(a,flat);
      if(!first||r.score>first.score)first=r;
      if(r.strict.length){side=r;break;}
      if(late())break;
    }
    if(!side)return first&&{...first,strict:[],angle:norm180(first.angle)};
    const reads=[side];let extra=0;
    for(const d of [-1,1,-2,2,-3,3,-4,4]){
      if(extra>=4||(abort&&abort())||late())break;
      const a=side.angle+d;if(tried.has(Math.round(norm180(a)*2)+(side.flat?'f':'p')))continue;
      reads.push(await read(a,side.flat));extra++;
    }
    progress&&progress(1);
    const tags=consensus(reads),conf=reads.reduce((p,r)=>p+r.conf,0)/reads.length;
    return {text:tags.join('\n'),tags,strict:tags,conf,score:tags.length*100+conf/20,angle:norm180(side.angle),reads:reads.length};
  }
  window.LocalOCR={recognize,warmUp:()=>ensure(),levelCanvas,estimateSkew,recognizeLeveled,autoLevel,consensus,score:scoreRead};
})();
