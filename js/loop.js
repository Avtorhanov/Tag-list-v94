/* Tag list v96 — конвертор токовой петли 4–20 мА: TT, PT, FT, LT.
   Загружается по требованию при переключении раздела «4–20».
   Работает полностью на устройстве: без интернета и без внешних запросов.

   Расчёт:
     I [мА] = 4 + 16 · x,   x — доля шкалы (0…1)
     TT  ГОСТ 6651-2009 / IEC 60751, Каллендар–Ван Дюзен:
         t ≥ 0:  R = R0·(1 + A·t + B·t²);  t < 0: + C·(t − 100)·t³
         медь α 0,00428: t ≥ 0: R = R0·(1 + α·t); t < 0: R0·(1 + A·t + B·t·(t + 6,7) + C·t³)
         v108: шкала и значения — в °C или °F (t°F = t°C · 9/5 + 32); НСХ всегда считается в °C
     PT  линейная шкала, перевод единиц давления
     FT  по перепаду: Q = Qmax·√(ΔP/ΔPmax); корень в преобразователе или в РСУ
     LT  гидростатика: ΔP = ρ·g·h + смещение
*/
(function(){
"use strict";

// v107: язык интерфейса — js/i18n.js (TX). Единицы в состоянии хранятся по-русски («МПа»), на экран — через TX.
const TX=typeof window.TX==="function"?window.TX:(s,...a)=>String(s??"").replace(/\{(\d+)\}/g,(m,i)=>a[i]!==undefined?String(a[i]):m);
const DEC=()=>window.I18N?window.I18N.dec:",";
const isEn=()=>!!window.I18N?.en;

const STORE_KEY="kip-loop-converter-v1";
const G=9.80665;
const MAT={
  pt385:{lbl:"Pt",name:"Pt, α = 0,00385",A:3.9083e-3,B:-5.775e-7,C:-4.183e-12,min:-200,max:850},
  pt391:{lbl:"П",name:"П, α = 0,00391",A:3.9690e-3,B:-5.841e-7,C:-4.330e-12,min:-200,max:850},
  cu428:{lbl:"М",name:"М (медь), α = 0,00428",cu:true,min:-180,max:200}
};
const PU=[["МПа",1e6],["кПа",1e3],["бар",1e5],["кгс/см²",98066.5],["мм вод. ст.",9.80665],["мм рт. ст.",133.3224],["psi",6894.757]];
const PUK=new Map(PU);
const Q_UNITS=["м³/ч","нм³/ч","т/ч","кг/ч","л/мин","кг/с"];
const TT_PRE=[[0,50],[0,100],[0,150],[0,200],[-50,50],[-50,100],[-50,150],[-50,200],[0,300],[0,400],[-100,100],[-200,600]];
// v108: типовые шкалы в °F (американские и ближневосточные проекты).
const TT_PRE_F=[[0,100],[0,200],[0,250],[0,300],[0,500],[32,212],[-50,150],[-20,250],[0,600],[0,1000],[-100,400],[-320,1100]];
const PT_PRE=[[0,0.6],[0,1],[0,1.6],[0,2.5],[0,4],[0,6],[0,10],[0,16],[0,25],[-0.1,0.5],[-0.1,0.9]];
const KINDS=[["TT","температура"],["PT","давление"],["FT","расход"],["LT","уровень"]];
const KIND_NAME={TT:"температура",PT:"давление",FT:"расход",LT:"уровень"};
const DEF={
  TT:{mat:"pt385",r0:100,lrv:0,urv:150,lin:"T",tu:"C"},
  PT:{unit:"МПа",lrv:0,urv:1.6},
  FT:{kind:"dp",qunit:"м³/ч",qmin:0,qmax:100,dpmax:25,root:"tx"},
  LT:{kind:"direct",unit:"мм",lrv:0,urv:2000,rho:1000,off:0}
};
const clone=o=>JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- числа
function parseNum(v){
  const s=String(v??"").replace(/[\s  ]/g,"").replace(/,/g,".").replace(/[−–]/g,"-");
  if(!s||s==="-"||s===".")return NaN;
  if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s))return NaN;
  return Number(s);
}
// Округление «как в таблицах»: 138,5055 → 138,506 (без двоичной погрешности 138,50549…).
const rnd=(v,d)=>{const f=10**d,r=Math.round(Math.abs(v)*f*(1+1e-12))/f*Math.sign(v);return (Object.is(r,-0)?0:r).toFixed(d);};
// Для полей ввода: запятая (в английском — точка) и обычный минус (его удобно править).
const fin=(v,d)=>Number.isFinite(v)?rnd(v,d).replace(".",DEC()):"";
// Для текста: запятая и типографский минус.
const fx=(v,d)=>Number.isFinite(v)?rnd(v,d).replace(".",DEC()).replace("-","−"):"—";
const fr=v=>Number.isFinite(v)?String(+v.toFixed(4)).replace(".",DEC()).replace("-","−"):"—";
const frIn=v=>Number.isFinite(v)?String(+v.toFixed(4)).replace(".",DEC()):"";
const sig=v=>Number.isFinite(v)?String(+v.toPrecision(4)).replace(".",DEC()).replace("-","−"):"—";
const U=u=>TX(u); // подпись единицы
const dg=span=>{span=Math.abs(span);return span<0.5?4:span<5?3:span<500?2:1;};
const ssq=x=>Math.sign(x)*Math.sqrt(Math.abs(x));
const plain=s=>String(s).replace(/−/g,"-");
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

// ---------------------------------------------------------------- физика
function Rt(t,c){
  const m=MAT[c.mat],R0=c.r0;
  if(m.cu)return t>=0?R0*(1+4.28e-3*t):R0*(1+4.28e-3*t-6.2032e-7*t*(t+6.7)+8.5154e-10*t*t*t);
  let r=1+m.A*t+m.B*t*t;if(t<0)r+=m.C*(t-100)*t*t*t;return R0*r;
}
function Tr(r,c){let lo=-273,hi=1200;for(let k=0;k<80;k++){const mid=(lo+hi)/2;if(Rt(mid,c)<r)lo=mid;else hi=mid;}return (lo+hi)/2;}
// v108: единицы температуры шкалы. lrv/urv хранятся в выбранных единицах (tu: "C" | "F"),
// Rt/Tr, ttP/ttT работают в °C.
const isF=c=>c.tu==="F";
const TU=c=>isF(c)?"°F":"°C";
const toC=(t,c)=>isF(c)?(t-32)*5/9:t;
const fromC=(t,c)=>isF(c)?t*9/5+32:t;
const cToF=t=>t*9/5+32,fToC=t=>(t-32)*5/9;
function ttP(t,c){const lo=toC(c.lrv,c),hi=toC(c.urv,c);if(c.lin==="T")return (t-lo)/(hi-lo);const a=Rt(lo,c),b=Rt(hi,c);return (Rt(t,c)-a)/(b-a);}
function ttT(p,c){const lo=toC(c.lrv,c),hi=toC(c.urv,c);if(c.lin==="T")return lo+p*(hi-lo);const a=Rt(lo,c),b=Rt(hi,c);return Tr(a+p*(b-a),c);}
const dPh=(h,c)=>c.rho*G*h/1e6+c.off;

