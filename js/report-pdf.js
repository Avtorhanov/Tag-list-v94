/* Tag list v114 — отчёт с фото одним PDF-файлом (без библиотек и без интернета).
   Страницы отчёта: текст отчёта (как в окне «Отчёт», с ручными правками), под строкой тега —
   миниатюры его фото. Нажатие на миниатюру открывает страницу с фото целиком (ссылка внутри PDF),
   там «← К отчёту» возвращает к тегу. Фото вставляются в PDF без пересжатия (JPEG как есть),
   поэтому в просмотрщике их можно увеличивать.
   Текст рисуется на холсте и вставляется картинкой: так кириллица и эмодзи выглядят одинаково
   в любом просмотрщике без встраивания шрифтов. */
(function(){
  "use strict";
  const PW=595.28,PH=841.89;          // A4, пункты
  const M=40,S=2.5;                    // поля, пикселей холста на пункт
  const FONT='-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
  const TW=92,TH=69,TG=6;              // миниатюра и промежуток
  const HEAD=46;                       // шапка страницы с фото
  const C={text:"#111827",muted:"#6b7280",line:"#d1d5db",accent:"#1d4ed8",dark:"#0b1220",pill:"#1e293b"};
  const enc=new TextEncoder();

  async function decode(blob){
    if(window.createImageBitmap){try{return await createImageBitmap(blob);}catch(_){}}
    return await new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(blob),img=new Image();
      img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("decode"));};
      img.src=url;
    });
  }
  const dims=b=>({w:b.width||b.naturalWidth,h:b.height||b.naturalHeight});
  const toJpeg=(canvas,q)=>new Promise(r=>canvas.toBlob(r,"image/jpeg",q)).then(b=>b.arrayBuffer()).then(a=>new Uint8Array(a));

  function roundRect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
  }
  function newCanvas(wPt,hPt,bg){
    const c=document.createElement("canvas");
    c.width=Math.round(wPt*S);c.height=Math.round(hPt*S);
    const ctx=c.getContext("2d");
    ctx.setTransform(S,0,0,S,0,0);
    ctx.fillStyle=bg;ctx.fillRect(0,0,wPt,hPt);
    ctx.textBaseline="alphabetic";
    return {c,ctx};
  }

  // Вид строки отчёта → куски текста со своим шрифтом.
  function styleLine(t,first){
    const f=(size,weight,color)=>({font:`${weight} ${size}px ${FONT}`,size,color});
    if(first)return {runs:[{t,...f(16,700,C.text)}],size:16,gapBefore:0};
    if(/^(✅|⏳)/.test(t))return {runs:[{t,...f(13,700,C.text)}],size:13,gapBefore:4};
    if(/^▸\s/.test(t))return {runs:[{t,...f(11,700,C.muted)}],size:11,gapBefore:2};
    const m=t.match(/^(\d+\.\s+)(\S+)(.*)$/);
    if(m)return {runs:[{t:m[1],...f(11,500,C.muted)},{t:m[2],...f(11,700,C.text)},{t:m[3],...f(11,400,C.text)}],size:11,gapBefore:0,num:true};
    return {runs:[{t,...f(11,400,C.text)}],size:11,gapBefore:0};
  }
  // Перенос по словам; продолжение строки тега — с отступом под номером.
  function wrap(ctx,style,maxW){
    const lines=[[]];let x=0,indent=0;
    if(style.num){ctx.font=style.runs[0].font;indent=ctx.measureText(style.runs[0].t).width;}
    for(const run of style.runs){
      ctx.font=run.font;
      for(const word of run.t.match(/\s*\S+\s*|\s+/g)||[]){
        let w=ctx.measureText(word).width;
        if(x+w>maxW&&x>indent+0.5){lines.push([]);x=indent;if(!word.trim())continue;}
        let piece=x===indent&&lines.length>1?word.replace(/^\s+/,""):word;
        w=ctx.measureText(piece).width;
        while(w>maxW-x&&piece.length>1){ // слово длиннее строки — режем по буквам
          let k=piece.length-1;
          while(k>1&&ctx.measureText(piece.slice(0,k)).width>maxW-x)k--;
          lines[lines.length-1].push({...run,t:piece.slice(0,k),x});
          lines.push([]);x=indent;piece=piece.slice(k);w=ctx.measureText(piece).width;
        }
        lines[lines.length-1].push({...run,t:piece,x});x+=w;
      }
    }
    return {lines,indent};
  }

  async function build(o){
    const getBlob=o.getBlob,cache=new Map();
    async function bitmap(id){
      if(!cache.has(id)){
        const blob=await getBlob(id);
        cache.set(id,blob?{blob,bmp:await decode(blob).catch(()=>null)}:null);
      }
      return cache.get(id);
    }
    // ---------- страницы отчёта
    const pages=[],photos=[];
    let cur=null,y=0;
    const bottom=PH-M-14;
    async function flush(){
      if(!cur)return;
      cur.ctx.font=`400 8.5px ${FONT}`;cur.ctx.fillStyle=C.muted;
      cur.ctx.fillText(`${o.footer||""}${o.footer?" · ":""}${pages.length+1}`,M,PH-M+14);
      cur.jpeg=await toJpeg(cur.c,0.9);cur.c.width=cur.c.height=0;delete cur.c;delete cur.ctx;
      pages.push(cur);cur=null;
    }
    async function page(){await flush();const p=newCanvas(PW,PH,"#ffffff");cur={kind:"report",ctx:p.ctx,c:p.c,links:[],w:PW,h:PH};y=M;}
    await page();
    const maxW=PW-2*M;
    for(let i=0;i<o.lines.length;i++){
      const L=o.lines[i],t=L.t;
      if(!t.trim()){y+=7;continue;}
      const st=styleLine(t,i===0),lh=st.size*1.38;
      const {lines,indent}=wrap(cur.ctx,st,maxW);
      const ids=(L.photos||[]).slice();
      const need=st.gapBefore+lines.length*lh+(ids.length?TH+10:0);
      if(y+need>bottom&&y>M)await page();
      y+=st.gapBefore;
      for(const ln of lines){
        y+=lh;
        for(const r of ln){cur.ctx.font=r.font;cur.ctx.fillStyle=r.color;cur.ctx.fillText(r.t,M+r.x,y-lh*0.27);}
      }
      if(ids.length){
        y+=4;
        let x=M+indent;
        const tag=(t.match(/^\d+\.\s+(\S+)/)||[])[1]||t;
        for(let k=0;k<ids.length;k++){
          const ph=await bitmap(ids[k]);
          if(!ph||!ph.bmp)continue;
          if(x+TW>PW-M){x=M+indent;y+=TH+TG;if(y+TH>bottom)await page();}
          const ctx=cur.ctx,{w,h}=dims(ph.bmp),k0=Math.max(TW/w,TH/h),sw=TW/k0,sh=TH/k0;
          ctx.save();roundRect(ctx,x,y,TW,TH,5);ctx.clip();
          ctx.drawImage(ph.bmp,(w-sw)/2,(h-sh)/2,sw,sh,x,y,TW,TH);
          ctx.restore();
          ctx.lineWidth=0.7;ctx.strokeStyle=C.line;roundRect(ctx,x+0.35,y+0.35,TW-0.7,TH-0.7,5);ctx.stroke();
          // значок «увеличить» в углу
          ctx.fillStyle="rgba(15,23,42,.62)";roundRect(ctx,x+TW-17,y+TH-17,13,13,3);ctx.fill();
          ctx.strokeStyle="#fff";ctx.lineWidth=1.1;ctx.beginPath();
          ctx.moveTo(x+TW-12.5,y+TH-13.5);ctx.lineTo(x+TW-7.5,y+TH-13.5);ctx.lineTo(x+TW-7.5,y+TH-8.5);
          ctx.moveTo(x+TW-7.5,y+TH-13.5);ctx.lineTo(x+TW-13.5,y+TH-7.5);ctx.stroke();
          const index=photos.length;
          photos.push({id:ids[k],tag,n:k+1,of:ids.length,ph,srcPage:pages.length,srcTop:PH-y+lh*lines.length+12});
          cur.links.push({rect:[x,PH-(y+TH),x+TW,PH-y],photo:index});
          x+=TW+TG;
        }
        y+=TH+6;
      }
    }
    await flush();
    // ---------- страницы с фото: размер страницы по пропорциям фото, шапка с «← К отчёту»
    for(let pi=0;pi<photos.length;pi++){
      const p=photos[pi];
      const {w,h}=dims(p.ph.bmp),imgW=PW-24,imgH=Math.max(120,imgW*h/w),ph=HEAD+imgH+12;
      const head=newCanvas(PW,HEAD,C.dark),ctx=head.ctx;
      ctx.fillStyle=C.pill;roundRect(ctx,10,9,112,28,8);ctx.fill();
      ctx.fillStyle="#93c5fd";ctx.font=`700 12px ${FONT}`;ctx.fillText(o.backLabel||"← Back",22,27.5);
      ctx.fillStyle="#e5e7eb";ctx.font=`700 12.5px ${FONT}`;ctx.textAlign="right";
      ctx.fillText(`${p.tag} · ${p.n}/${p.of}`,PW-14,27.5);
      const headJpeg=await toJpeg(head.c,0.9);head.c.width=head.c.height=0;
      const photoBytes=new Uint8Array(await p.ph.blob.arrayBuffer());
      pages.push({kind:"photo",photoIndex:pi,w:PW,h:ph,head:headJpeg,photo:photoBytes,pw:w,phh:h,imgW,imgH,
        links:[{rect:[10,ph-37,122,ph-9],back:p.srcPage,top:Math.min(PH,p.srcTop+24)}]});
    }
    cache.forEach(v=>{if(v&&v.bmp&&v.bmp.close)v.bmp.close();});
    return write(pages,o.title||"Report");
  }

  // ---------- запись PDF 1.4
  function write(pages,title){
    const parts=[];let len=0;const off=[];
    const push=x=>{const b=typeof x==="string"?enc.encode(x):x;parts.push(b);len+=b.length;};
    const obj=(n,dict,stream)=>{
      off[n]=len;push(`${n} 0 obj\n`);
      if(stream){push(dict);push("\nstream\n");push(stream);push("\nendstream\nendobj\n");}
      else push(dict+"\nendobj\n");
    };
    const f=v=>(Math.round(v*100)/100).toString();
    const hexText=s=>{let h="FEFF";for(let i=0;i<s.length;i++)h+=s.charCodeAt(i).toString(16).padStart(4,"0").toUpperCase();return `<${h}>`;};
    push(new Uint8Array([0x25,0x50,0x44,0x46,0x2D,0x31,0x2E,0x34,0x0A,0x25,0xE2,0xE3,0xCF,0xD3,0x0A]));
    let n=4;
    pages.forEach(p=>{p.num=n++;p.content=n++;p.imgs=p.kind==="report"?[n++]:[n++,n++];p.annots=p.links.map(()=>n++);});
    const total=n-1;
    obj(1,"<< /Type /Catalog /Pages 2 0 R >>");
    obj(2,`<< /Type /Pages /Kids [${pages.map(p=>p.num+" 0 R").join(" ")}] /Count ${pages.length} >>`);
    const d=new Date(),z=x=>String(x).padStart(2,"0");
    obj(3,`<< /Title ${hexText(title)} /Producer (Tag list) /CreationDate (D:${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}) >>`);
    const img=(num,bytes,w,h)=>obj(num,`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`,bytes);
    pages.forEach(p=>{
      let content,xo;
      if(p.kind==="report"){
        content=`q ${f(p.w)} 0 0 ${f(p.h)} 0 0 cm /Im0 Do Q`;
        xo=`/Im0 ${p.imgs[0]} 0 R`;
      }else{
        const ix=(p.w-p.imgW)/2,iy=6;
        content=`0.043 0.071 0.125 rg 0 0 ${f(p.w)} ${f(p.h)} re f q ${f(p.w)} 0 0 ${HEAD} 0 ${f(p.h-HEAD)} cm /Im0 Do Q q ${f(p.imgW)} 0 0 ${f(p.imgH)} ${f(ix)} ${f(iy)} cm /Im1 Do Q`;
        xo=`/Im0 ${p.imgs[0]} 0 R /Im1 ${p.imgs[1]} 0 R`;
      }
      const annots=p.annots.length?` /Annots [${p.annots.map(a=>a+" 0 R").join(" ")}]`:"";
      obj(p.num,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(p.w)} ${f(p.h)}] /Resources << /XObject << ${xo} >> >> /Contents ${p.content} 0 R${annots} >>`);
      const cs=enc.encode(content);
      obj(p.content,`<< /Length ${cs.length} >>`,cs);
      if(p.kind==="report")img(p.imgs[0],p.jpeg,Math.round(p.w*S),Math.round(p.h*S));
      else{img(p.imgs[0],p.head,Math.round(p.w*S),Math.round(HEAD*S));img(p.imgs[1],p.photo,p.pw,p.phh);}
      p.links.forEach((l,i)=>{
        const dest=l.photo!==undefined
          ?`[${pages.find(q=>q.kind==="photo"&&q.photoIndex===l.photo).num} 0 R /Fit]`
          :`[${pages[l.back].num} 0 R /XYZ null ${f(l.top)} null]`;
        obj(p.annots[i],`<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(f).join(" ")}] /Border [0 0 0] /Dest ${dest} >>`);
      });
    });
    const xref=len;
    push(`xref\n0 ${total+1}\n0000000000 65535 f \n`);
    for(let i=1;i<=total;i++)push(String(off[i]).padStart(10,"0")+" 00000 n \n");
    push(`trailer\n<< /Size ${total+1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts,{type:"application/pdf"});
  }

  window.ReportPdf={build};
})();
