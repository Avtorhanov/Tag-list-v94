/* Tag list v105 — формат тегов КИП.
   Один модуль для ручного ввода, «Вставить», файлов и фото: по выбранному формату
   находит теги в тексте, строит канонический вид и номер установки (вкладку).
   Форматы: auto — ISA-5.1, установка любая (по умолчанию); unit — ISA-5.1 только с установкой;
   bare — ISA-5.1 без установки; kks — KKS (электростанции); custom — по образцу пользователя.
   Выбор хранится на устройстве (localStorage, kip-tag-format-v1).
   v125: список не обязан быть перечнем КИП. Добавлены: preset — готовые наборы для других работ
   (номера, код-номер, артикул, документ №, телефон, e-mail, госномер, IP-адрес); free — любой текст,
   каждая строка — пункт; «свой вариант» (custom) принимает любой образец: одни цифры, буквы и цифры
   с любыми знаками, кириллицу, а образец без цифр означает «любая строка». */
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
  // v125: верхний регистр без перевода кириллицы в латиницу (индексы совпадают с исходным текстом).
  const up=s=>{let o="";for(const c of String(s||"")){const u=c.toUpperCase();o+=u.length===c.length?u:c;}return o;};
  const LT="A-ZА-ЯЁ";                                       // буква: латиница или кириллица
  const REV={A:"А",B:"В",E:"Е",K:"К",M:"М",H:"Н",O:"О",P:"Р",C:"С",T:"Т",X:"Х",Y:"У"};
  // В одном обозначении буквы одного алфавита: «INV» с русской «В» → латиница, «СЧ» с латинской «C» → кириллица.
  const unify=s=>{
    if(!/[A-Z]/.test(s)||!/[А-ЯЁ]/.test(s))return s;
    let cyrOnly=false,latOnly=false;
    for(const c of s){if(/[А-ЯЁ]/.test(c)&&!LOOK[c])cyrOnly=true;if(/[A-Z]/.test(c)&&!REV[c])latOnly=true;}
    if(!cyrOnly)return s.replace(/[А-ЯЁ]/g,c=>LOOK[c]||c);
    if(!latOnly)return s.replace(/[A-Z]/g,c=>REV[c]||c);
    return s;
  };
  const esc=c=>c.replace(/[.*+?^${}()|[\]\\\/]/g,"\\$&");

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
  const CAND=new RegExp(`(?<![A-Za-z0-9А-ЯЁа-яё])(?<![A-Za-z0-9][-–—−_])(?:(\\d{1,5})(${SEP})?)?([A-Z]{1,8})(${SEP})?([0-9OQILSZ]{1,6})([A-Z]{1,2}\\d|[A-Z]{0,2})(?![A-Za-z0-9А-ЯЁа-яё])`,"g"); // v119: суффикс «B1», «A2» — буква и цифра (2109-PG-448B1)
  const KKS=/(?<![A-Z0-9])(\d{1,2}) ?([A-Z]{3}) ?([0-9OQIL]{2}) ?([A-Z]{2}) ?([0-9OQIL]{3})(?![A-Z0-9])/g;

  const FORMATS={
    auto:{name:"ISA-5.1",btn:["ISA-5.1","ISA"],ex:"21-PT-1001 · PT-101",ph:"Например, 21-PT-1001 или PT-101"},
    unit:{name:"ISA-5.1, с установкой",btn:["ISA-5.1","ISA"],ex:"21-PT-1001",ph:"Например, 21-PT-1001"},
    bare:{name:"ISA-5.1, без установки",btn:["ISA-5.1","ISA"],ex:"PT-101",ph:"Например, PT-101"},
    kks:{name:"KKS",btn:["KKS","KKS"],ex:"10LBA10CP001",ph:"Например, 10LBA10CP001"},
    custom:{name:"свой вариант",btn:["Свой","Свой"],ex:"",ph:""},
    preset:{name:"готовый набор",btn:["Набор","Набор"],ex:"",ph:""},                       // v125
    free:{name:"любой текст",btn:["Текст","Текст"],ex:"каждая строка — пункт",ph:"Например: проверить журнал"}   // v125
  };
  const MODES=Object.keys(FORMATS);

  /* ---------- v125: готовые наборы — списки не из КИП ----------
     Набор: find(src) → [{start,end,tag,fixes?}] — что взять из текста; one(value) → tag|"" — ручной ввод одной строки
     (мягче: «123/45-А» без знака № — тоже документ). Установки (вкладки) у наборов нет.
     caps / kbd — подсказки клавиатуре телефона для поля ввода. */
  const B0=`(?<![${LT}0-9])`,B1=`(?![${LT}0-9])`;
  function reFind(src,text,re,make){
    const out=[];re.lastIndex=0;let m;
    while((m=re.exec(text))){
      if(!m[0]){re.lastIndex++;continue;}
      const r=make(m,src.slice(m.index,m.index+m[0].length));
      if(r)out.push({start:m.index,end:m.index+m[0].length,tag:typeof r==="string"?r:r.tag,fixes:r.fixes||[]});
    }
    return out;
  }
  const whole=(p,v)=>{const f=p.find(v);return f.length===1&&f[0].start===0&&f[0].end===v.length?f[0].tag:"";};
  const ruPhone=d=>`+7 ${d.slice(1,4)} ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9,11)}`;
  const PRESETS=[
    {id:"num",name:"Номера",btn:"Номер",ex:"000123 · 4512",ph:"Например, 000123",kbd:"numeric",caps:"none",
     desc:"Только цифры, от 3 до 14 подряд: инвентарные и складские номера, счета, заявки, штрихкоды. Даты и числа с запятой не берутся.",
     find(src){return reFind(src,up(src),new RegExp(`${B0}(?<![${LT}0-9][-–—−_/.,:])\\d{3,14}${B1}(?![-–—−_/.,:][${LT}0-9])(?!\\)\\s?\\d)`,"g"),m=>m[0]);},
     one(v){return /^\d{1,20}$/.test(v)?v:"";}},
    {id:"code",name:"Код-номер",btn:"Код",ex:"INV-0042 · СЧ-118",ph:"Например, INV-0042",caps:"characters",
     desc:"Буквы и номер: инвентарные коды, заявки, задачи, счета — INV-0042, PRJ-1024, СЧ-118, ЗК-2024/15. Буквы латинские или русские.",
     find(src){return reFind(src,up(src),new RegExp(`${B0}(?<![${LT}0-9][-–—−_/])[${LT}]{1,10}[-–—−_/]?\\d{1,10}(?:[-–—−/]\\d{1,10}){0,3}[${LT}]{0,2}${B1}(?![-–—−_/][${LT}0-9])`,"g"),
       m=>unify(m[0].replace(DASH,"-")));}},
    {id:"sku",name:"Артикул · серийный №",btn:"Артикул",ex:"AB12-34CD · X7K9Q2M4",ph:"Например, AB12-34CD",caps:"characters",
     desc:"Любая смесь букв и цифр от 4 знаков, можно с дефисом, точкой или «/»: артикулы, серийные и заводские номера, VIN, партии.",
     find(src){return reFind(src,up(src),new RegExp(`${B0}[${LT}0-9]+(?:[-–—−./][${LT}0-9]+)*${B1}`,"g"),
       m=>{const t=m[0].replace(DASH,"-");return t.length>=4&&t.length<=32&&/\d/.test(t)&&new RegExp(`[${LT}]`).test(t)?unify(t):"";});}},
    {id:"doc",name:"Документ №",btn:"Док. №",ex:"№ 123/45-А",ph:"Например, 123/45-А",caps:"characters",
     desc:"Номер после знака №: договоры, счета, приказы, письма, накладные — № 123/45-А, №01-12/345. При вводе вручную знак № ставится сам.",
     find(src){return reFind(src,up(src),new RegExp(`№\\s{0,2}([${LT}0-9](?:[${LT}0-9/.–—−-]{0,22}[${LT}0-9])?)`,"g"),m=>"№"+m[1].replace(DASH,"-"));},
     one(v){const t=up(v).replace(DASH,"-").replace(/^(?:№|N[O°º]?\.?)\s*/,"").replace(/\s+/g," ");return new RegExp(`^[${LT}0-9](?:[${LT}0-9/. -]{0,28}[${LT}0-9])?$`).test(t)?"№"+t:"";}},
    {id:"phone",name:"Телефон",btn:"Тел.",ex:"+7 912 345-67-89",ph:"Например, +7 912 345-67-89",kbd:"tel",caps:"none",
     desc:"Номера телефонов: обзвон, контакты подрядчиков, заявки. Российские номера приводятся к виду +7 912 345-67-89.",
     find(src){
       const a=reFind(src,src,/(?<![\d+])(?:\+7|[78])[\s(-]{0,3}\d{3}[\s)-]{0,3}\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g,m=>ruPhone("7"+m[0].replace(/\D/g,"").slice(1)));
       const b=reFind(src,src,/(?<![\d+])\+\d{1,3}[\s(-]{0,2}\d{1,4}(?:[\s)-]{0,2}\d{2,4}){1,4}(?!\d)/g,m=>{const d=m[0].replace(/\D/g,"");return d.length>=9&&d.length<=15?"+"+d:"";});
       return a.concat(b.filter(x=>!a.some(y=>x.start<y.end&&y.start<x.end))).sort((x,y)=>x.start-y.start);},
     one(v){const w=whole(this,v);if(w)return w;const d=v.replace(/\D/g,"");return /^[\d\s()+-]+$/.test(v)&&d.length>=5&&d.length<=15?(d.length===10&&d[0]==="9"?ruPhone("7"+d):v.replace(/\s+/g," ")):"";}},
    {id:"mail",name:"E-mail",btn:"E-mail",ex:"ivanov@example.com",ph:"Например, ivanov@example.com",kbd:"email",caps:"none",
     desc:"Адреса электронной почты: рассылки, списки контактов, доступы.",
     find(src){return reFind(src,src,/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?![A-Za-z0-9-])/g,m=>m[0].replace(/\.+$/,"").toLowerCase());}},
    {id:"plate",name:"Госномер",btn:"Гос. №",ex:"А123ВС77",ph:"Например, А123ВС77",caps:"characters",
     desc:"Номера автомобилей РФ: пропуска, путевые листы, стоянка — А123ВС77, А 123 ВС 777. Латинские буквы переводятся в русские.",
     find(src){return reFind(src,norm(src),/(?<![A-ZА-ЯЁа-яё0-9])[ABEKMHOPCTXY] ?\d{3} ?[ABEKMHOPCTXY]{2} ?\d{2,3}(?![A-ZА-ЯЁа-яё0-9])/g,
       (m,raw)=>({tag:m[0].replace(/ /g,"").replace(/[A-Z]/g,c=>REV[c]||c),fixes:/[A-Za-z]/.test(raw)?[TX("латиница → кириллица")]:[]}));}},
    {id:"ip",name:"IP-адрес",btn:"IP",ex:"192.168.1.40",ph:"Например, 192.168.1.40",kbd:"decimal",caps:"none",
     desc:"Адреса устройств в сети: камеры, контроллеры, принтеры, серверы.",
     find(src){return reFind(src,src,/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?!\d)(?!\.\d)/g,m=>m[0].split(".").every(o=>+o<=255)?m[0].split(".").map(o=>String(+o)).join("."):"");}}
  ];
  const presetById=id=>PRESETS.find(p=>p.id===id)||PRESETS[0];

  /* ---------- v125: любой текст — каждая строка становится пунктом списка ----------
     Номер строки и маркер списка («1.», «—», «•», «[ ]») в пункт не попадают; «✓» и «[x]» — отметка «выполнено».
     В таблице (TSV из Excel) пункт — первая непустая ячейка, остальные ячейки — задание. Регистр букв сохраняется. */
  const LINE_MAX=160;
  function freeLines(src,taken){
    const out=[];let pos=0;
    for(const line of src.split("\n")){
      const a0=pos;pos+=line.length+1;
      if(taken){let busy=false;for(let i=a0;i<a0+line.length;i++)if(taken[i]){busy=true;break;}if(busy)continue;}
      const lead=line.match(/^[\s|]*(?:(?:\d{1,4}[.)]|[-–—−•·*▪◦►>]+|\[[ xXхХvV✓✔+]?\]|[☐☑☒✓✔])[\s|]*)*/)[0];
      let a=lead.length,b=line.length;
      const tab=line.indexOf("\t",a);if(tab>=0)b=tab;
      while(b>a&&/[\s|;,✓✔☑]/.test(line[b-1]))b--;
      if(b-a>LINE_MAX)b=a+LINE_MAX;
      const tag=line.slice(a,b).replace(/\s+/g," ").trim();
      if(!tag||!/[\p{L}\p{N}]/u.test(tag))continue;
      out.push({start:a0+a,end:a0+b,tag,unit:"",fixes:[],done:/\[[xXхХvV✓✔+]\]|[☑☒✓✔]/.test(lead)});
    }
    return out;
  }
  const lineValue=v=>{const t=String(v||"").replace(/\s+/g," ").trim().slice(0,LINE_MAX);return /[\p{L}\p{N}]/u.test(t)?t:"";};

  /* Образец → правило. «21-PT-1001A» → [2 цифры = установка] [буквы] [4 цифры] [+буква].
     v125: образец может быть любым. Латинские буквы + цифры + дефис — прежнее правило КИП (kind:"tag").
     Иначе — общее правило (kind:"gen"): цифры → столько же цифр, буквы → буквы, знаки — как в образце;
     одни цифры — номер такой же длины. Образец без цифр (kind:"line") — подходит любая строка. */
  function genRule(raw){
    const s=up(raw).replace(DASH,"-").replace(/\s+/g," ");
    const parts=s.match(new RegExp(`\\d+|[${LT}]+|[-_ ]+|[^${LT}0-9\\-_ ]`,"g"))||[];
    const onlyDigits=/^\d+$/.test(s);
    // Строчные буквы в образце («Кабинет 305») — буквы остаются как написаны; образец заглавными («INV-0042») — заглавными.
    const keep=/[a-zа-яё]/.test(raw);
    // «21-A-B-100»: цифры в начале через дефис перед буквами — установка (вкладка), как в правилах КИП.
    const unitLead=parts.length>2&&/^\d+$/.test(parts[0])&&parts[1].includes("-")&&new RegExp(`^[${LT}]`).test(parts[2]);
    let re="";const segs=[];
    parts.forEach((p,i)=>{
      if(/^\d+$/.test(p)){
        // Буква вместо цифры (фото) допускается, только если номер не слит с буквами.
        const glued=new RegExp(`[${LT}]`).test((parts[i-1]||"").slice(-1)+(parts[i+1]||"").slice(0,1));
        re+=glued?`(\\d{${p.length}})`:`([0-9OQILSZ]{${p.length}})`;segs.push({k:"num",n:p.length,fix:!glued,unit:i===0&&unitLead});
      }else if(new RegExp(`^[${LT}]+$`).test(p)){
        re+=p.length>=2?`([${LT}]{2,${Math.max(8,p.length)}})`:`([${LT}])`;segs.push({k:p.length>=2?"fn":"one",t:p});
      }else if(/^[-_ ]+$/.test(p)){re+=`${SEP}?`;segs.push({k:"sep",t:p.includes("-")?"-":p.includes("_")?"_":" "});}
      else{re+=`\\s?${esc(p)}\\s?`;segs.push({k:"lit",t:p});}
    });
    const edge=onlyDigits?"[-–—−_/.,:]":"[-–—−_]";
    return {kind:"gen",src:String(raw).replace(/\s+/g," "),segs,parts:[],onlyDigits,keep,
      re:new RegExp(`${B0}(?<![${LT}0-9]${edge})${re}${B1}${onlyDigits?`(?!${edge}[${LT}0-9])`:""}`,"g")};
  }
  function fromExample(text){
    const raws=String(text||"").split(/[,;\n]+|\s{2,}/).map(s=>s.trim()).filter(Boolean).slice(0,5);
    if(!raws.length)return {ok:false,get error(){return TX("Впишите пример строки из своего списка");}};
    const rules=[];
    for(const raw of raws){
      if(raw.length>60)return {ok:false,get error(){return TX("Образец длиннее 60 знаков — впишите одну короткую строку");}};
      const s=norm(raw).replace(DASH,"-").replace(/\s+/g," ");
      const parts=s.match(/\d+|[A-Z]+|[-_ ]+|[^A-Z0-9-_ ]+/g)||[];
      if(!/\d/.test(raw)){
        if(!/[\p{L}]/u.test(raw))return {ok:false,get error(){return TX("В «{0}» нет ни букв, ни цифр",raw);}};
        if(!rules.some(r=>r.kind==="line"))rules.push({kind:"line",src:raw,segs:[],parts:[]});
        continue;
      }
      // Правило КИП — только для вида «[установка-]буквы-номер[буква]»; всё остальное — «как в образце».
      if(!/^(?:\d+[-_ ]?)?[A-Z]+[-_ ]?\d+[A-Z]{0,2}$/.test(s)||/[a-zа-яё]/.test(raw)&&/\s/.test(raw)){rules.push(genRule(raw));continue;}
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
      rules.push({kind:"tag",re:new RegExp(`(?<![A-Za-z0-9А-ЯЁа-яё])(?<![A-Za-z0-9][-–—−_])${re}(?![A-Za-z0-9А-ЯЁа-яё])`,"g"),src:s,segs,parts:parts.filter(p=>!/^[-_ ]+$/.test(p))});
    }
    // Правила КИП — первыми (как раньше), затем общие, «любая строка» — последней: ей достаются строки без других находок.
    const order={tag:0,gen:1,line:2};rules.sort((a,b)=>order[a.kind]-order[b.kind]);
    return {ok:true,rules,generic:rules.some(r=>r.kind!=="tag"),lines:rules.some(r=>r.kind==="line")};
  }
  // Правило образца — одной фразой.
  function describe(custom){
    if(!custom||!custom.ok)return "";
    const en=isEn(),digits=n=>en?`${n} ${n===1?"digit":"digits"}`:`${n} ${n===1?"цифра":n<5?"цифры":"цифр"}`;
    // v125: общие правила — «как в образце»; правила КИП описываются прежней фразой.
    const gen=custom.rules.filter(r=>r.kind!=="tag").map(r=>{
      if(r.kind==="line")return TX("«{0}» — текст без цифр: подойдёт любая строка, каждая строка станет пунктом",r.src);
      if(r.onlyDigits)return TX("«{0}» — номер: ровно {1}. Другая длина — добавьте ещё образец через запятую",r.src,digits(r.segs[0].n));
      const p=[];r.segs.forEach(s=>{
        if(s.k==="num")p.push(s.unit?(en?`${digits(s.n)} — unit`:`${digits(s.n)} — установка`):digits(s.n));
        else if(s.k==="fn")p.push(TX("буквы"));
        else if(s.k==="one")p.push(TX("одна буква"));
        else if(s.k==="lit")p.push(TX("знак «{0}»",s.t));
      });
      return `«${r.src}» — ${p.join(", ")}`;
    });
    const tags=custom.rules.filter(r=>r.kind==="tag");
    if(!tags.length)return gen.join("; ")+".";
    return (gen.length?gen.join("; ")+"; ":"")+tags.map(r=>{
      const p=[];r.segs.forEach(s=>{
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
      // v111: «345L», «345I» — буква после настоящих цифр — это суффикс, а не цифра 1.
      // O и Q в конце по-прежнему читаются как 0 (частая ошибка фото).
      {const t=num.match(/^([0-9OQILSZ]*\d)([ILSZ]{1,2})$/);
       if(t&&t[1].length>=2&&(t[2]+(suf||"")).length<=2){num=t[1];suf=t[2]+(suf||"");}}
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
  function scan(text,mode="auto",custom=null,preset=""){
    const src=String(text||""),N=norm(src),found=[],skipped=[],taken=new Uint8Array(N.length+1);
    const mark=(a,b)=>{for(let i=a;i<b;i++)taken[i]=1;};
    const free=(a,b)=>{for(let i=a;i<b;i++)if(taken[i])return false;return true;};
    const cyrIn=(a,b)=>{for(let i=a;i<b;i++)if(isCyr(src[i]))return true;return false;};
    if(!MODES.includes(mode))mode="auto";
    // v125: любой текст и готовые наборы — без правил КИП: в тексте берётся только то, что задаёт набор.
    if(mode==="free")return {found:freeLines(src,null),skipped};
    if(mode==="preset"){
      for(const t of presetById(preset).find(src)){if(!free(t.start,t.end))continue;mark(t.start,t.end);found.push({unit:"",fixes:[],...t});}
      // Похожее на теги КИП — в «не взято»: по ним видно, что нужен другой формат.
      for(const c of candidates(N,src))if(free(c.a,c.b)&&!c.reason)skipped.push({start:c.a,end:c.b,text:c.show,reason:"не по набору"});
      return {found,skipped};
    }
    const generic=mode==="custom"&&custom&&custom.ok&&custom.generic;
    // KKS — первым: строка KKS не должна разобраться как обычный тег.
    KKS.lastIndex=0;let k;
    while(!generic&&(k=KKS.exec(N))){
      const a=k.index,b=a+k[0].length;
      if(mode!=="kks"){skipped.push({start:a,end:b,text:src.slice(a,b),reason:"код KKS"});mark(a,b);continue;}
      const f1=fixDigits(k[3]),f2=fixDigits(k[5]),fixes=[];
      if(f1.fixed||f2.fixed)fixes.push(TX("в номере {0}",[f1.what,f2.what].filter(Boolean).join(", ")));
      if(cyrIn(a,b))fixes.push(TX("кириллица → латиница"));
      mark(a,b);found.push({start:a,end:b,tag:`${k[1]}${k[2]}${f1.v}${k[4]}${f2.v}`,unit:`${k[1]}${k[2]}`,fixes});
    }
    if(mode==="custom"){
      if(!custom||!custom.ok)return {found,skipped,error:custom?custom.error:TX("Впишите пример строки из своего списка")};
      const U=generic?up(src):"";
      for(const r of custom.rules){
        if(r.kind==="line"){
          for(const t of freeLines(src,taken)){mark(t.start,t.end);found.push(t);}
          continue;
        }
        if(r.kind==="gen"){
          r.re.lastIndex=0;let m;
          while((m=r.re.exec(U))){
            const a=m.index,b=a+m[0].length;if(!free(a,b))continue;
            let ok=true,out="",unit="",gi=1,cur=a;const fixes=[];
            for(const sg of r.segs){
              if(sg.k==="sep"||sg.k==="lit"){out+=sg.t;continue;}
              let g=m[gi++];
              // Положение группы в исходном тексте: между группами — только знаки и пробелы.
              while(cur<b&&!new RegExp(`[${LT}0-9]`).test(U[cur]))cur++;
              if(r.keep&&sg.k!=="num")g=src.slice(cur,cur+g.length);
              cur+=g.length;
              if(sg.k==="num"&&sg.fix){
                const real=(g.match(/\d/g)||[]).length;
                if(real<Math.max(1,g.length-1)||(g.length<3&&real<g.length)){ok=false;break;}
                const f=fixDigits(g);if(f.fixed)fixes.push(TX("в номере {0}",f.what));out+=f.v;if(sg.unit)unit=f.v;
              }else out+=g;
            }
            if(!ok)continue;
            mark(a,b);found.push({start:a,end:b,tag:r.keep?out:unify(out),unit,fixes});
          }
          continue;
        }
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
      if(!custom.lines)for(const c of candidates(N,src))if(free(c.a,c.b))skipped.push({start:c.a,end:c.b,text:c.show,reason:c.reason||"не по образцу"});
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
  function single(value,mode,custom,preset){
    const v=String(value||"").trim();
    if(!v)return null;
    // v125: любой текст — подходит любая непустая строка; набор — своя, более мягкая проверка ручного ввода.
    if(mode==="free"||(mode==="custom"&&custom&&custom.ok&&custom.lines&&!/\n/.test(v)&&!scan(v,mode,custom).found.some(t=>t.start===0&&t.end===v.length))){
      const t=lineValue(v);return t?{ok:true,start:0,end:v.length,tag:t,unit:"",fixes:[]}:{ok:false,reason:"нет ни букв, ни цифр"};
    }
    if(mode==="preset"){
      const p=presetById(preset),t=p.one?p.one(v):whole(p,v);
      return t?{ok:true,start:0,end:v.length,tag:t,unit:"",fixes:[]}:{ok:false,reason:"не по набору"};
    }
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
    if(r.some(x=>x==="не по образцу"||x==="не KKS"||x==="не по набору")&&!(res.found||[]).length)return {to:"auto",text:TX("Здесь другой формат"),btn:TX("Включить ISA-5.1")};
    return null;
  }

  /* ---------- выбранный формат: хранится на устройстве ---------- */
  const KEY="kip-tag-format-v1";
  const st={mode:"auto",isaLast:"auto",example:"",check:false,sample:"me",own:"",preset:"num"};
  try{const raw=JSON.parse(localStorage.getItem(KEY)||"null");if(raw&&typeof raw==="object")Object.assign(st,raw);}catch(_){}
  if(!MODES.includes(st.mode))st.mode="auto";
  if(!["auto","unit","bare"].includes(st.isaLast))st.isaLast="auto";
  if(!PRESETS.some(p=>p.id===st.preset))st.preset="num";
  let custom=fromExample(st.example);
  const listeners=new Set();
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(st));}catch(_){}}
  const changed=()=>{persist();listeners.forEach(fn=>{try{fn(st.mode);}catch(_){}});};
  function setMode(m){
    if(!MODES.includes(m))return;
    st.mode=m;if(["auto","unit","bare"].includes(m))st.isaLast=m;
    changed();
  }
  function setExample(text){st.example=String(text||"");custom=fromExample(st.example);changed();}
  function setPreset(id){if(!PRESETS.some(p=>p.id===id))return;st.preset=id;st.mode="preset";changed();}
  // Список — не перечень КИП (набор, любой текст, общий образец): без установок и без принудительных заглавных букв.
  const isGeneric=()=>st.mode==="free"||st.mode==="preset"||(st.mode==="custom"&&custom.ok&&custom.generic);

  const api={
    FORMATS,MODES,PRESETS,norm,scan,single,fromExample,describe,hint,
    get mode(){return st.mode;},
    get state(){return st;},
    get custom(){return custom;},
    get preset(){return presetById(st.preset);},
    get generic(){return isGeneric();},
    setMode,setExample,setPreset,
    setPref(k,v){st[k]=v;persist();},
    onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    name(m=st.mode){return m==="preset"?TX(presetById(st.preset).name):TX(FORMATS[m].name);},
    button(m=st.mode){
      if(m==="preset"){const b=TX(presetById(st.preset).btn);return [b,b];}
      return (m==="custom"&&custom.ok?["Свой","Свой"]:FORMATS[m].btn).map(x=>TX(x));
    },
    placeholder(){
      if(st.mode==="preset")return TX(presetById(st.preset).ph);
      return st.mode==="custom"?(custom.ok?TX("Например, {0}",custom.rules[0].src):TX("Сначала впишите образец")):TX(FORMATS[st.mode].ph);
    },
    // v125: подсказки клавиатуре для поля ввода: регистр букв и вид клавиатуры.
    input(){
      if(st.mode==="preset"){const p=presetById(st.preset);return {caps:p.caps||"none",kbd:p.kbd||"text"};}
      if(st.mode==="free"||(st.mode==="custom"&&custom.ok&&custom.lines))return {caps:"sentences",kbd:"text"};
      if(st.mode==="custom"&&custom.ok&&custom.rules.every(r=>r.onlyDigits))return {caps:"none",kbd:"numeric"};
      return {caps:"characters",kbd:"text"};
    },
    // Вид тега в списках найденного: теги КИП — заглавными, остальное — как написано.
    show(tag){return isGeneric()?String(tag||""):String(tag||"").toUpperCase();},
    // В выбранном формате.
    find(text){return scan(text,st.mode,custom,st.preset).found;},
    scanNow(text){return scan(text,st.mode,custom,st.preset);},
    check(value){return single(value,st.mode,custom,st.preset);},
    canonical(value){const r=single(value,st.mode,custom,st.preset);return r&&r.ok?r.tag:null;},
    // Правка готового тега: подходит выбранный формат или любой известный.
    anyValid(value){
      for(const [m,c] of [[st.mode,custom],["auto",null],["kks",null]]){const r=single(value,m,c,st.preset);if(r&&r.ok)return r;}
      return single(value,st.mode,custom,st.preset);
    },
    // Номер установки (вкладка) по тегу — независимо от выбранного формата.
    unitOf(tag){
      const v=String(tag||"").trim();if(!v)return "";
      const k=single(v,"kks");if(k&&k.ok)return k.unit;
      const r=single(v,"auto");if(r&&r.ok)return r.unit;
      // v125: только слитное обозначение «100-FT…»: у строки текста («12 стульев») установки нет.
      const m=/\s/.test(v)?null:norm(v).match(/^(\d{1,5})[-–—_](?=[A-Z])/);return m?m[1]:"";
    }
  };
  // Примеры для «Проверить на тексте» (условные, не данные объекта).
  api.SAMPLES=[
    {id:"ru",name:"Наш формат",text:"Перечень на смену 15.10\n1. 2131-PZT-414A — проверка контура\n2. 2131-TT-434 калибровка 0…400 °C\n3. 2140-FT-118 ✓\n4. 2140-LSHH-208B проверка уставки\n5. 2150-РDТ-302 продувка импульсных линий\nНасос P-2101A — не КИП\nТрубопровод DN-50, PN-16"},
    {id:"me",name:"Ближний Восток",text:"LOOP CHECK STATUS — AREA 21\n21-PT-1001   Loop check OK\n21-FT-1002A  Calibration pending\n21-LIT-1105  Re-test after repair\n22-TT-2010   OK\n22-PDT-2O14  Impulse line flushing\n22-XV-2051   Stroke test\nV-2101 vessel, see DWG-21-0001 rev 2"},
    {id:"us",name:"США · скид",text:"SKID 100 — INSTRUMENT INDEX\nPT-101   Pump discharge pressure\nPT-102   Suction pressure\nFT101A   Flow, magmeter\nTE-105 / TT-105   Bearing temperature, Pt100\nLSL-110  Low level switch\nP-101A pump, M-20 bolts, 2\" 150#"},
    {id:"office",name:"Офис · склад",get text(){return isEn()
      ?"Requests for the week\n1. Invoice № 123/45-A — pay by Friday\n2. Laptop INV-000482, shelf 3 — hand over\n3. John Smith, +44 20 7946 0958, smith@example.com\n4. Car А123ВС77 — gate pass\n5. Printer 192.168.1.40 — replace cartridge 4512\n6. Monitor S/N X7K9Q2M4 — write off"
      :"Заявки на неделю\n1. Счёт № 123/45-А — оплатить до пятницы\n2. Ноутбук INV-000482, полка 3 — выдать\n3. Иванов И.И., +7 (912) 345-67-89, ivanov@example.com\n4. Машина А123ВС77 — пропуск\n5. Принтер 192.168.1.40 — заменить картридж 4512\n6. Монитор, зав. № X7K9Q2M4 — списать";}},
    {id:"kks",name:"KKS",get text(){return isEn()
      ?"I&C check sheet, unit 1\n10LBA10CP001  steam pressure\n10LBA10CT002  steam temperature\n10LAB20CF001  feedwater flow\n20HAD11CL001  drum level\n10 LBA 30 CP 003  sensor replaced"
      :"Контрольный лист КИП, блок 1\n10LBA10CP001  давление пара\n10LBA10CT002  температура пара\n10LAB20CF001  расход питательной воды\n20HAD11CL001  уровень в барабане\n10 LBA 30 CP 003  датчик заменён";}}
  ];
  window.TagFormat=api;
  if(typeof module!=="undefined")module.exports=api;
})();