const MODES={
  TT:{
    fields:c=>[{k:"t",l:"Температура",u:TU(c),d:2,sign:true},{k:"r",l:"Сопротивление",u:"Ом",d:3}],
    vals:(p,c)=>{const tc=ttT(p,c);return {t:fromC(tc,c),r:Rt(tc,c),tc};},
    toP:(k,v,c)=>k==="t"?ttP(toC(v,c),c):(v>0?ttP(Tr(v,c),c):NaN),
    notes:(v,c)=>{const m=MAT[c.mat],u=TU(c),out=v.tc<m.min||v.tc>m.max;
      const rng=TX(out?"Вне диапазона НСХ {0}: {1}…{2} {3}":"Диапазон НСХ {0}: {1}…{2} {3}",TX(m.lbl),fr(+fromC(m.min,c).toFixed(1)),fr(+fromC(m.max,c).toFixed(1)),u);
      // Второе значение — в других единицах: 150 °C = 302 °F.
      const alt=`= ${fx(isF(c)?v.tc:cToF(v.tc),2)} ${isF(c)?"°C":"°F"}`;
      const slope=(Rt(v.tc+0.5,c)-Rt(v.tc-0.5,c))/(isF(c)?1.8:1);
      return {
      t:(out?`<b class="loopBad">${rng}</b>`:rng)+` · ${alt}`,
      r:TX("R₀ = {0} Ом · крутизна ≈ {1} Ом/{2}",fx(c.r0,2),fx(slope,4),u)};},
    sum:c=>`${TX(MAT[c.mat].lbl)}${c.r0} · ${fr(c.lrv)}…${fr(c.urv)} ${TU(c)}${c.lin==="R"?TX(" · лин. по R"):""}`,
    cal:"Выставьте сопротивление на магазине вместо датчика и сравните ток."
  },
  PT:{
    fields:c=>[{k:"P",l:"Давление",u:c.unit,d:dg(c.urv-c.lrv),sign:true}],
    vals:(p,c)=>({P:c.lrv+p*(c.urv-c.lrv)}),
    toP:(k,v,c)=>(v-c.lrv)/(c.urv-c.lrv),
    notes:(v,c)=>{const pa=v.P*PUK.get(c.unit);const show=["МПа","кгс/см²","бар","кПа"].filter(u=>u!==c.unit).slice(0,3);
      return {P:"= "+show.map(u=>`${sig(pa/PUK.get(u))} ${U(u)}`).join(" · ")};},
    sum:c=>`${fr(c.lrv)}…${fr(c.urv)} ${U(c.unit)}`,
    cal:"Задайте давление калибратором или грузопоршневым манометром и сравните ток."
  },
  FT:{
    fields:c=>c.kind==="dp"
      ?[{k:"q",l:"Расход",u:c.qunit,d:dg(c.qmax)},{k:"d",l:"Перепад",u:"кПа",d:dg(c.dpmax)}]
      :[{k:"q",l:"Расход",u:c.qunit,d:dg(c.qmax-c.qmin),sign:true}],
    vals:(p,c)=>{
      if(c.kind!=="dp")return {q:c.qmin+p*(c.qmax-c.qmin)};
      const qf=c.root==="tx"?p:ssq(p),df=c.root==="tx"?p*Math.abs(p):p;
      return {q:qf*c.qmax,d:df*c.dpmax};
    },
    toP:(k,v,c)=>{
      if(c.kind!=="dp")return (v-c.qmin)/(c.qmax-c.qmin);
      if(k==="q"){const q=v/c.qmax;return c.root==="tx"?q:q*Math.abs(q);}
      const d=v/c.dpmax;return c.root==="tx"?ssq(d):d;
    },
    notes:(v,c)=>{
      if(c.kind!=="dp")return {q:TX("Шкала {0}",`${fr(c.qmin)}…${fr(c.qmax)} ${U(c.qunit)}`)};
      const qf=v.q/c.qmax;
      return {
        q:(qf>0&&qf<0.1)?`<b class="loopWarn">${TX("Ниже 10 % Qmax корень усиливает шум — обычно включают отсечку")}</b>`:`${fx(qf*100,1)} % Qmax`,
        d:`${fx(v.d/c.dpmax*100,1)} % ΔPmax · ${c.root==="tx"?TX("ток линеен по расходу"):TX("ток линеен по перепаду")}`
      };
    },
    sum:c=>c.kind==="dp"?`ΔP 0…${fr(c.dpmax)} ${U("кПа")} → 0…${fr(c.qmax)} ${U(c.qunit)} · ${c.root==="tx"?TX("√ в ПП"):TX("√ в РСУ")}`:`${fr(c.qmin)}…${fr(c.qmax)} ${U(c.qunit)}`,
    cal:"Для СУ задайте перепад калибратором на плюсовую камеру (минусовая — на атмосферу) и сравните ток."
  },
  LT:{
    fields:c=>c.kind==="hydro"
      ?[{k:"h",l:"Уровень",u:"мм",d:dg(c.urv-c.lrv),sign:true},{k:"d",l:"Перепад",u:"кПа",d:Math.min(4,dg(dPh(c.urv,c)-dPh(c.lrv,c))+1),sign:true}]
      :[{k:"h",l:"Уровень",u:c.unit,d:dg(c.urv-c.lrv),sign:true}],
    vals:(p,c)=>{const h=c.lrv+p*(c.urv-c.lrv);return c.kind==="hydro"?{h,d:dPh(h,c)}:{h};},
    toP:(k,v,c)=>{if(k==="h")return (v-c.lrv)/(c.urv-c.lrv);const a=dPh(c.lrv,c),b=dPh(c.urv,c);return (v-a)/(b-a);},
    notes:(v,c)=>c.kind==="hydro"
      ?{h:TX("Шкала {0}…{1} мм от оси нижнего отбора",fr(c.lrv),fr(c.urv)),d:`ρ = ${fr(c.rho)} ${U("кг/м³")}${c.off?TX(" · смещение {0} кПа",fr(c.off)):""}`}
      :{h:TX("Шкала {0}",`${fr(c.lrv)}…${fr(c.urv)} ${U(c.unit)}`)},
    sum:c=>c.kind==="hydro"?`${fr(c.lrv)}…${fr(c.urv)} ${U("мм")} · ρ ${fr(c.rho)} · ΔP ${sig(dPh(c.lrv,c))}…${sig(dPh(c.urv,c))} ${U("кПа")}`:`${fr(c.lrv)}…${fr(c.urv)} ${U(c.unit)}`,
    cal:"Для гидростатики задайте перепад из столбца «кПа» калибратором и сравните ток."
  }
};

