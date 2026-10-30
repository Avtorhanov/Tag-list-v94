/* Tag list v112 — фото в задании тега (до 5 на тег).
   Фото сжимаются на телефоне (длинная сторона до 1600 px, JPEG) и хранятся в IndexedDB,
   в теге — только их id (item.photos). Без интернета, фото не покидает устройство.
   В JSON-состояние уходят id; на другом телефоне без самих фото просмотр сообщит об этом.
   Окно просмотра: листание, удаление (второе касание подтверждает), закрытие. */
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
  }
  function labels(){
    viewer.querySelector('[data-pv="prev"]').textContent="←";
    viewer.querySelector('[data-pv="prev"]').setAttribute("aria-label",TX("Предыдущее фото"));
    viewer.querySelector('[data-pv="next"]').textContent="→";
    viewer.querySelector('[data-pv="next"]').setAttribute("aria-label",TX("Следующее фото"));
    viewer.querySelector('[data-pv="close"]').textContent=TX("Закрыть");
  }
  function resetDel(){const d=viewer.querySelector('[data-pv="del"]');d.textContent=TX("Удалить");d.classList.remove("armed");}
  async function show(i){
    const ids=state.ids();
    if(!ids.length){close();return;}
    state.index=Math.max(0,Math.min(ids.length-1,i));
    resetDel();
    const id=ids[state.index];
    viewer.querySelector(".pvCap").textContent=TX("{0} · фото {1} из {2}",state.title,state.index+1,ids.length);
    viewer.querySelector('[data-pv="prev"]').disabled=state.index===0;
    viewer.querySelector('[data-pv="next"]').disabled=state.index>=ids.length-1;
    const img=viewer.querySelector(".pvImg"),miss=viewer.querySelector(".pvMissing");
    const blob=await get(id);
    if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl="";}
    if(blob){currentUrl=URL.createObjectURL(blob);img.src=currentUrl;img.hidden=false;miss.hidden=true;}
    else{img.removeAttribute("src");img.hidden=true;miss.hidden=false;miss.textContent=TX("Этого фото нет на устройстве (состояние перенесено с другого телефона)");}
  }
  async function askDelete(btn){
    if(!btn.classList.contains("armed")){btn.classList.add("armed");btn.textContent=TX("Точно удалить?");return;}
    const id=state.ids()[state.index];
    await state.onDelete(id);
    await remove(id);
    if(!state.ids().length){close();return;}
    show(Math.min(state.index,state.ids().length-1));
  }
  function open(opts){
    if(!viewer)build();
    labels();
    state={title:opts.title||"",ids:opts.ids,onDelete:opts.onDelete,index:0};
    viewer.hidden=false;document.body.classList.add("photo-viewing");
    show(opts.index||0);
    viewer.querySelector('[data-pv="close"]').focus({preventScroll:true});
  }
  function close(){
    if(!viewer)return;
    viewer.hidden=true;document.body.classList.remove("photo-viewing");
    if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl="";}
    viewer.querySelector(".pvImg").removeAttribute("src");
    state=null;
  }

  window.TagPhotos={MAX:MAX_PER_TAG,addFiles,get,remove,cleanup,open,close};
})();
