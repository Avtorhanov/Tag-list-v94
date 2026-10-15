/* Tag list v105 — формат тегов КИП.
   Один модуль для ручного ввода, «Вставить», файлов и фото: по выбранному формату
   находит теги в тексте, строит канонический вид и номер установки (вкладку).
   Форматы: auto — ISA-5.1, установка любая (по умолчанию); unit — ISA-5.1 только с установкой;
   bare — ISA-5.1 без установки; kks — KKS (электростанции); custom — по образцу пользователя.
   Выбор хранится на устройстве (localStorage, kip-tag-format-v1). */
(function(){
  "use strict";
  // v107: подписи — через TX (js/i18n.js). Причины отказа (reason) внутри модуля остаются русскими:
  // по ним выбирается подсказка (hint), на экран они идут через TX.
  const TX=(s,...a)=>typeof window!=="undefined"&&typeof window.TX==="function"?window.TX(s,...a):String(s).replace(/\{(\d+)\}/g,(m,i)=>a[i]!==undefined?String(a[i]):m);
  const isEn=()=>typeof window!=="undefined"&&!!window.I18N?.en;
  // Кириллические двойники → латиница (замена 1:1, индексы совпадают с исходным текстом).
  const LOOK={"А":"A","В":"B","Е":"E","К":"K","М":"M","Н":"H","О":"O","Р":"P","С":"C","Т":"T","Х":"X","У":"Y","І":"I",
              "а":"A","в":"B","е":"E","к":"K","м":"M","н":"H","о":"O","р":"P","с":"C","т":"T","х":"X","у":"Y","і":"I"};
  const DASH=/[–—−]/g;
  const norm=s=>{let o="";for(const c of String(s||"")){const l=LOOK[c];o+=l?l:(c>="a"&&c<="z"?c.toUpperCase():c);}return o;};
  const isCyr=c=>/[А-ЯЁа-яёІі]/.test(c||"");
  // Цифра, прочитанная как буква (фото, OCR) — только в позиции номера.
  const DIGFIX={O:"0",Q:"0",I:"1",L:"1",S:"5",Z:"2"};
  const fixDigits=s=>{let v="",n=0;const what=new Set();for(const c of s){if(/\d/.test(c))v+=c;else{v+=DIGFIX[c]||c;n++;what.add(TX("буква {0} → цифра {1}",c,DIGFIX[c]||c));}}return {v,fixed:n,what:[...what].join(", ")};};
  const digitsOk=s=>{const real=(s.match(/\d/g)||[]).length;return s.length>=2&&real>=Math.max(1,s.length-1);};

  // Не приборы: трубы, документы, стандарты и обычные слова.
  const SKIP={
    pipe:["DN","PN","NPS","NB","SCH","OD"],
    doc:["DWG","DOC","REV","NO","PO","WO","PR","RFI","NCR","ITP","SHT","SN"],
    std:["IP","EX","ATEX","IEC","ISO","DIN","GOST","API","ASME","ANSI","RS","USB","LED","AWG","SIL"],
    word:["AREA","LINE","ROOM","UNIT","ITEM","PAGE","LOOP","STEP","ZONE","SKID","TAG","PART","LOT","BOX","JB","MCC","BAY","CH","PIN"]
  };
  const skipReason=L=>SKIP.pipe.includes(L)?"размер или давление трубы":SKIP.doc.includes(L)?"номер документа":SKIP.std.includes(L)?"стандарт или маркировка":SKIP.word.includes(L)?"обычное слово":"";

  const SEP="[-–—−_ ]";
  // Широкий поиск: всё, что похоже на тег. Решение — по формату.
  // Начало тега не может быть серединой другого обозначения («P-101ADN-50» с фото — не «101-ADN-50»).
  const CAND=new RegExp(`(?<![A-Za-z0-9А-ЯЁа-яё])(?<![A-Za-z0-9][-–—−_])(?:(\\d{1,5})(${SEP})?)?([A-Z]{1,8})(${SEP})?([0-9OQILSZ]{1,6})([A-Z]{0,2})(?![A-Za-z0-9А-ЯЁа-яё])`,"g");
  const KKS=/(?<![A-Z0-9])(\d{1,2}) ?([A-Z]{3}) ?([0-9OQIL]{2}) ?([A-Z]{2}) ?([0-9OQIL]{3})(?![A-Z0-9])/g;

  const FORMATS={
    auto:{name:"ISA-5.1",btn:["ISA-5.1","ISA"],ex:"21-PT-1001 · PT-101",ph:"Например, 21-PT-1001 или PT-101"},
    unit:{name:"ISA-5.1, с установкой",btn:["ISA-5.1","ISA"],ex:"21-PT-1001",ph:"Например, 21-PT-1001"},
    bare:{name:"ISA-5.1, без установки",btn:["ISA-5.1","ISA"],ex:"PT-101",ph:"Например, PT-101"},
    kks:{name:"KKS",btn:["KKS","KKS"],ex:"10LBA10CP001",ph:"Например, 10LBA10CP001"},
    custom:{name:"свой образец",btn:["Свой","Свой"],ex:"",ph:""}
  };
  const MODES=Object.keys(FORMATS);

  /* Образец → правило. «21-PT-1001A» → [2 цифры = установка] [буквы] [4 цифры] [+буква]. */
  function fromExample(text){
    const samples=String(text||"").split(/[,;\n]+|\s{2,}/).map(s=>norm(s.trim()).replace(DASH,"-").replace(/\s+/g," ")).filter(Boolean).slice(0,3);
    if(!samples.length)return {ok:false,get error(){return TX("Впишите тег из своего списка");}};
    const rules=[];
    for(const s of samples){
      const parts=s.match(/\d+|[A-Z]+|[-_ ]+|[^A-Z0-9-_ ]+/g)||[];
      if(parts.some(p=>/[^A-Z0-9-_ ]/.test(p)))return {ok:false,get error(){return TX("В «{0}» лишние знаки: нужны буквы, цифры и дефис",s);}};
      if(!/[A-Z]/.test(s)||!/\d/.test(s))return {ok:false,get error(){return TX("В «{0}» должны быть и буквы, и цифры",s);}};
      let re="";const segs=[];
      parts.forEach((p,i)=>{
        const word=n=>n;
        if(/^\d+$/.test(p)){re+=`([0-9OQILSZ]{${p.length}})`;segs.push(i===0?{k:"unit",n:p.length,t:word(p.length)}:{k:"num",n:p.length,t:word(p.length)});}
        else if(/^[A-Z]+$/.test(p)){
          const last=i===parts.length-1&&i>0&&/^\d+$/.test(parts[i-1]);
          if(last&&p.length<=2)return;                          // буква-суффикс — по желанию
          if(p.length>=2){re+="([A-Z]{2,8})";segs.push({k:"fn"});}
          else{re+="([A-Z])";segs.push({k:"one",t:p});}
        }else{re+=`${SEP}?`;segs.push({k:"sep"});}
      });
      re+="([A-Z]{0,2})";
      rules.push({re:new RegExp(`(?<![A-Za-z0-9А-ЯЁа-яё])(?<![A-Za-z0-9][-–—−_])${re}(?![A-Za-z0-9А-ЯЁа-яё])`,"g"),src:s,segs,parts:parts.filter(p=>!/^[-_ ]+$/.test(p))});
    }
    return {ok:true,rules};
  }
  // Правило образца — одной фразой.
  function describe(custom){
    if(!custom||!custom.ok)return "";
    return custom.rules.map(r=>{
      const en=isEn(),p=[];r.segs.forEach(s=>{
        if(s.k==="unit")p.push(en?`${s.n} ${s.n===1?"digit":"digits"} — unit`:`${s.n} ${s.n===1?"цифра":s.n<5?"цифры":"цифр"} — установка`);
        else if(s.k==="fn")p.push(TX("буквы прибора"));
        else if(s.k==="one")p.push(TX("буква {0}",s.t));
        else if(s.k==="num")p.push(en?`${s.n}-digit number`:`номер из ${s.n} ${s.n===1?"цифры":"цифр"}`);
      });
      return p.join(", ");
    }).join("; ")+TX(". Буква в конце — по желанию.");
  }

  const canon=(unit,L,num,suf)=>(unit?unit+"-":"")+L+"-"+num+(suf||"");

  // Всё похожее на тег ISA-5.1, с причиной отказа для заведомых «не приборов».
  function candidates(N,src){
    const out=[];CAND.lastIndex=0;let m;
    while((m=CAND.exec(N))){
      let a=m.index;const b=a+m[0].length;let [,unit,s1,L,s2,num,suf]=m;
      // «12 PT-101»: короткое число через пробел — номер строки, а не установка.
      if(unit&&s1&&/\s/.test(s1)&&unit.length<3){a+=unit.length+s1.length;unit="";s1="";}
      const la=a+(unit?unit.length+(s1||"").length:0),orig=src.slice(la,la+L.length);
      let cyr=false;for(const c of orig)if(isCyr(c)){cyr=true;break;}
      if(cyr&&(s2===" "||!s2&&L.length>2&&!unit))continue;       // русское слово: «смену 15», «СТО 123»
      if(!digitsOk(num))continue;
      let reason="";
      if(L.length===1)reason="оборудование или крепёж: одна буква";
      else if(skipReason(L))reason=skipReason(L);
      else if(/[a-z]/.test(orig)&&/[A-Z]/.test(orig))reason="не тег: строчные буквы";   // Pt100, Ex
      else if(L==="PT"&&!s2&&/^(100|500|1000)$/.test(num)&&!unit)reason="термосопротивление Pt100";
      else if(s2===" "&&num.replace(/\D/g,"").length<3&&!unit)reason="обычное слово";
      out.push({a,b,unit:unit||"",L,num,suf:suf||"",show:src.slice(a,b),reason});
    }
    return out;
  }

  /* Главная функция: найденные теги и отброшенные кандидаты с причиной.
     Элемент: {start,end,tag,unit,fixes[]} / {start,end,text,reason}. */
  function scan(text,mode="auto",custom=null){
    const src=String(text||""),N=norm(src),found=[],skipped=[],taken=new Uint8Array(N.length+1);
    const mark=(a,b)=>{for(let i=a;i<b;i++)taken[i]=1;};
    const free=(a,b)=>{for(let i=a;i<b;i++)if(taken[i])return false;return true;};
    const cyrIn=(a,b)=>{for(let i=a;i<b;i++)if(isCyr(src[i]))return true;return false;};
    if(!MODES.includes(mode))mode="auto";
    // KKS — первым: строка KKS не должна разобраться как обычный тег.
    KKS.lastIndex=0;let k;
    while((k=KKS.exec(N))){
      const a=k.index,b=a+k[0].length;
      if(mode!=="kks"){skipped.push({start:a,end:b,text:src.slice(a,b),reason:"код KKS"});mark(a,b);continue;}
      const f1=fixDigits(k[3]),f2=fixDigits(k[5]),fixes=[];
      if(f1.fixed||f2.fixed)fixes.push(TX("в номере {0}",[f1.what,f2.what].filter(Boolean).join(", ")));
      if(cyrIn(a,b))fixes.push(TX("кириллица → латиница"));
      mark(a,b);found.push({start:a,end:b,tag:`${k[1]}${k[2]}${f1.v}${k[4]}${f2.v}`,unit:`${k[1]}${k[2]}`,fixes});
    }
    if(mode==="custom"){
      if(!custom||!custom.ok)return {found,skipped,error:custom?custom.error:TX("Впишите тег из своего списка")};
      for(const r of custom.rules){
        r.re.lastIndex=0;let m;
        while((m=r.re.exec(N))){
          const a=m.index,b=a+m[0].length;if(!free(a,b))continue;
          let ok=true,out="",unit="",gi=1;const fixes=[];
          r.parts.forEach((p,i)=>{
            if(!ok)return;
            const last=i===r.parts.length-1&&i>0&&/^\d+$/.test(r.parts[i-1]);
            if(/^\d+$/.test(p)){const g=m[gi++];if(!digitsOk(g)&&g.length>1){ok=false;return;}const f=fixDigits(g);if(f.fixed)fixes.push(TX("в номере {0}",f.what));out+=(out?"-":"")+f.v;if(i===0)unit=f.v;}
            else if(/^[A-Z]+$/.test(p)){if(last&&p.length<=2)return;out+=(out?"-":"")+m[gi++];}
          });
          if(!ok)continue;
          out+=m[gi]||"";
          if(cyrIn(a,b))fixes.push(TX("кириллица → латиница"));
          mark(a,b);found.push({start:a,end:b,tag:out,unit,fixes});
        }
      }
      for(const c of candidates(N,src))if(free(c.a,c.b))skipped.push({start:c.a,end:c.b,text:c.show,reason:c.reason||"не по образцу"});
    }else if(mode==="kks"){
      for(const c of candidates(N,src))if(free(c.a,c.b))skipped.push({start:c.a,end:c.b,text:c.show,reason:c.reason||"не KKS"});
    }else{
      for(const c of candidates(N,src)){
        if(!free(c.a,c.b))continue;
        let reason=c.reason;
        if(!reason&&mode==="unit"&&!c.unit)reason="нет номера установки";
        if(!reason&&mode==="bare"&&c.unit)reason="есть номер установки";
        mark(c.a,c.b);
        if(reason){skipped.push({start:c.a,end:c.b,text:c.show,reason});continue;}
        const f=fixDigits(c.num),fixes=[];
        if(f.fixed)fixes.push(TX("в номере {0}",f.what));
        if(cyrIn(c.a,c.b))fixes.push(TX("кириллица → латиница"));
        found.push({start:c.a,end:c.b,tag:canon(c.unit,c.L,f.v,c.suf),unit:c.unit,fixes});
      }
    }
    found.sort((x,y)=>x.start-y.start);skipped.sort((x,y)=>x.start-y.start);
    return {found,skipped};
  }

  // Одно значение (ручной ввод): всё поле — ровно один тег.
  function single(value,mode,custom){
    const v=String(value||"").trim();
    if(!v)return null;
    const r=scan(v,mode,custom);
    if(r.error)return {ok:false,reason:r.error};
    const t=r.found[0];
    if(t&&t.start===0&&t.end===v.length&&r.found.length===1)return {ok:true,...t};
    const s=r.skipped.find(x=>x.start===0&&x.end===v.length);
    return {ok:false,reason:s?s.reason:"не похоже на тег"};
  }

  // Подсказка, если формат отбросил похожие на теги: какой включить.
  function hint(res,mode){
    const r=(res&&res.skipped||[]).map(s=>s.reason);
    if(r.includes("код KKS")&&mode!=="kks")return {to:"kks",text:TX("Это KKS"),btn:TX("Включить KKS")};
    if(r.includes("есть номер установки"))return {to:"auto",text:TX("Здесь теги с установкой"),btn:TX("Установка: любая")};
    if(r.includes("нет номера установки"))return {to:"auto",text:TX("Здесь есть теги без установки"),btn:TX("Установка: любая")};
    if(r.some(x=>x==="не по образцу"||x==="не KKS")&&!(res.found||[]).length)return {to:"auto",text:TX("Здесь другой формат"),btn:TX("Включить ISA-5.1")};
    return null;
  }

  /* ---------- выбранный формат: хранится на устройстве ---------- */
  const KEY="kip-tag-format-v1";
  const st={mode:"auto",isaLast:"auto",example:"",check:false,sample:"me",own:""};
  try{const raw=JSON.parse(localStorage.getItem(KEY)||"null");if(raw&&typeof raw==="object")Object.assign(st,raw);}catch(_){}
  if(!MODES.includes(st.mode))st.mode="auto";
  if(!["auto","unit","bare"].includes(st.isaLast))st.isaLast="auto";
  let custom=fromExample(st.example);
  const listeners=new Set();
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(st));}catch(_){}}
  function setMode(m){
    if(!MODES.includes(m))return;
    st.mode=m;if(["auto","unit","bare"].includes(m))st.isaLast=m;
    persist();listeners.forEach(fn=>{try{fn(st.mode);}catch(_){}});
  }
  function setExample(text){st.example=String(text||"");custom=fromExample(st.example);persist();listeners.forEach(fn=>{try{fn(st.mode);}catch(_){}});}

  const api={
    FORMATS,MODES,norm,scan,single,fromExample,describe,hint,
    get mode(){return st.mode;},
    get state(){return st;},
    get custom(){return custom;},
    setMode,setExample,
    setPref(k,v){st[k]=v;persist();},
    onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    name(m=st.mode){return TX(FORMATS[m].name);},
    button(m=st.mode){return (m==="custom"&&custom.ok?["Свой","Свой"]:FORMATS[m].btn).map(x=>TX(x));},
    placeholder(){return st.mode==="custom"?(custom.ok?TX("Например, {0}",custom.rules[0].src):TX("Сначала впишите образец")):TX(FORMATS[st.mode].ph);},
    // В выбранном формате.
    find(text){return scan(text,st.mode,custom).found;},
    scanNow(text){return scan(text,st.mode,custom);},
    check(value){return single(value,st.mode,custom);},
    canonical(value){const r=single(value,st.mode,custom);return r&&r.ok?r.tag:null;},
    // Правка готового тега: подходит выбранный формат или любой известный.
    anyValid(value){
      for(const [m,c] of [[st.mode,custom],["auto",null],["kks",null]]){const r=single(value,m,c);if(r&&r.ok)return r;}
      return single(value,st.mode,custom);
    },
    // Номер установки (вкладка) по тегу — независимо от выбранного формата.
    unitOf(tag){
      const v=String(tag||"").trim();if(!v)return "";
      const k=single(v,"kks");if(k&&k.ok)return k.unit;
      const r=single(v,"auto");if(r&&r.ok)return r.unit;
      const m=norm(v).match(/^(\d{1,5})[-–—_ ]/);return m?m[1]:"";
    }
  };
  // Примеры для «Проверить на тексте» (условные, не данные объекта).
  api.SAMPLES=[
    {id:"ru",name:"Наш формат",text:"Перечень на смену 15.10\n1. 2131-PZT-414A — проверка контура\n2. 2131-TT-434 калибровка 0…400 °C\n3. 2140-FT-118 ✓\n4. 2140-LSHH-208B проверка уставки\n5. 2150-РDТ-302 продувка импульсных линий\nНасос P-2101A — не КИП\nТрубопровод DN-50, PN-16"},
    {id:"me",name:"Ближний Восток",text:"LOOP CHECK STATUS — AREA 21\n21-PT-1001   Loop check OK\n21-FT-1002A  Calibration pending\n21-LIT-1105  Re-test after repair\n22-TT-2010   OK\n22-PDT-2O14  Impulse line flushing\n22-XV-2051   Stroke test\nV-2101 vessel, see DWG-21-0001 rev 2"},
    {id:"us",name:"США · скид",text:"SKID 100 — INSTRUMENT INDEX\nPT-101   Pump discharge pressure\nPT-102   Suction pressure\nFT101A   Flow, magmeter\nTE-105 / TT-105   Bearing temperature, Pt100\nLSL-110  Low level switch\nP-101A pump, M-20 bolts, 2\" 150#"},
    {id:"kks",name:"KKS",get text(){return isEn()
      ?"I&C check sheet, unit 1\n10LBA10CP001  steam pressure\n10LBA10CT002  steam temperature\n10LAB20CF001  feedwater flow\n20HAD11CL001  drum level\n10 LBA 30 CP 003  sensor replaced"
      :"Контрольный лист КИП, блок 1\n10LBA10CP001  давление пара\n10LBA10CT002  температура пара\n10LAB20CF001  расход питательной воды\n20HAD11CL001  уровень в барабане\n10 LBA 30 CP 003  датчик заменён";}}
  ];
  window.TagFormat=api;
  if(typeof module!=="undefined")module.exports=api;
})();