function namur(mA){
  if(!Number.isFinite(mA))return {cls:"gasBad",text:TX("Нет значения")};
  if(mA<=3.6)return {cls:"gasBad",text:TX("Сигнал отказа: ≤ 3,6 мА (NAMUR NE 43)")};
  if(mA<3.8)return {cls:"gasBad",text:TX("Ниже диапазона измерения (< 3,8 мА)")};
  if(mA<4)return {cls:"gasWarnText",text:TX("Ниже нуля шкалы — в пределах 3,8–4 мА")};
  if(mA<=20)return {cls:"gasOk",text:TX("В диапазоне шкалы 4–20 мА")};
  if(mA<=20.5)return {cls:"gasWarnText",text:TX("Выше шкалы — в пределах 20–20,5 мА")};
  if(mA<21)return {cls:"gasBad",text:TX("Выше диапазона измерения (> 20,5 мА)")};
  return {cls:"gasBad",text:TX("Сигнал отказа: ≥ 21 мА (NAMUR NE 43)")};
}

// Тип прибора по буквам тега: 2131-TT-434 → TT, 2132-PDT-402 → PT, FT101A → FT.
// v105: KKS — по коду датчика: 10LBA10CP001 → PT (CP давление, CT температура, CF расход, CL уровень).
// OCR часто подставляет кириллицу вместо латиницы — приводим к латинице.
const CYR={"Т":"T","Р":"P","Е":"E","А":"A","С":"C","К":"K","М":"M","Н":"H","О":"O","Х":"X","В":"B","І":"I"};
const KIND={T:"TT",P:"PT",F:"FT",L:"LT"};
function detectKind(tag){
  const s=String(tag||"").toUpperCase().replace(/[ТРЕАСКМНОХВІ]/g,ch=>CYR[ch]);
  const kks=s.replace(/\s+/g,"").match(/^\d{1,2}[A-Z]{3}\d{2}C([TPFL])\d{3}$/);
  if(kks)return KIND[kks[1]];
  for(const part of s.split(/[-_\s./]+/)){
    const m=part.match(/^([A-Z]{1,5})(?:\d+[A-Z]{0,2})?$/);
    if(m)return KIND[m[1][0]]||null;
  }
  return null;
}

// ---------------------------------------------------------------- состояние
function loadState(){
  const s={kind:"TT",p:0.5,cfg:clone(DEF),tags:{},tag:""};
  try{
    const raw=JSON.parse(localStorage.getItem(STORE_KEY)||"null");
    if(raw&&typeof raw==="object"){
      if(MODES[raw.kind])s.kind=raw.kind;
      if(Number.isFinite(raw.p))s.p=raw.p;
      for(const k in DEF)s.cfg[k]={...DEF[k],...((raw.cfg||{})[k]||{})};
      if(raw.tags&&typeof raw.tags==="object")s.tags=raw.tags;
      if(typeof raw.tag==="string")s.tag=raw.tag;
    }
  }catch(_){}
  return s;
}
let state=loadState();
let saveTimer=0;
let dirty=false;
function persist(){dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(flush,250);}
// v100: при смене раздела состояние пишется, только если что-то менялось.
function flush(){clearTimeout(saveTimer);if(!dirty)return;dirty=false;try{localStorage.setItem(STORE_KEY,JSON.stringify(state));}catch(_){}}
const C=()=>state.cfg[state.kind];
const M=()=>MODES[state.kind];

// ---------------------------------------------------------------- разметка
const ICON={
  copy:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"></rect><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"></path></svg>',
  send:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3 10.5 13.5"></path><path d="m21 3-6.5 18-4-7.5L3 9.5Z"></path></svg>',
  pin:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4Z"></path></svg>',
  x:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>',
  task:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5h6M9 4.5a1.5 1.5 0 0 0-1.5 1.5H6.5A2 2 0 0 0 4.5 8v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1A1.5 1.5 0 0 0 15 4.5"></path><path d="m8.5 13.5 2.5 2.5 4.5-5"></path></svg>',
  book:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5a2 2 0 0 1 2-2h11.5v14H7a2 2 0 0 0-2 2Z"></path><path d="M5 19.5a2 2 0 0 0 2 2h11.5v-4"></path><path d="M8.5 7.5h6.5M8.5 11h4.5"></path></svg>'
};
let root=null,els={},getTags=null;
function $(id){return els[id]||(els[id]=root.querySelector("#"+id));}

