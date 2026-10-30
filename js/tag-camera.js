/* Tag list v114 — серийная съёмка фото к тегу.
   Камера открывается внутри приложения (getUserMedia) и не закрывается после снимка:
   можно сделать несколько фото подряд, пока не наберётся лимит тега (5).
   Каждый снимок сохраняется сразу (onShot), поэтому при закрытии ничего не теряется.
   Если камера внутри страницы недоступна (нет разрешения, старый браузер) — open() вернёт false,
   и приложение откроет системную камеру на один снимок, как раньше. */
(function(){
  "use strict";
  const TX=(s,...a)=>typeof window.TX==="function"?window.TX(s,...a):String(s).replace(/\{(\d+)\}/g,(m,i)=>a[i]!==undefined?String(a[i]):m);
  let view=null,stream=null,opts=null,busy=false,torchOn=false,closeTimer=0;

  const supported=()=>!!(navigator.mediaDevices&&typeof navigator.mediaDevices.getUserMedia==="function");

  function build(){
    view=document.createElement("div");
    view.className="camView";view.hidden=true;
    view.setAttribute("role","dialog");view.setAttribute("aria-modal","true");
    view.innerHTML=`<video class="camVideo" playsinline muted autoplay></video>
      <div class="camFlash"></div>
      <div class="camTop"><div class="camTitle"></div><div class="camCount"></div>
        <button type="button" class="camBtn camTorch" data-cam="torch" hidden></button>
        <button type="button" class="camBtn camDone" data-cam="done"></button></div>
      <div class="camMsg" hidden></div>
      <div class="camBottom"><div class="camStrip"></div>
        <button type="button" class="camShutter" data-cam="shot"><span></span></button>
        <div class="camSpacer"></div></div>`;
    document.body.appendChild(view);
    view.addEventListener("click",e=>{
      const b=e.target.closest("[data-cam]");if(!b)return;
      const a=b.dataset.cam;
      if(a==="shot")shoot();else if(a==="done")close();else if(a==="torch")toggleTorch();
    });
    document.addEventListener("keydown",e=>{if(view&&!view.hidden&&e.key==="Escape")close();});
    document.addEventListener("visibilitychange",()=>{if(document.hidden&&isOpen())close();});
  }
  const isOpen=()=>!!(view&&!view.hidden);
  const q=s=>view.querySelector(s);

  function paint(){
    const n=opts.count(),max=opts.max;
    q(".camCount").textContent=`${n}/${max}`;
    q(".camShutter").disabled=busy||n>=max;
    q(".camShutter").setAttribute("aria-label",TX("Сделать снимок"));
    q(".camDone").textContent=TX("Готово");
  }
  function msg(text){const m=q(".camMsg");m.hidden=!text;m.textContent=text||"";}

  async function open(o){
    if(!supported())return false;
    if(!view)build();
    opts=o;busy=false;torchOn=false;clearTimeout(closeTimer);
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:o.hi?2560:1920},height:{ideal:o.hi?1920:1440}}});
    }catch(err){
      stream=null;
      return false; // нет разрешения или камеры — приложение откроет системную камеру
    }
    q(".camTitle").textContent=o.title||"";
    q(".camStrip").replaceChildren();
    msg("");
    const video=q(".camVideo");
    video.srcObject=stream;
    try{await video.play();}catch(_){}
    const track=stream.getVideoTracks()[0];
    let torch=false;
    try{torch=!!(track&&track.getCapabilities&&track.getCapabilities().torch);}catch(_){}
    const tb=q(".camTorch");tb.hidden=!torch;tb.textContent=TX("Фонарь");tb.classList.remove("on");
    view.hidden=false;document.body.classList.add("camera-open");
    paint();
    q(".camShutter").focus({preventScroll:true});
    return true;
  }

  async function toggleTorch(){
    const track=stream&&stream.getVideoTracks()[0];if(!track)return;
    torchOn=!torchOn;
    try{await track.applyConstraints({advanced:[{torch:torchOn}]});}catch(_){torchOn=false;}
    q(".camTorch").classList.toggle("on",torchOn);
  }

  async function shoot(){
    if(busy||!stream||opts.count()>=opts.max)return;
    const video=q(".camVideo"),w=video.videoWidth,h=video.videoHeight;
    if(!w||!h)return;
    const o=opts; // v118: «Готово» может закрыть камеру, пока снимок сохраняется
    busy=true;paint();
    const f=q(".camFlash");f.classList.remove("go");void f.offsetWidth;f.classList.add("go");
    try{
      const c=document.createElement("canvas");c.width=w;c.height=h;
      c.getContext("2d").drawImage(video,0,0,w,h);
      const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",0.92));
      c.width=c.height=0;
      if(!blob)throw new Error(TX("Не удалось сделать снимок"));
      await o.onShot(blob);
      if(opts!==o)return;
      const img=document.createElement("img");img.alt="";
      const url=URL.createObjectURL(blob);img.src=url;img.onload=()=>URL.revokeObjectURL(url);
      q(".camStrip").appendChild(img);
    }catch(err){if(opts===o)msg(err?.message||TX("Не удалось сделать снимок"));}
    finally{busy=false;}
    if(opts!==o)return;
    paint();
    if(o.count()>=o.max){
      msg(o.limitMsg||TX("Снято {0} из {0} — лимит фото на тег",o.max));
      closeTimer=setTimeout(close,900);
    }
  }

  function close(){
    clearTimeout(closeTimer);
    if(!view||view.hidden)return;
    if(stream){stream.getTracks().forEach(t=>{try{t.stop();}catch(_){}});stream=null;}
    q(".camVideo").srcObject=null;
    q(".camStrip").replaceChildren();
    view.hidden=true;document.body.classList.remove("camera-open");
    const done=opts&&opts.onClose;opts=null;
    if(done)try{done();}catch(_){}
  }

  window.TagCamera={supported,open,close,isOpen};
})();
