/* Tag list v113 — фото в задании тега (до 5 на тег).
   Фото сжимаются на телефоне (длинная сторона до 1600 px, JPEG) и хранятся в IndexedDB,
   в теге — только их id (item.photos). Без интернета, фото не покидает устройство.
   В JSON-состояние уходят id; на другом телефоне без самих фото просмотр сообщит об этом.
   Окно просмотра: листание, удаление (второе касание подтверждает), закрытие.
   v113: увеличение — щипок двумя пальцами (1–4×), двойное касание (1× ↔ 2.5×), колесо мыши;
   при увеличении фото тянется пальцем. Кнопки «←/→» и стрелки работают как прежде.
   v116: свайп влево/вправо — соседнее фото, свайп вниз — закрыть (когда фото не увеличено).
   open({deleteLabel, keepBlob}) — для отчёта: «Убрать из отчёта», сам снимок не удаляется. */
(function(){
  "use strict";
  const TX=(s,...a)=>typeof window.TX==="function"?window.TX(s,...a):String(s).replace(/\{(\d+)\}/g,(m,i)=>a[i]!==undefined?String(a[i]):m);
  const DB_NAME="tag-list-photos",STORE="photos",MAX_SIDE=1600,QUALITY=0.82;
  const MAX_PER_TAG=5;
  let dbPromise=null;

  function openDb(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      if(!window.indexedDB){reject(new Error(TX("Хранилище фото недоступно")));return;}
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error(TX("Хранилище фото недоступно")));
    });
    dbPromise.catch(()=>{dbPromise=null;});
    return dbPromise;
  }
  async function tx(mode,fn){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const t=db.transaction(STORE,mode),store=t.objectStore(STORE);
      let result;
      Promise.resolve(fn(store)).then(r=>{result=r;});
      t.oncomplete=()=>resolve(result);
      t.onerror=()=>reject(t.error);
      t.onabort=()=>reject(t.error||new Error("abort"));
    });
  }
  const reqP=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});

  function newId(){return "ph-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);}

  async function decode(file){
    if(window.createImageBitmap){
      try{return await createImageBitmap(file,{imageOrientation:"from-image"});}catch(_){}
      try{return await createImageBitmap(file);}catch(_){}
    }
    return await new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file),img=new Image();
      img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error(TX("Не удалось открыть фото")));};
      img.src=url;
    });
  }
  // Одно фото за раз: холст создаётся и освобождается сразу (бюджетные телефоны, мало памяти).
  async function compress(file){
    const src=await decode(file);
    const w=src.width||src.naturalWidth,h=src.height||src.naturalHeight;
    const k=Math.min(1,MAX_SIDE/Math.max(w,h));
    const cw=Math.max(1,Math.round(w*k)),ch=Math.max(1,Math.round(h*k));
    const c=document.createElement("canvas");c.width=cw;c.height=ch;
    c.getContext("2d").drawImage(src,0,0,cw,ch);
    if(src.close)src.close();
    const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",QUALITY));
    c.width=c.height=0;
    if(!blob)throw new Error(TX("Не удалось сжать фото"));
    return blob;
  }

  async function addFiles(files,room){
    const out=[];
    for(const f of Array.from(files||[]).slice(0,Math.max(0,room))){
      if(!f||!/^image\//.test(f.type||"image/"))continue;
      const blob=await compress(f);
      const id=newId();
      await tx("readwrite",s=>reqP(s.put(blob,id)));
      out.push(id);
    }
    return out;
  }
  async function get(id){try{return await tx("readonly",s=>reqP(s.get(id)));}catch(_){return null;}}
  async function remove(id){try{await tx("readwrite",s=>reqP(s.delete(id)));}catch(_){}}
  // Удаляет фото, на которые не ссылается ни один тег (удалённые теги, заменённое состояние).
  async function cleanup(keep){
    try{
      const keys=await tx("readonly",s=>reqP(s.getAllKeys()));
      const stale=(keys||[]).filter(k=>!keep.has(k));
      if(stale.length)await tx("readwrite",s=>Promise.all(stale.map(k=>reqP(s.delete(k)))));
      return stale.length;
    }catch(_){return 0;}
  }

  // ---------- окно просмотра
  let viewer=null,state=null,currentUrl="";
  const ZOOM_MIN=1,ZOOM_MAX=4,ZOOM_DOUBLE=2.5,DOUBLE_TAP_MS=320,DOUBLE_TAP_PX=40;
  const zm={s:1,tx:0,ty:0};          // масштаб и сдвиг относительно центра изображения (px экрана)
  const ptrs=new Map();              // активные касания
  let pinch=null,lastTap={t:0,x:0,y:0},moved=false,suppressUntil=0,downAt=0,tapConsumed=false;
  let swipe=null;                    // {x0,y0,axis,dx,dy} — свайп по неувеличенному фото
  const SWIPE_X=60,SWIPE_DOWN=100;

  function build(){
    viewer=document.createElement("div");
    viewer.className="photoViewer";viewer.hidden=true;
    viewer.setAttribute("role","dialog");viewer.setAttribute("aria-modal","true");
    viewer.innerHTML=`<div class="pvStage"><img class="pvImg" alt=""><div class="pvMissing" hidden></div></div>
      <div class="pvBar"><div class="pvCap"></div><div class="pvBtns">
        <button type="button" class="pvBtn" data-pv="prev"></button>
        <button type="button" class="pvBtn" data-pv="next"></button>
        <button type="button" class="pvBtn pvDel" data-pv="del"></button>
        <button type="button" class="pvBtn pvClose" data-pv="close"></button>
      </div></div>`;
    document.body.appendChild(viewer);
    viewer.addEventListener("click",e=>{
      if(Date.now()<suppressUntil)return; // после щипка или перетаскивания это не «закрыть»
      const b=e.target.closest("[data-pv]");
      if(!b){if(e.target===viewer||e.target.classList.contains("pvStage"))close();return;}
      const a=b.dataset.pv;
      if(a==="close")close();
      else if(a==="prev")show(state.index-1);
      else if(a==="next")show(state.index+1);
      else if(a==="del")askDelete(b);
    });
    document.addEventListener("keydown",e=>{
      if(!state||viewer.hidden)return;
      if(e.key==="Escape")close();else if(e.key==="ArrowLeft")show(state.index-1);else if(e.key==="ArrowRight")show(state.index+1);
    });
    const stage=viewer.querySelector(".pvStage");
    stage.addEventListener("pointerdown",onDown);
    stage.addEventListener("pointermove",onMove);
    stage.addEventListener("pointerup",onUp);
    stage.addEventListener("pointercancel",onUp);
    stage.addEventListener("wheel",onWheel,{passive:false});
  }

  // ----- увеличение
  function imgEl(){return viewer.querySelector(".pvImg");}
  function stageEl(){return viewer.querySelector(".pvStage");}
  function paintZoom(){
    imgEl().style.transform=`translate(${zm.tx}px,${zm.ty}px) scale(${zm.s})`;
    viewer.classList.toggle("zoomed",zm.s>1.01);
  }
  function resetZoom(){zm.s=1;zm.tx=0;zm.ty=0;paintZoom();}
  // Сдвиг ограничен краями изображения: при увеличении оно не уходит за экран.
  function clampPan(){
    const img=imgEl(),st=stageEl();
    const mx=Math.max(0,(zm.s*img.offsetWidth-st.clientWidth)/2);
    const my=Math.max(0,(zm.s*img.offsetHeight-st.clientHeight)/2);
    zm.tx=Math.max(-mx,Math.min(mx,zm.tx));
    zm.ty=Math.max(-my,Math.min(my,zm.ty));
  }
  // (cx,cy) — точка экрана относительно центра изображения: она остаётся на месте при масштабе.
  function zoomAt(ns,cx,cy){
    ns=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,ns));
    const k=ns/zm.s;
    zm.tx=cx-(cx-zm.tx)*k;
    zm.ty=cy-(cy-zm.ty)*k;
    zm.s=ns;
    if(zm.s<=1.01)resetZoom();else{clampPan();paintZoom();}
  }
  function centreOffset(clientX,clientY){
    const r=stageEl().getBoundingClientRect();
    return{x:clientX-(r.left+r.width/2),y:clientY-(r.top+r.height/2)};
  }
  function onDown(e){
    if(!state)return;
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY});
    // Без setPointerCapture: захват перенаправляет «отпускание» на сцену, и касание по фото
    // превращается в клик по фону (окно закрывалось бы). События и так всплывают от фото к сцене.
    if(ptrs.size===1){
      moved=false;
      const now=Date.now();
      downAt=now;
      if(now-lastTap.t<DOUBLE_TAP_MS&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<DOUBLE_TAP_PX){
        lastTap.t=0;tapConsumed=true;suppressUntil=now+350;
        const p=centreOffset(e.clientX,e.clientY);
        if(zm.s>1.01)resetZoom();else zoomAt(ZOOM_DOUBLE,p.x,p.y);
        return;
      }
    }
    if(ptrs.size===1&&zm.s<=1.01)swipe={x0:e.clientX,y0:e.clientY,axis:null,dx:0,dy:0};
    if(ptrs.size===2){
      if(swipe){swipe=null;resetSwipeLook(false);}
      const [a,b]=[...ptrs.values()];
      pinch={d:Math.hypot(a.x-b.x,a.y-b.y)||1,mid:centreOffset((a.x+b.x)/2,(a.y+b.y)/2)};
    }
  }
  function onMove(e){
    const p=ptrs.get(e.pointerId);
    if(!p)return;
    const dx=e.clientX-p.x,dy=e.clientY-p.y;
    p.x=e.clientX;p.y=e.clientY;
    if(Math.hypot(p.x-p.x0,p.y-p.y0)>8)moved=true;
    if(ptrs.size>=2&&pinch){
      const [a,b]=[...ptrs.values()];
      const d=Math.hypot(a.x-b.x,a.y-b.y)||1;
      const mid=centreOffset((a.x+b.x)/2,(a.y+b.y)/2);
      zoomAt(zm.s*(d/pinch.d),mid.x,mid.y);
      zm.tx+=mid.x-pinch.mid.x;zm.ty+=mid.y-pinch.mid.y;
      clampPan();paintZoom();
      pinch.d=d;pinch.mid=mid;
      suppressUntil=Date.now()+350;
      e.preventDefault();
      return;
    }
    if(ptrs.size===1&&swipe&&zm.s<=1.01){
      swipe.dx=e.clientX-swipe.x0;swipe.dy=e.clientY-swipe.y0;
      if(!swipe.axis&&Math.hypot(swipe.dx,swipe.dy)>10)swipe.axis=Math.abs(swipe.dx)>=Math.abs(swipe.dy)?"x":"y";
      const img=imgEl();
      if(swipe.axis==="x"){img.style.transform=`translateX(${swipe.dx}px)`;}
      else if(swipe.axis==="y"){
        const d=Math.max(0,swipe.dy),k=Math.min(1,d/400);
        img.style.transform=`translateY(${d}px) scale(${1-k*0.25})`;
        viewer.style.backgroundColor=`rgba(4,8,16,${(0.94*(1-k)).toFixed(3)})`;
      }
      if(swipe.axis){suppressUntil=Date.now()+350;e.preventDefault();}
      return;
    }
    if(ptrs.size===1&&zm.s>1.01){
      zm.tx+=dx;zm.ty+=dy;clampPan();paintZoom();
      suppressUntil=Date.now()+350;
      e.preventDefault();
    }
  }
  function resetSwipeLook(animate){
    const img=imgEl();
    if(animate){img.classList.add("pvSnap");setTimeout(()=>img.classList.remove("pvSnap"),200);}
    img.style.transform=zm.s>1.01?`translate(${zm.tx}px,${zm.ty}px) scale(${zm.s})`:"";
    viewer.style.backgroundColor="";
  }
  function finishSwipe(){
    const sw=swipe;swipe=null;
    if(!sw||!sw.axis||!state)return;
    suppressUntil=Date.now()+350;
    const n=state.ids().length;
    if(sw.axis==="x"&&sw.dx<=-SWIPE_X&&state.index<n-1){resetSwipeLook(false);show(state.index+1);return;}
    if(sw.axis==="x"&&sw.dx>=SWIPE_X&&state.index>0){resetSwipeLook(false);show(state.index-1);return;}
    if(sw.axis==="y"&&sw.dy>=SWIPE_DOWN){resetSwipeLook(false);close();return;}
    resetSwipeLook(true);
  }
  function onUp(e){
    ptrs.delete(e.pointerId);
    if(ptrs.size===0&&swipe)finishSwipe();
    if(ptrs.size<2)pinch=null;
    if(moved||ptrs.size>0)suppressUntil=Date.now()+350;
    // Двойным касанием считается только короткое касание без движения: после щипка или
    // тяги следующее касание не должно сбрасывать масштаб.
    if(ptrs.size===0){
      // Касание, которое уже сработало как двойное, не начинает новую пару.
      if(tapConsumed)tapConsumed=false;
      else if(!moved&&Date.now()-downAt<400)lastTap={t:Date.now(),x:e.clientX,y:e.clientY};
    }
  }
  function onWheel(e){
    if(!state)return;
    e.preventDefault();
    const p=centreOffset(e.clientX,e.clientY);
    zoomAt(zm.s*(e.deltaY<0?1.15:1/1.15),p.x,p.y);
  }

  function labels(){
    viewer.querySelector('[data-pv="prev"]').textContent="←";
    viewer.querySelector('[data-pv="prev"]').setAttribute("aria-label",TX("Предыдущее фото"));
    viewer.querySelector('[data-pv="next"]').textContent="→";
    viewer.querySelector('[data-pv="next"]').setAttribute("aria-label",TX("Следующее фото"));
    viewer.querySelector('[data-pv="close"]').textContent=TX("Закрыть");
  }
  function resetDel(){const d=viewer.querySelector('[data-pv="del"]');d.textContent=state?.deleteLabel||TX("Удалить");d.classList.remove("armed");}
  async function show(i){
    const ids=state.ids();
    if(!ids.length){close();return;}
    state.index=Math.max(0,Math.min(ids.length-1,i));
    resetDel();
    resetZoom();
    const id=ids[state.index];
    viewer.querySelector(".pvCap").textContent=TX("{0} · фото {1} из {2}",state.title,state.index+1,ids.length);
    viewer.querySelector('[data-pv="prev"]').disabled=state.index===0;
    viewer.querySelector('[data-pv="next"]').disabled=state.index>=ids.length-1;
    const img=imgEl(),miss=viewer.querySelector(".pvMissing");
    const blob=await get(id);
    if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl="";}
    if(blob){currentUrl=URL.createObjectURL(blob);img.src=currentUrl;img.hidden=false;miss.hidden=true;}
    else{img.removeAttribute("src");img.hidden=true;miss.hidden=false;miss.textContent=TX("Этого фото нет на устройстве (состояние перенесено с другого телефона)");}
  }
  async function askDelete(btn){
    const id=state.ids()[state.index];
    if(state.keepBlob){await state.onDelete(id);}   // убрать из отчёта: без подтверждения, снимок остаётся у тега
    else{
      if(!btn.classList.contains("armed")){btn.classList.add("armed");btn.textContent=TX("Точно удалить?");return;}
      await state.onDelete(id);
      await remove(id);
    }
    if(!state.ids().length){close();return;}
    show(Math.min(state.index,state.ids().length-1));
  }
  function open(opts){
    if(!viewer)build();
    labels();
    state={title:opts.title||"",ids:opts.ids,onDelete:opts.onDelete,index:0,deleteLabel:opts.deleteLabel||"",keepBlob:!!opts.keepBlob};
    viewer.hidden=false;document.body.classList.add("photo-viewing");
    show(opts.index||0);
    viewer.querySelector('[data-pv="close"]').focus({preventScroll:true});
  }
  function close(){
    if(!viewer)return;
    viewer.hidden=true;document.body.classList.remove("photo-viewing");
    if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl="";}
    imgEl().removeAttribute("src");
    swipe=null;viewer.style.backgroundColor="";
    resetZoom();
    ptrs.clear();pinch=null;
    state=null;
  }

  window.TagPhotos={MAX:MAX_PER_TAG,addFiles,get,remove,cleanup,open,close,isOpen:()=>!!(viewer&&!viewer.hidden)};
})();