function seg(id,a,b){
  return `<div class="loopSeg" role="group">${[a,b].map(([val,label])=>`<button type="button" class="tab" data-set="${id}=${val}">${TX(label)}</button>`).join("")}</div>`;
}
function numField(id,label,attrs=""){
  return `<div class="field"${attrs}><label for="loopC_${id.replace(".","_")}">${TX(label)}</label><input id="loopC_${id.replace(".","_")}" data-cfg="${id}" inputmode="decimal" autocomplete="off"/></div>`;
}
function signedField(id,label,attrs=""){
  const fid=`loopC_${id.replace(".","_")}`;
  return `<div class="field"${attrs}><label for="${fid}">${TX(label)}</label><div class="gasJoin"><input id="${fid}" data-cfg="${id}" inputmode="decimal" autocomplete="off"/><button type="button" class="gasSign" data-sign="${fid}" aria-label="${TX("Сменить знак")}" title="${TX("Плюс / минус")}">±</button></div></div>`;
}
function template(){
  const kinds=KINDS.map(([k,n])=>`<button type="button" class="tab loopKind" data-kind="${k}" role="tab" aria-selected="false"><b>${k}</b><small>${TX(n)}</small></button>`).join("");
  const matOpts=Object.entries(MAT).map(([id,m])=>`<option value="${id}">${esc(isEn()?TX(m.name):m.name)}</option>`).join("");
  const puOpts=PU.map(([u])=>`<option value="${esc(u)}">${esc(U(u))}</option>`).join("");
  const quOpts=Q_UNITS.map(u=>`<option value="${esc(u)}">${esc(U(u))}</option>`).join("");
  const ttPre=TT_PRE.map(([l,u])=>`<button type="button" class="tab" data-pre="TT" data-tu="C" data-l="${l}" data-u="${u}">${fr(l)}…${fr(u)}</button>`).join("")
    +TT_PRE_F.map(([l,u])=>`<button type="button" class="tab" data-pre="TT" data-tu="F" data-l="${l}" data-u="${u}">${fr(l)}…${fr(u)}</button>`).join("");
  const ptPre=PT_PRE.map(([l,u])=>`<button type="button" class="tab" data-pre="PT" data-l="${l}" data-u="${u}">${fr(l)}…${fr(u)}</button>`).join("");
  return `
<div class="gasGrid loopGrid">
  <div class="gasCol">
    <section class="gasCard gasO1" aria-labelledby="loopDevTitle">
      <div class="gasCardHead"><h2 id="loopDevTitle">${TX("Прибор")}</h2><span class="gasHeadNote" id="loopCfgLine"></span></div>
      <div class="loopKinds" role="tablist" aria-label="${TX("Тип прибора")}">${kinds}</div>
      <div class="field loopTagField">
        <label for="loopTag">${TX("Тэг")}</label>
        <div class="gasJoin">
          <input id="loopTag" autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="done" placeholder="2131-TT-434"/>
          <button type="button" class="action loopSaveBtn" id="loopSave" title="${TX("Сохранить шкалу для этого тега")}">${ICON.pin}<span>${TX("Сохранить")}</span></button>
        </div>
      </div>
      <div class="mini loopTagInfo" id="loopTagInfo"></div>
      <div class="loopSaved" id="loopSaved"></div>
    </section>

    <section class="gasCard gasInputCard gasO2" aria-labelledby="loopValTitle">
      <div class="gasCardHead"><h2 id="loopValTitle">${TX("Значение")}</h2><span class="gasHeadNote" id="loopValNote"></span></div>
      <div class="loopFields" id="loopFields"></div>
      <div class="loopPair">
        <div class="loopReadout loopCurrent">
          <label for="loopF_mA">${TX("Ток")}</label>
          <div class="gasValueRow"><input id="loopF_mA" class="gasValueInput" data-field="mA" inputmode="decimal" autocomplete="off" enterkeyhint="done"/><span class="gasValueUnit">${U("мА")}</span></div>
        </div>
        <div class="loopReadout">
          <label for="loopF_pct">${TX("Шкала")}</label>
          <div class="gasValueRow"><input id="loopF_pct" class="gasValueInput" data-field="pct" inputmode="decimal" autocomplete="off" enterkeyhint="done"/><span class="gasValueUnit">%</span></div>
        </div>
      </div>
      <div class="loopTrack" aria-hidden="true"><span class="loopZone"></span><span class="loopFill" id="loopFill"></span><span class="loopMarker" id="loopMarker"></span></div>
      <div class="loopTicks" aria-hidden="true"><span style="left:10%">4</span><span style="left:30%">8</span><span style="left:50%">12</span><span style="left:70%">16</span><span style="left:90%">20</span></div>
      <div class="gasMaStatus" id="loopStatus" role="status"></div>
      <div class="mini loopClamp" id="loopClamp"></div>
      <div class="gasActions gasActions3">
        <button type="button" class="action iconOnly" id="loopCopy" aria-label="${TX("Копировать результат")}" title="${TX("Копировать результат")}">${ICON.copy}</button>
        <button type="button" class="action" id="loopTask" title="${TX("Дописать результат в задание тега (поле «Тег» выше)")}">${ICON.task}<span>${TX("В задание")}</span></button>
        <button type="button" class="action primary" id="loopShare">${ICON.send}<span>${TX("Отправить")}</span></button>
      </div>
    </section>
  </div>

  <div class="gasCol">
    <section class="gasCard gasO3" aria-labelledby="loopScaleTitle">
      <div class="gasCardHead"><h2 id="loopScaleTitle">${TX("Шкала")}</h2><span class="gasHeadNote" id="loopScaleNote"></span></div>

      <div class="loopBlock" data-block="TT">
        <div class="gasScaleRow">
          <div class="field"><label for="loopC_TT_mat">${TX("НСХ")}</label><select id="loopC_TT_mat" data-cfg="TT.mat">${matOpts}</select></div>
          <div class="field"><label for="loopC_TT_r0" id="loopTTr0Lbl">${TX("R₀ при 0 °C, Ом")}</label><select id="loopC_TT_r0" data-cfg="TT.r0"><option>50</option><option>100</option><option>500</option><option>1000</option></select></div>
        </div>
        <div class="loopLabel">${TX("Единицы температуры")}</div>
        ${seg("TT.tu",["C","°C · Цельсий"],["F","°F · Фаренгейт"])}
        <div class="gasScaleRow">${signedField("TT.lrv","НПИ (4 мА), °C")}${numField("TT.urv","ВПИ (20 мА), °C")}</div>
        <div class="gasChips loopPresets" id="loopTTPre" role="group" aria-label="${TX("Типовые шкалы, °C")}">${ttPre}</div>
        <div class="loopLabel">${TX("Выход линеен по")}</div>
        ${seg("TT.lin",["T","температуре"],["R","сопротивлению"])}
        <div class="mini">${TX("HART-преобразователи линейны по температуре. По сопротивлению — нормирующие преобразователи без линеаризации.")}</div>
      </div>

      <div class="loopBlock" data-block="PT">
        <div class="field"><label for="loopC_PT_unit">${TX("Единицы")}</label><select id="loopC_PT_unit" data-cfg="PT.unit">${puOpts}</select></div>
        <div class="gasScaleRow">${signedField("PT.lrv","НПИ (4 мА)")}${numField("PT.urv","ВПИ (20 мА)")}</div>
        <div class="gasChips loopPresets" role="group" aria-label="${TX("Типовые шкалы, МПа")}">${ptPre}</div>
        <div class="mini">${TX("Кнопки — шкалы в МПа, переводятся в выбранные единицы. Отрицательный НПИ — мановакуумметрическая шкала. При смене единиц физический диапазон сохраняется.")}</div>
      </div>

      <div class="loopBlock" data-block="FT">
        ${seg("FT.kind",["dp","по перепаду (СУ)"],["lin","линейный"])}
        <div class="gasScaleRow">
          ${signedField("FT.qmin","Qmin (4 мА)",' data-when="FT.kind=lin"')}
          ${numField("FT.dpmax","ΔPmax (20 мА), кПа",' data-when="FT.kind=dp"')}
          ${numField("FT.qmax","Qmax (20 мА)")}
        </div>
        <div class="field"><label for="loopC_FT_qunit">${TX("Единицы расхода")}</label><select id="loopC_FT_qunit" data-cfg="FT.qunit">${quOpts}</select></div>
        <div data-when="FT.kind=dp">
          <div class="loopLabel">${TX("Корень извлекается")}</div>
          ${seg("FT.root",["tx","в преобразователе"],["dcs","в РСУ"])}
          <div class="mini">${TX("Если корень в преобразователе — ток линеен по расходу, в РСУ блок SQRT не нужен. Проверьте, что корень не извлекается дважды.")}</div>
        </div>
        <div class="mini" data-when="FT.kind=lin">${TX("Электромагнитные, вихревые, кориолисовы, ультразвуковые: ток линеен по расходу.")}</div>
      </div>

      <div class="loopBlock" data-block="LT">
        ${seg("LT.kind",["direct","прямой"],["hydro","гидростатика (ΔP)"])}
        <div class="field" data-when="LT.kind=direct"><label for="loopC_LT_unit">${TX("Единицы")}</label><select id="loopC_LT_unit" data-cfg="LT.unit"><option value="мм">${U("мм")}</option><option value="м">${U("м")}</option><option value="%">%</option></select></div>
        <div class="gasScaleRow">${signedField("LT.lrv","Низ шкалы (4 мА)")}${numField("LT.urv","Верх шкалы (20 мА)")}</div>
        <div data-when="LT.kind=hydro">
          <div class="gasScaleRow">${numField("LT.rho","Плотность, кг/м³")}${signedField("LT.off","Смещение ΔP, кПа")}</div>
          <div class="loopResult" id="loopHydro"></div>
          <div class="mini">${TX("Уровень — от оси нижнего отбора, мм. Смещение — ΔP при уровне на оси нижнего отбора: для открытой ёмкости 0, для мокрой опорной ветви или капилляров обычно отрицательное.")}</div>
        </div>
        <div class="mini" data-when="LT.kind=direct">${TX("Радарные, буйковые, магнитострикционные: ток линеен по уровню.")}</div>
      </div>
    </section>

    <section class="gasCard gasO4" aria-labelledby="loopCalTitle">
      <div class="gasCardHead"><h2 id="loopCalTitle">${TX("Точки поверки")}</h2><span class="gasHeadNote">0–25–50–75–100 %</span></div>
      <div class="loopTableWrap"><table class="loopTable"><thead id="loopCalHead"></thead><tbody id="loopCal"></tbody></table></div>
      <div class="mini" id="loopCalHint"></div>
    </section>

  </div>
</div>
<div class="convFoot"><button type="button" class="convInfoBtn" id="loopSources">${ICON.book}<span>${TX("Источники и формулы")}</span></button></div>`;
}

// v98: короткая справка — формулы и откуда взяты данные (кнопка внизу страницы).
const SOURCES_HTML=`
<h3>Формулы</h3>
<div class="hF">I = 4 + 16 · x, мА</div>
<p class="mini">x — доля шкалы от 0 до 1.</p>
<p><b>Термосопротивления Pt и П</b> (Каллендар — Ван Дюзен):</p>
<div class="hF">t ≥ 0: R = R₀ · (1 + A·t + B·t²)<br>t &lt; 0: R = R₀ · (1 + A·t + B·t² + C·(t − 100)·t³)</div>
<p class="mini">α 0,00385: A = 3,9083·10⁻³, B = −5,775·10⁻⁷, C = −4,183·10⁻¹². α 0,00391: A = 3,9690·10⁻³, B = −5,841·10⁻⁷, C = −4,330·10⁻¹².</p>
<p><b>Медь М</b>, α 0,00428:</p>
<div class="hF">t ≥ 0: R = R₀ · (1 + α·t)<br>t &lt; 0: R = R₀ · (1 + A·t + B·t·(t + 6,7) + C·t³)</div>
<p class="mini">A = 4,28·10⁻³, B = −6,2032·10⁻⁷, C = 8,5154·10⁻¹⁰.</p>
<p><b>Градусы Фаренгейта</b> — шкала и значения пересчитываются, НСХ считается в °C:</p>
<div class="hF">t°F = t°C · 9/5 + 32<br>t°C = (t°F − 32) · 5/9</div>
<p class="mini">0 °C = 32 °F · 100 °C = 212 °F · −40 °C = −40 °F. Крутизна на 1 °F в 1,8 раза меньше, чем на 1 °C.</p>
<p><b>Расход по перепаду</b> (сужающее устройство):</p>
<div class="hF">Q = Q<sub>max</sub> · √(ΔP / ΔP<sub>max</sub>)</div>
<p><b>Уровень гидростатикой</b>, g = 9,80665 м/с²:</p>
<div class="hF">ΔP = ρ · g · h + смещение</div>
<p class="mini">1 кгс/см² = 98,0665 кПа · 1 бар = 100 кПа · 1 мм вод. ст. = 9,80665 Па · 1 мм рт. ст. = 133,3224 Па · 1 psi = 6,894757 кПа.</p>
<h3>Откуда данные</h3>
<ul class="hSrc">
<li>Сигнал 4–20 мА — <span class="nw">ГОСТ 26.011-80</span>, <span class="nw">IEC 60381-1</span>.</li>
<li>Состояние сигнала — <span class="nw">NAMUR NE 43</span>: <span class="nw">3,8…20,5 мА</span> — измерение, <span class="nw">≤ 3,6</span> и <span class="nw">≥ 21 мА</span> — отказ.</li>
<li>НСХ термосопротивлений — <span class="nw">ГОСТ 6651-2009</span>, <span class="nw">IEC 60751</span>.</li>
<li>Расход на сужающих устройствах — <span class="nw">ГОСТ 8.586.1-2005</span>.</li>
<li>Единицы давления — <span class="nw">ГОСТ 8.417-2002</span>.</li>
</ul>
<h3>Ограничения</h3>
<p>Шкалу берите из конфигурации преобразователя (HART) или карты уставок — на ПНР их часто меняют. Расход по перепаду — без поправок на плотность и расширение среды.</p>
<p class="helpNote">Считается на телефоне, без интернета.</p>`;
const SOURCES_HTML_EN=`
<h3>Formulas</h3>
<div class="hF">I = 4 + 16 · x, mA</div>
<p class="mini">x — fraction of span from 0 to 1.</p>
<p><b>Pt and P RTDs</b> (Callendar — Van Dusen):</p>
<div class="hF">t ≥ 0: R = R₀ · (1 + A·t + B·t²)<br>t &lt; 0: R = R₀ · (1 + A·t + B·t² + C·(t − 100)·t³)</div>
<p class="mini">α 0.00385: A = 3.9083·10⁻³, B = −5.775·10⁻⁷, C = −4.183·10⁻¹². α 0.00391: A = 3.9690·10⁻³, B = −5.841·10⁻⁷, C = −4.330·10⁻¹².</p>
<p><b>Copper Cu (M)</b>, α 0.00428:</p>
<div class="hF">t ≥ 0: R = R₀ · (1 + α·t)<br>t &lt; 0: R = R₀ · (1 + A·t + B·t·(t + 6.7) + C·t³)</div>
<p class="mini">A = 4.28·10⁻³, B = −6.2032·10⁻⁷, C = 8.5154·10⁻¹⁰.</p>
<p><b>Degrees Fahrenheit</b> — range and values are converted, the RTD curve is computed in °C:</p>
<div class="hF">t°F = t°C · 9/5 + 32<br>t°C = (t°F − 32) · 5/9</div>
<p class="mini">0 °C = 32 °F · 100 °C = 212 °F · −40 °C = −40 °F. Slope per 1 °F is 1.8 times smaller than per 1 °C.</p>
<p><b>DP flow</b> (primary element, e.g. orifice):</p>
<div class="hF">Q = Q<sub>max</sub> · √(ΔP / ΔP<sub>max</sub>)</div>
<p><b>Hydrostatic level</b>, g = 9.80665 m/s²:</p>
<div class="hF">ΔP = ρ · g · h + offset</div>
<p class="mini">1 kgf/cm² = 98.0665 kPa · 1 bar = 100 kPa · 1 mmH₂O = 9.80665 Pa · 1 mmHg = 133.3224 Pa · 1 psi = 6.894757 kPa.</p>
<h3>Data sources</h3>
<ul class="hSrc">
<li>4–20 mA signal — <span class="nw">GOST 26.011-80</span>, <span class="nw">IEC 60381-1</span>.</li>
<li>Signal status — <span class="nw">NAMUR NE 43</span>: <span class="nw">3.8…20.5 mA</span> — measurement, <span class="nw">≤ 3.6</span> and <span class="nw">≥ 21 mA</span> — failure.</li>
<li>RTD curves — <span class="nw">GOST 6651-2009</span>, <span class="nw">IEC 60751</span>.</li>
<li>Flow by differential pressure — <span class="nw">GOST 8.586.1-2005</span> (ISO 5167-1).</li>
<li>Pressure units — <span class="nw">GOST 8.417-2002</span>.</li>
</ul>
<h3>Limitations</h3>
<p>Take the range from the transmitter configuration (HART) or the setpoint list — it is often changed during commissioning. DP flow — without density and expansibility corrections.</p>
<p class="helpNote">Calculated on the phone, offline.</p>`;

// ---------------------------------------------------------------- отрисовка
let fieldSig="";
function buildFields(){
  const fs=M().fields(C());
  const s=state.kind+"|"+fs.map(f=>f.k+f.u+(f.sign?"±":"")).join(",");
  if(s===fieldSig)return;
  fieldSig=s;
  $("loopFields").innerHTML=fs.map((f,i)=>`
    <div class="loopReadout${i===0?" loopMain":""}">
      <label for="loopF_${f.k}">${esc(TX(f.l))}</label>
      <div class="gasValueRow">
        <input id="loopF_${f.k}" class="gasValueInput" data-field="${f.k}" inputmode="decimal" autocomplete="off" enterkeyhint="done"/>
        <span class="gasValueUnit">${esc(U(f.u))}</span>
        ${f.sign?`<button type="button" class="gasClear loopSignBtn" data-sign="loopF_${f.k}" aria-label="${TX("Сменить знак")}" title="${TX("Плюс / минус")}">±</button>`:""}
      </div>
      <div class="loopNote" id="loopN_${f.k}"></div>
    </div>`).join("");
  fs.forEach(f=>{delete els["loopF_"+f.k];delete els["loopN_"+f.k];});
}
function setVal(id,value,skip){const el=$(id);if(el&&id!==skip&&document.activeElement!==el)el.value=value;}
function render(skip){
  if(!root)return;
  const c=C(),m=M();
  buildFields();
  const fs=m.fields(c),v=m.vals(state.p,c),notes=m.notes(v,c),mA=4+16*state.p;
  fs.forEach(f=>{
    if(skip!=="loopF_"+f.k)setVal("loopF_"+f.k,fin(v[f.k],f.d));
    const n=$("loopN_"+f.k);if(n)n.innerHTML=notes[f.k]||"";
  });
  setVal("loopF_mA",fin(mA,3),skip);
  setVal("loopF_pct",fin(state.p*100,2),skip);

  // Тип прибора и строка конфигурации.
  root.querySelectorAll(".loopKind").forEach(b=>{
    const on=b.dataset.kind===state.kind;
    b.classList.toggle("active",on);b.setAttribute("aria-selected",String(on));
  });
  $("loopCfgLine").textContent=m.sum(c);
  $("loopValNote").textContent=state.tag?state.tag:TX(KIND_NAME[state.kind]);
  $("loopScaleNote").textContent=TX(KIND_NAME[state.kind]);
  root.querySelectorAll("[data-block]").forEach(el=>{el.hidden=el.dataset.block!==state.kind;});
  root.querySelectorAll("[data-when]").forEach(el=>{
    const [md,rest]=el.dataset.when.split(".");const [k,val]=rest.split("=");
    el.hidden=String(state.cfg[md][k])!==val;
  });
  root.querySelectorAll("[data-set]").forEach(b=>{
    const [path,val]=b.dataset.set.split("=");const [md,k]=path.split(".");
    const on=String(state.cfg[md][k])===val;
    b.classList.toggle("active",on);b.setAttribute("aria-pressed",String(on));
  });
  root.querySelectorAll("[data-pre]").forEach(b=>{
    const md=b.dataset.pre,cc=state.cfg[md];
    const f=md==="PT"?1e6/PUK.get(cc.unit):1;
    const on=Math.abs(+b.dataset.l*f-cc.lrv)<1e-9&&Math.abs(+b.dataset.u*f-cc.urv)<1e-9;
    b.classList.toggle("active",on);b.setAttribute("aria-pressed",String(on));
  });
  // v108: подписи шкалы TT и типовые шкалы — в выбранных единицах температуры.
  const tt=state.cfg.TT,tu=TU(tt);
  const ttL=root.querySelector('label[for="loopC_TT_lrv"]'),ttU=root.querySelector('label[for="loopC_TT_urv"]');
  if(ttL)ttL.textContent=TX("НПИ (4 мА), {0}",tu);
  if(ttU)ttU.textContent=TX("ВПИ (20 мА), {0}",tu);
  $("loopTTr0Lbl").textContent=isF(tt)?TX("R₀ при 0 °C (32 °F), Ом"):TX("R₀ при 0 °C, Ом");
  $("loopTTPre").setAttribute("aria-label",TX("Типовые шкалы, {0}",tu));
  root.querySelectorAll('[data-pre="TT"]').forEach(b=>{b.hidden=b.dataset.tu!==(tt.tu||"C");});
  const lt=state.cfg.LT;
  $("loopHydro").innerHTML=TX("Настроить преобразователь: НПИ <b>{0}</b> кПа, ВПИ <b>{1}</b> кПа",sig(dPh(lt.lrv,lt)),sig(dPh(lt.urv,lt)));
  const ltLbl=root.querySelector('label[for="loopC_LT_lrv"]'),ltLbl2=root.querySelector('label[for="loopC_LT_urv"]');
  if(ltLbl)ltLbl.textContent=lt.kind==="hydro"?TX("Низ шкалы (4 мА), мм"):TX("Низ шкалы (4 мА)");
  if(ltLbl2)ltLbl2.textContent=lt.kind==="hydro"?TX("Верх шкалы (20 мА), мм"):TX("Верх шкалы (20 мА)");

  // Положение в петле: ось 2…22 мА.
  const pos=x=>((Math.min(22,Math.max(2,x))-2)/20*100);
  const out=Math.min(20.5,Math.max(3.8,mA));
  $("loopFill").style.width=Math.max(0,pos(Math.min(out,20))-pos(4))+"%";
  $("loopMarker").style.left=pos(out)+"%";
  const n=namur(mA);
  $("loopStatus").className=`gasMaStatus ${n.cls}`;
  $("loopStatus").textContent=n.text;
  $("loopClamp").textContent=Number.isFinite(mA)&&(mA<3.8||mA>20.5)?TX("Реальный выход упрётся в насыщение ≈ {0} мА",fx(out,1)):"";

  // Точки поверки.
  $("loopCalHead").innerHTML=`<tr><th>%</th>${fs.map(f=>`<th>${esc(U(f.u))}</th>`).join("")}<th>${U("мА")}</th></tr>`;
  $("loopCal").innerHTML=[0,25,50,75,100].map(pc=>{
    const vv=m.vals(pc/100,c);
    const on=Math.abs(state.p-pc/100)<1e-9;
    return `<tr data-p="${pc/100}"${on?' class="active"':""}><td>${pc}</td>${fs.map((f,j)=>`<td${j===0?' class="loopCellMain"':""}>${fx(vv[f.k],f.d)}</td>`).join("")}<td class="loopCellI">${fx(4+16*pc/100,3)}</td></tr>`;
  }).join("");
  $("loopCalHint").textContent=`${TX(m.cal)} ${TX("Нажмите строку — значения перейдут в «Значение».")}`;
}
function syncCfgInputs(){
  root.querySelectorAll("[data-cfg]").forEach(el=>{
    if(document.activeElement===el)return;
    const [md,k]=el.dataset.cfg.split(".");const val=state.cfg[md][k];
    el.value=typeof val==="number"&&el.tagName!=="SELECT"?frIn(val):String(val);
  });
}
function renderTagInfo(text){$("loopTagInfo").textContent=text||"";}
function renderSaved(){
  const names=Object.keys(state.tags).filter(n=>MODES[state.tags[n]?.kind]).sort((a,b)=>a.localeCompare(b,"ru",{numeric:true}));
  const box=$("loopSaved");
  box.hidden=!names.length;
  box.innerHTML=names.map(n=>{
    const r=state.tags[n],cfg={...DEF[r.kind],...r.cfg};
    const on=n===state.tag;
    return `<span class="loopSavedItem${on?" active":""}"><button type="button" class="loopSavedMain" data-load="${esc(n)}"><b>${esc(n)}</b><span>${esc(MODES[r.kind].sum(cfg))}</span></button><button type="button" class="loopSavedDel" data-del="${esc(n)}" aria-label="${esc(TX("Удалить {0}",n))}" title="${TX("Удалить")}">${ICON.x}</button></span>`;
  }).join("");
}
// v97: подсказки тегов под полем (общий компонент из app.js) вместо <datalist>.
// Сначала теги, у которых тип определяется (TT/PT/FT/LT).
let tagPicker=null;
function refreshTagList(){
  const input=$("loopTag");if(!input)return;
  const app=window.TagListApp;
  if(!tagPicker&&app?.attachTagPicker)tagPicker=app.attachTagPicker(input,{anchor:input.closest(".gasJoin")||input,boost:t=>detectKind(t)?1:0});
  tagPicker?.refresh();
}

// ---------------------------------------------------------------- действия
function toast(t){try{window.showToast?.(t);}catch(_){}}
async function copyText(text,label){
  try{
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
    else{
      const ta=document.createElement("textarea");ta.value=text;ta.setAttribute("readonly","");ta.style.position="fixed";ta.style.opacity="0";
      document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();
    }
    toast(label||TX("Скопировано"));
  }catch(_){toast(TX("Не удалось скопировать"));}
}
function summaryText(){
  const c=C(),m=M(),fs=m.fields(c),v=m.vals(state.p,c),mA=4+16*state.p;
  const head=`${state.tag?state.tag+" — ":""}${state.kind} ${m.sum(c)}`;
  const vals=fs.map(f=>`${fx(v[f.k],f.d)} ${U(f.u)}`);
  vals.push(`${fx(mA,3)} ${U("мА")} (${fx(state.p*100,2)} %)`);
  return plain(`${head}\n${vals.join(" = ")}\n${namur(mA).text}`);
}
// Короткая строка для задания тега: тип, шкала, значения и ток.
function taskText(){
  const c=C(),m=M(),fs=m.fields(c),v=m.vals(state.p,c),mA=4+16*state.p;
  const vals=fs.map(f=>`${fx(v[f.k],f.d)} ${U(f.u)}`);
  vals.push(`${fx(mA,3)} ${U("мА")} (${fx(state.p*100,2)} %)`);
  const n=namur(mA);
  return plain(`4–20 ${U("мА")}, ${state.kind} ${m.sum(c)}: ${vals.join(" = ")}${n.cls==="gasOk"?"":` — ${n.text}`}`);
}
function saveToTask(){
  const tag=String($("loopTag").value||"").trim();
  if(!tag){toast(TX("Укажите тег — результат запишется в его задание"));$("loopTag").focus();return;}
  const app=window.TagListApp;
  if(!app?.addResultToTag){toast(TX("Список тэгов недоступен"));return;}
  const r=app.addResultToTag(tag,taskText());
  if(!r.ok){toast(r.message||TX("Не удалось записать"));return;}
  toast(r.created?TX("Создан тэг {0} на странице «{1}», результат — в задании",r.tag,r.page):TX("Записано в задание {0}",r.tag));
  refreshTagList();
}
async function shareSummary(){
  const text=summaryText();
  try{
    if(typeof navigator.share==="function"){await navigator.share({title:TX("Сигнал 4–20 мА"),text});toast(TX("Результат передан"));return;}
  }catch(e){if(e?.name==="AbortError")return;}
  await copyText(text,TX("Результат скопирован"));
}
function setKind(kind){
  if(!MODES[kind]||kind===state.kind)return;
  state.kind=kind;persist();render();
}
function applyTag(name,rec){
  state.kind=rec.kind;
  state.cfg[rec.kind]={...DEF[rec.kind],...(rec.cfg||{})};
  state.tag=name;
  syncCfgInputs();persist();render();renderSaved();
}
function onTagInput(value){
  const n=String(value||"").trim();
  state.tag=n;
  if(n&&state.tags[n]){applyTag(n,state.tags[n]);renderTagInfo(TX("Загружена сохранённая шкала {0}.",n));return;}
  const k=detectKind(n);
  if(k){if(k!==state.kind)state.kind=k;renderTagInfo(TX("По тегу: {0} ({1}). Задайте шкалу и сохраните.",TX(KIND_NAME[k]),k));}
  else renderTagInfo(n?TX("Тип по тегу не определён — выберите его выше."):"");
  persist();render();renderSaved();
}
function saveTag(){
  const n=String($("loopTag").value||"").trim();
  if(!n){$("loopTag").focus();toast(TX("Введите тег"));return;}
  state.tag=n;
  state.tags[n]={kind:state.kind,cfg:clone(C())};
  persist();renderSaved();render();
  renderTagInfo(TX("Шкала сохранена: {0}.",n));
  toast(TX("Сохранено: {0}",n));
}
function setCfgNumber(path,raw){
  const [md,k]=path.split(".");const c=state.cfg[md];const v=parseNum(raw);
  if(!Number.isFinite(v))return;
  const old=c[k];c[k]=v;
  const ok=(k==="lrv"||k==="urv")?c.urv!==c.lrv
    :k==="qmax"?c.qmax!==0&&c.qmax!==c.qmin
    :k==="qmin"?c.qmax!==c.qmin
    :(k==="dpmax"||k==="rho")?v>0:true;
  if(!ok){c[k]=old;return;}
  persist();render();
}
function toggleSign(id){
  const el=root.querySelector("#"+id);if(!el)return;
  const s=String(el.value||"").trim();
  el.value=/^[-−]/.test(s)?s.replace(/^[-−]\s*/,""):`-${s||"0"}`;
  el.dispatchEvent(new Event("input",{bubbles:true}));
}

function bind(){
  root.addEventListener("click",e=>{
    const t=e.target.closest("button,tr[data-p]");
    if(!t||!root.contains(t)||t.disabled)return;
    if(t.matches("tr[data-p]")){
      state.p=Number(t.dataset.p);persist();render();
      const card=root.querySelector(".gasInputCard");
      try{card.scrollIntoView({block:"center",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});}catch(_){}
      card.classList.remove("gasFlash");void card.offsetWidth;card.classList.add("gasFlash");
      return;
    }
    if(t.dataset.kind){setKind(t.dataset.kind);return;}
    if(t.dataset.sign){toggleSign(t.dataset.sign);return;}
    if(t.dataset.set){
      const [path,val]=t.dataset.set.split("=");const [md,k]=path.split(".");const c=state.cfg[md];
      // v108: смена °C ⇄ °F — физическая шкала сохраняется (0…150 °C → 32…302 °F).
      if(md==="TT"&&k==="tu"&&val!==(c.tu||"C")){
        const cv=val==="F"?cToF:fToC;
        c.lrv=+cv(c.lrv).toFixed(4);c.urv=+cv(c.urv).toFixed(4);
      }
      if(md==="LT"&&k==="kind"&&val==="hydro"&&c.kind!=="hydro"){
        if(c.unit==="м"){c.lrv*=1000;c.urv*=1000;}else if(c.unit==="%"){c.lrv=0;c.urv=2000;}
        c.unit="мм";
      }
      c[k]=val;syncCfgInputs();persist();render();return;
    }
    if(t.dataset.pre){
      const md=t.dataset.pre,c=state.cfg[md];
      const f=md==="PT"?1e6/PUK.get(c.unit):1;
      c.lrv=+(+t.dataset.l*f).toPrecision(6);c.urv=+(+t.dataset.u*f).toPrecision(6);
      syncCfgInputs();persist();render();return;
    }
    if(t.dataset.load!=null){
      const n=t.dataset.load,rec=state.tags[n];
      if(rec){$("loopTag").value=n;applyTag(n,rec);renderTagInfo(TX("Загружена сохранённая шкала {0}.",n));tagPicker?.refresh();}
      return;
    }
    if(t.dataset.del!=null){
      const n=t.dataset.del;delete state.tags[n];persist();renderSaved();toast(TX("Удалено: {0}",n));return;
    }
    switch(t.id){
      case "loopSave":saveTag();break;
      case "loopCopy":copyText(summaryText(),TX("Результат скопирован"));break;
      case "loopShare":shareSummary();break;
      case "loopTask":saveToTask();break;
      case "loopSources":window.TagListApp?.openInfo?.(TX("Источники и формулы"),isEn()?SOURCES_HTML_EN:SOURCES_HTML);break;
    }
  });
  root.addEventListener("input",e=>{
    const t=e.target;
    if(t.id==="loopTag"){onTagInput(t.value);return;}
    if(t.dataset.field){
      const v=parseNum(t.value);if(!Number.isFinite(v))return;
      const k=t.dataset.field;
      const p=k==="mA"?(v-4)/16:k==="pct"?v/100:M().toP(k,v,C());
      if(Number.isFinite(p)){state.p=p;persist();render(t.id);}
      return;
    }
    if(t.dataset.cfg&&t.tagName==="INPUT")setCfgNumber(t.dataset.cfg,t.value);
  });
  root.addEventListener("change",e=>{
    const t=e.target;
    if(!t.dataset.cfg||t.tagName!=="SELECT")return;
    const [md,k]=t.dataset.cfg.split(".");const c=state.cfg[md];
    if(md==="PT"&&k==="unit"){
      const f=PUK.get(c.unit)/PUK.get(t.value);
      c.lrv=+(c.lrv*f).toPrecision(6);c.urv=+(c.urv*f).toPrecision(6);c.unit=t.value;
    }else if(k==="r0")c.r0=Number(t.value);
    else c[k]=t.value;
    t.blur();syncCfgInputs();persist();render();
  });
  // Касание поля выделяет значение целиком — новое число сразу заменяет старое.
  // Выделяем, только если пользователь ещё ничего не ввёл (иначе потеряется первая цифра).
  root.addEventListener("focusin",e=>{
    const el=e.target;if(!el.matches(".gasValueInput"))return;
    const before=el.value;
    setTimeout(()=>{if(document.activeElement===el&&el.value===before){try{el.select();}catch(_){}}},0);
  });
  root.addEventListener("focusout",e=>{
    if(e.target.matches(".gasValueInput"))setTimeout(()=>render(),0);
    else if(e.target.dataset?.cfg)setTimeout(syncCfgInputs,0);
  });
  root.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches("input")){e.preventDefault();e.target.blur();}});
}

let boundRoot=null;
function mount(container,opts={}){
  if(typeof opts.getTags==="function")getTags=opts.getTags;
  // v100: раздел уже размечен — обновление делает onShow() сразу после mount().
  if(root&&root===container&&root.firstElementChild)return;
  root=container;build();
}
function build(){
  els={};fieldSig="";tagPicker=null;
  root.innerHTML=template();
  if(boundRoot!==root){bind();boundRoot=root;}
  $("loopTag").value=state.tag||"";
  syncCfgInputs();refreshTagList();renderSaved();render();
  if(state.tag&&state.tags[state.tag])renderTagInfo(TX("Шкала {0} из сохранённых.",state.tag));
}
// v107: смена языка — раздел размечается заново на новом языке (состояние сохраняется).
window.addEventListener("tl-langchange",()=>{if(root&&root.firstElementChild){flush();build();}});

// v100: приложение свернули сразу после ввода — значение не теряется.
window.addEventListener("pagehide",flush);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")flush();});

window.TagListLoop={
  version:"108",
  mount,
  onShow(){refreshTagList();syncCfgInputs();render();},
  onHide(){flush();},
  // Для тестов и отладки.
  _api:{Rt,Tr,ttP,ttT,detectKind,namur,MODES,DEF,summaryText,get state(){return state;}}
};
})();
