/* Tag list v106 — конвертор «Электроэнергетика»: мощность и ток, двигатель,
   потеря напряжения в кабеле, учёт через ТТ/ТН.
   Загружается по требованию при переключении раздела. Работает полностью на устройстве.

   В каждой вкладке задаются любые значения, кроме одного, — оно считается.
   Считается поле, которое трогали давнее всех (метка «расчёт»).

     P·I  3ф: P = √3·U·I·cosφ;  1ф: P = U·I·cosφ
     M    P₂ = √3·U·I·cosφ·η (1ф — без √3)
     ΔU   3ф: ΔU = √3·I·L·(r·cosφ + x·sinφ);  1ф: 2·I·L·(…);  r = ρ/S
     ТТ   W = (Wкон − Wнач)·Kтт·Kтн
*/
(function(){
"use strict";

// v107: язык интерфейса — js/i18n.js (TX). Единицы в состоянии хранятся по-русски («кВ»), на экран — через TX.
const TX=typeof window.TX==="function"?window.TX:(s,...a)=>String(s??"").replace(/\{(\d+)\}/g,(m,i)=>a[i]!==undefined?String(a[i]):m);
const DEC=()=>window.I18N?window.I18N.dec:",";
const isEn=()=>!!window.I18N?.en;

const STORE_KEY="kip-elec-converter-v1";
const SQ3=Math.sqrt(3);

// ---------------------------------------------------------------- числа
function num(v){
  const s=String(v??"").replace(/[\s  ]/g,"").replace(/,/g,".").replace(/[−–]/g,"-");
  if(!s||s==="-"||s===".")return NaN;
  if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s))return NaN;
  return Number(s);
}
// Число для показа: до 4 значащих цифр (или dmax знаков после запятой), разряды — узким пробелом.
function fmt(v,dmax){
  if(!Number.isFinite(v))return "";
  let s;
  if(dmax!=null)s=String(+v.toFixed(dmax));
  else if(Math.abs(v)>=10000)s=String(Math.round(v));
  else s=String(+v.toPrecision(4));
  if(/e/i.test(s))s=String(+v.toFixed(6));
  const [i,f]=s.split(".");
  const ii=i.replace(/\B(?=(\d{3})+(?!\d))/g," ");
  return (f?ii+DEC()+f:ii).replace("-","−");
}
const fin=(v,d)=>fmt(v,d).replace("−","-");
const dash=s=>s===""?"—":s;
const plain=s=>String(s).replace(/−/g,"-").replace(/ /g," ");
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

// ---------------------------------------------------------------- единицы (в состоянии — СИ)
const UNITS={
  V:[["В",1],["кВ",1e3]],
  A:[["А",1],["кА",1e3]],
  W:[["кВт",1e3],["Вт",1],["МВт",1e6]],
  E:[["кВт·ч",1],["МВт·ч",1e3]],
  L:[["м",1],["км",1e3]],
  S:[["мм²",1]],
  X:[["",1]],
  P:[["%",1]]
};

// ---------------------------------------------------------------- справочные данные
const SECTIONS=[1.5,2.5,4,6,10,16,25,35,50,70,95,120,150,185,240,300];
const RHO={cu:0.021,al:0.034};           // Ом·мм²/м при 70 °C
const X0=0.08e-3;                          // Ом/м — индуктивное сопротивление кабеля
const TT1=[5,10,15,20,30,40,50,75,100,150,200,300,400,500,600,750,800,1000,1200,1500,2000,3000,4000];
const TN=[["1","Нет (0,4 кВ)"],["60","6000/100 → 60"],["63","6300/100 → 63"],["100","10000/100 → 100"],["105","10500/100 → 105"],["350","35000/100 → 350"],["1100","110000/100 → 1100"]];
const AWG=[20,18,16,14,12,10,8,6,4,3,2,1,0,-1,-2,-3];
const awgName=n=>n>0?String(n):n===0?"1/0":n===-1?"2/0":n===-2?"3/0":"4/0";
const awgMm2=n=>{const d=0.127*Math.pow(92,(36-n)/39);return Math.PI/4*d*d;};
const P_STD=[0.75,1.1,1.5,2.2,3,4,5.5,7.5,11,15,18.5,22,30,37,45,55,75,90,110,132,160,200,250,315];
const U3=[[400,"400 В"],[690,"690 В"],[6000,"6 кВ"],[10000,"10 кВ"],[380,"380 В"]];
const U1=[[230,"230 В"],[220,"220 В"],[24,"24 В"]];
const HOURS=[[24,"сутки"],[168,"неделя"],[720,"30 дней"],[744,"31 день"],[8760,"год"]];

// ---------------------------------------------------------------- вкладки: поля и решатели
let S=null;
const kU=()=>S.ph===3?SQ3:1;
function metK(){const m=S.met;return m.sec?(m.tt1/m.tt2)*(+m.tn):1;}
const KINDS={
  pi:{b:"P·I",s:"мощность",net:true,uField:true,
    fields:[
      {k:"U",l:()=>S.ph===3?"Напряжение линейное":"Напряжение фазное",u:"V"},
      {k:"I",l:()=>"Ток",u:"A"},
      {k:"P",l:()=>"Активная мощность",u:"W"},
      {k:"c",l:()=>"cosφ",u:"X",lim:[0,1],d:3}
    ],
    solve(t,v){const k=kU();
      if(t==="P")return k*v.U*v.I*v.c;
      if(t==="I")return v.P/(k*v.U*v.c);
      if(t==="U")return v.P/(k*v.I*v.c);
      if(t==="c")return v.P/(k*v.U*v.I);}
  },
  mot:{b:"M",s:"двигатель",net:true,
    fields:[
      {k:"P",l:()=>"Мощность на валу P₂",u:"W"},
      {k:"I",l:()=>"Номинальный ток",u:"A"},
      {k:"c",l:()=>"cosφ",u:"X",lim:[0,1],d:3},
      {k:"e",l:()=>"КПД η",u:"X",lim:[0,1],d:3}
    ],
    solve(t,v){const k=kU()*S.U;
      if(t==="P")return k*v.I*v.c*v.e;
      if(t==="I")return v.P/(k*v.c*v.e);
      if(t==="c")return v.P/(k*v.I*v.e);
      if(t==="e")return v.P/(k*v.I*v.c);}
  },
  cab:{b:"ΔU",s:"кабель",net:true,
    fields:[
      {k:"S",l:()=>"Сечение жилы",u:"S",d:2},
      {k:"L",l:()=>"Длина линии",u:"L"},
      {k:"I",l:()=>"Ток нагрузки",u:"A"},
      {k:"d",l:()=>"Потеря напряжения ΔU",u:"P",d:2}
    ],
    solve(t,v){
      const m=S.ph===3?SQ3:2,c=Math.min(1,Math.max(0.01,S.cab.cos)),sn=Math.sqrt(1-c*c),rho=RHO[S.cab.mat];
      const z=s=>rho/s*c+X0*sn;
      const du=v.d/100*S.U;
      if(t==="d")return m*v.I*v.L*z(v.S)/S.U*100;
      if(t==="I")return du/(m*v.L*z(v.S));
      if(t==="L")return du/(m*v.I*z(v.S));
      if(t==="S"){const r=(du/(m*v.I*v.L)-X0*sn)/c;return r>0?rho/r:NaN;}
    }
  },
  met:{b:"ТТ",s:"учёт",net:false,
    fields:[
      {k:"a",l:()=>"Показание начальное",u:"E",d:2},
      {k:"z",l:()=>"Показание конечное",u:"E",d:2},
      {k:"W",l:()=>"Расход за период",u:"E"}
    ],
    solve(t,v){const K=metK();
      if(t==="W")return (v.z-v.a)*K;
      if(t==="z")return v.a+v.W/K;
      if(t==="a")return v.z-v.W/K;}
  }
};
const ORDER=["pi","mot","cab","met"];

// ---------------------------------------------------------------- состояние
// При первом открытии — пример (двигатель 75 кВт на 400 В), чтобы раздел не был пустым.
const DEF={
  kind:"pi",ph:3,U:400,tag:"",
  pi:{v:{U:400,I:null,P:75e3,c:0.86},rec:["I","U","P","c"],unit:{}},
  mot:{v:{P:75e3,I:null,c:0.86,e:0.94},rec:["I","P","c","e"],unit:{},kp:7,n:1480},
  cab:{v:{S:35,L:120,I:136,d:null},rec:["d","S","L","I"],unit:{},mat:"cu",cos:0.86,awg:10},
  met:{v:{a:12345.6,z:12512.3,W:null},rec:["W","a","z"],unit:{},tt1:600,tt2:5,tn:"1",sec:1,h:720}
};
const clone=o=>JSON.parse(JSON.stringify(o));
function loadState(){
  const s=clone(DEF);
  try{
    const raw=JSON.parse(localStorage.getItem(STORE_KEY)||"null");
    if(raw&&typeof raw==="object"){
      if(KINDS[raw.kind])s.kind=raw.kind;
      if(raw.ph===1||raw.ph===3)s.ph=raw.ph;
      if(Number.isFinite(raw.U)&&raw.U>0)s.U=raw.U;
      if(typeof raw.tag==="string")s.tag=raw.tag;
      for(const k of ORDER){
        const r=raw[k];if(!r||typeof r!=="object")continue;
        const d=s[k];
        Object.assign(d,{...r,v:{...d.v,...(r.v||{})},unit:{...(r.unit||{})}});
        const keys=KINDS[k].fields.map(f=>f.k);
        if(!Array.isArray(r.rec)||r.rec.length!==keys.length||!keys.every(x=>r.rec.includes(x)))d.rec=DEF[k].rec.slice();
      }
    }
  }catch(_){}
  for(const k of ORDER)for(const f in s[k].v)if(s[k].v[f]==null)s[k].v[f]=NaN;
  return s;
}
S=loadState();
let saveTimer=0,dirty=false;
function persist(){dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(flush,250);}
function flush(){
  clearTimeout(saveTimer);if(!dirty)return;dirty=false;
  try{localStorage.setItem(STORE_KEY,JSON.stringify(S,(k,v)=>typeof v==="number"&&!Number.isFinite(v)?null:v));}catch(_){}
}
const K=()=>KINDS[S.kind],st=()=>S[S.kind];
const FL=f=>TX(f.l());          // подпись поля
const CONS=()=>isEn()?"consumption":"расход"; // «расход» энергии (у 4–20 «расход» — это flow)
const UN=u=>TX(u);              // подпись единицы
function unitOf(f){const list=UNITS[f.u];const name=st().unit[f.k];return list.find(x=>x[0]===name)||list[0];}

function recomputeKind(kind){
  const keep=S.kind;S.kind=kind;
  const s=st(),kd=K(),t=s.rec[0];
  if(kd.uField)s.v.U=S.U;
  const val=kd.solve(t,s.v);
  s.v[t]=Number.isFinite(val)?val:NaN;
  if(kd.uField&&t==="U"&&Number.isFinite(val)&&val>0)S.U=val;
  S.kind=keep;
}
const recompute=()=>recomputeKind(S.kind);
function recomputeAll(){for(const k of ORDER)recomputeKind(k);}
function touch(k){const r=st().rec;r.splice(r.indexOf(k),1);r.push(k);}

// ---------------------------------------------------------------- разметка
const ICON={
  copy:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"></rect><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"></path></svg>',
  send:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3 10.5 13.5"></path><path d="m21 3-6.5 18-4-7.5L3 9.5Z"></path></svg>',
  task:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5h6M9 4.5a1.5 1.5 0 0 0-1.5 1.5H6.5A2 2 0 0 0 4.5 8v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1A1.5 1.5 0 0 0 15 4.5"></path><path d="m8.5 13.5 2.5 2.5 4.5-5"></path></svg>',
  book:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5a2 2 0 0 1 2-2h11.5v14H7a2 2 0 0 0-2 2Z"></path><path d="M5 19.5a2 2 0 0 0 2 2h11.5v-4"></path><path d="M8.5 7.5h6.5M8.5 11h4.5"></path></svg>'
};
let root=null,els={};
function $(id){return els[id]||(els[id]=root.querySelector("#"+id));}
const field=(id,label,extra="")=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" inputmode="decimal" autocomplete="off" enterkeyhint="done"${extra}/></div>`;

function template(){
  const kinds=ORDER.map(k=>`<button type="button" class="tab loopKind" data-kind="${k}" role="tab" aria-selected="false"><b>${TX(KINDS[k].b)}</b><small>${TX(KINDS[k].s)}</small></button>`).join("");
  return `
<div class="gasGrid elGrid">
  <div class="gasCol">
    <section class="gasCard gasO1" aria-labelledby="elKindTitle">
      <div class="gasCardHead"><h2 id="elKindTitle">${TX("Расчёт")}</h2><span class="gasHeadNote" id="elKindNote"></span></div>
      <div class="loopKinds" role="tablist" aria-label="${TX("Что считаем")}">${kinds}</div>
      <div class="elNet" id="elNet">
        <div class="loopSeg" role="group" aria-label="${TX("Сеть")}">
          <button type="button" class="tab" data-ph="3">${TX("3 фазы")}</button>
          <button type="button" class="tab" data-ph="1">${TX("1 фаза")}</button>
        </div>
        <div class="field" id="elNetU"><label for="elNetUIn" id="elNetULbl">${TX("Напряжение линейное, В")}</label><input id="elNetUIn" inputmode="decimal" autocomplete="off" enterkeyhint="done"/></div>
        <div class="gasChips" role="group" aria-label="${TX("Типовые напряжения")}" id="elUChips"></div>
      </div>
      <div class="elBlock" data-for="met">
        <div class="gasScaleRow">
          <div class="field"><label for="elTT1">${TX("ТТ, первичный ток, А")}</label><select id="elTT1">${TT1.map(x=>`<option>${x}</option>`).join("")}</select></div>
          <div class="field"><label for="elTT2">${TX("вторичный, А")}</label><select id="elTT2"><option>5</option><option>1</option></select></div>
        </div>
        <div class="field"><label for="elTN">${TX("ТН")}</label><select id="elTN">${TN.map(([v,l])=>`<option value="${v}">${esc(TX(l))}</option>`).join("")}</select></div>
        <div class="loopLabel">${TX("Счётчик показывает")}</div>
        <div class="loopSeg" role="group" aria-label="${TX("Что показывает счётчик")}">
          <button type="button" class="tab" data-sec="1">${TX("вторичку (×K)")}</button>
          <button type="button" class="tab" data-sec="0">${TX("первичку (×1)")}</button>
        </div>
        <div class="mini">${TX("Если в счётчик при наладке занесли Kтт и Kтн, он уже показывает первичную энергию — множитель не нужен.")}</div>
      </div>
      <div class="field loopTagField elTagField">
        <label for="elTag">${TX("Тэг")}</label>
        <input id="elTag" autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="done" placeholder="2131-M-101"/>
      </div>
    </section>

    <section class="gasCard gasInputCard gasO2" aria-labelledby="elValTitle">
      <div class="gasCardHead"><h2 id="elValTitle">${TX("Значения")}</h2><span class="gasHeadNote" id="elValNote"></span></div>
      <div class="elFields" id="elFields"></div>
      <div class="elDerived" id="elDerived"></div>
      <div class="gasMaStatus" id="elStatus" role="status"></div>
      <div class="gasActions gasActions3">
        <button type="button" class="action iconOnly" id="elCopy" aria-label="${TX("Копировать результат")}" title="${TX("Копировать результат")}">${ICON.copy}</button>
        <button type="button" class="action" id="elTask" title="${TX("Дописать результат в задание тега (поле «Тэг» выше)")}">${ICON.task}<span>${TX("В задание")}</span></button>
        <button type="button" class="action primary" id="elShare">${ICON.send}<span>${TX("Отправить")}</span></button>
      </div>
    </section>
  </div>

  <div class="gasCol">
    <section class="gasCard gasO3" aria-labelledby="elCfgTitle">
      <div class="gasCardHead"><h2 id="elCfgTitle">${TX("Параметры")}</h2><span class="gasHeadNote" id="elCfgNote"></span></div>
      <div class="elBlock" data-for="pi">
        <div class="mini">${TX("U — линейное (между фазами) для 3 фаз и фазное для 1 фазы. P — активная мощность из сети. Для двигателя с КПД — вкладка <b>M</b>.")}</div>
      </div>
      <div class="elBlock" data-for="mot">
        <div class="gasScaleRow">${field("elKp",TX("Кратность пуска Iп/Iн"))}${field("elN",TX("Обороты по шильдику"))}</div>
        <div class="mini" id="elMotOut"></div>
      </div>
      <div class="elBlock" data-for="cab">
        <div class="loopSeg" role="group" aria-label="${TX("Материал жил")}">
          <button type="button" class="tab" data-mat="cu">${TX("Медь")}</button>
          <button type="button" class="tab" data-mat="al">${TX("Алюминий")}</button>
        </div>
        <div class="gasScaleRow">
          ${field("elCabCos",TX("cosφ нагрузки"))}
          <div class="field"><label for="elAwg">${TX("AWG → мм²")}</label><select id="elAwg">${AWG.map(n=>`<option value="${n}">AWG ${awgName(n)}</option>`).join("")}</select></div>
        </div>
        <div class="mini" id="elAwgOut"></div>
      </div>
      <div class="elBlock" data-for="met">
        ${field("elHours",TX("Период, ч — для средней мощности"))}
        <div class="gasChips" role="group" aria-label="${TX("Типовые периоды")}" id="elHChips"></div>
      </div>
    </section>

    <section class="gasCard gasO4" aria-labelledby="elTblTitle">
      <div class="gasCardHead"><h2 id="elTblTitle">${TX("Таблица")}</h2><span class="gasHeadNote" id="elTblNote"></span></div>
      <div class="loopTableWrap"><table class="loopTable elTable"><thead id="elTblHead"></thead><tbody id="elTbl"></tbody></table></div>
      <div class="mini" id="elTblHint"></div>
    </section>
  </div>
</div>
<div class="convFoot"><button type="button" class="convInfoBtn" id="elSources">${ICON.book}<span>${TX("Источники и формулы")}</span></button></div>`;
}

const SOURCES_HTML=`
<h3>Мощность и ток</h3>
<div class="hF">3ф: P = √3 · U · I · cosφ<br>1ф: P = U · I · cosφ<br>S = √3 · U · I (1ф: U · I) · Q = √(S² − P²)</div>
<p class="mini">U для трёх фаз — линейное, для одной — фазное.</p>
<h3>Двигатель</h3>
<div class="hF">P₂ = √3 · U · I · cosφ · η<br>n₀ = 60 · f / p · s = (n₀ − n) / n₀</div>
<p class="mini">P₂ — мощность на валу, как на шильдике; 1 л.с. = 735,499 Вт. Пуск звезда → треугольник: ток из сети ≈ в 3 раза меньше прямого пуска.</p>
<h3>Потеря напряжения в кабеле</h3>
<div class="hF">3ф: ΔU = √3 · I · L · (r·cosφ + x·sinφ)<br>1ф: ΔU = 2 · I · L · (r·cosφ + x·sinφ)<br>r = ρ / S</div>
<p class="mini">ρ при 70 °C: медь 0,021, алюминий 0,034 Ом·мм²/м; x = 0,08 Ом/км. Потери мощности: 3 · I² · r · L (1ф — 2 · I² · r · L).</p>
<h3>Учёт</h3>
<div class="hF">W = (W<sub>кон</sub> − W<sub>нач</sub>) · K<sub>тт</sub> · K<sub>тн</sub></div>
<h3>Откуда данные</h3>
<ul class="hSrc">
<li>Номинальные напряжения <span class="nw">230/400 В</span> — <span class="nw">ГОСТ 29322-2014</span> (<span class="nw">IEC 60038</span>).</li>
<li>Сечения жил — <span class="nw">ГОСТ 22483-2021</span> (<span class="nw">IEC 60228</span>).</li>
<li>AWG — <span class="nw">ASTM B258</span>.</li>
<li>Измерительные трансформаторы — <span class="nw">ГОСТ 7746-2015</span> (ТТ), <span class="nw">ГОСТ 1983-2015</span> (ТН).</li>
</ul>
<h3>Ограничения</h3>
<p>Допустимый ток кабеля по нагреву (<span class="nw">ПУЭ, гл. 1.3</span>) не проверяется. Предел ΔU задаёт проект; частый ориентир — 5 %. cosφ и КПД берите с шильдика или из паспорта.</p>
<p class="helpNote">Считается на телефоне, без интернета.</p>`;
const SOURCES_HTML_EN=`
<h3>Power and current</h3>
<div class="hF">3ph: P = √3 · U · I · cosφ<br>1ph: P = U · I · cosφ<br>S = √3 · U · I (1ph: U · I) · Q = √(S² − P²)</div>
<p class="mini">For three phases U is line-to-line, for one phase — line-to-neutral.</p>
<h3>Motor</h3>
<div class="hF">P₂ = √3 · U · I · cosφ · η<br>n₀ = 60 · f / p · s = (n₀ − n) / n₀</div>
<p class="mini">P₂ — shaft power, as on the nameplate; 1 hp (metric) = 735.499 W. Star-delta start: the line current is ≈ 3 times lower than direct-on-line.</p>
<h3>Cable voltage drop</h3>
<div class="hF">3ph: ΔU = √3 · I · L · (r·cosφ + x·sinφ)<br>1ph: ΔU = 2 · I · L · (r·cosφ + x·sinφ)<br>r = ρ / S</div>
<p class="mini">ρ at 70 °C: copper 0.021, aluminium 0.034 Ω·mm²/m; x = 0.08 Ω/km. Power loss: 3 · I² · r · L (1ph — 2 · I² · r · L).</p>
<h3>Metering</h3>
<div class="hF">W = (W<sub>end</sub> − W<sub>start</sub>) · K<sub>ct</sub> · K<sub>vt</sub></div>
<h3>Data sources</h3>
<ul class="hSrc">
<li>Nominal voltages <span class="nw">230/400 V</span> — <span class="nw">GOST 29322-2014</span> (<span class="nw">IEC 60038</span>).</li>
<li>Conductor cross-sections — <span class="nw">GOST 22483-2021</span> (<span class="nw">IEC 60228</span>).</li>
<li>AWG — <span class="nw">ASTM B258</span>.</li>
<li>Instrument transformers — <span class="nw">GOST 7746-2015</span> (CT), <span class="nw">GOST 1983-2015</span> (VT).</li>
</ul>
<h3>Limitations</h3>
<p>Cable current-carrying capacity (<span class="nw">PUE ch. 1.3</span>, IEC 60364-5-52) is not checked. The ΔU limit comes from the design; a common guide is 5 %. Take cosφ and efficiency from the nameplate or the datasheet.</p>
<p class="helpNote">Calculated on the phone, offline.</p>`;

// ---------------------------------------------------------------- отрисовка
let fieldSig="";
function buildFields(){
  const kd=K();
  const sig=S.kind+S.ph+kd.fields.map(f=>unitOf(f)[0]).join();
  if(sig===fieldSig)return;fieldSig=sig;
  $("elFields").innerHTML=kd.fields.map(f=>{
    const u=unitOf(f),many=UNITS[f.u].length>1;
    return `<div class="elField" data-k="${f.k}">
      <div class="elLabelRow"><label for="elF_${f.k}">${esc(FL(f))}</label><span class="elCalc">${TX("расчёт")}</span></div>
      <div class="gasValueRow"><input id="elF_${f.k}" class="gasValueInput" data-k="${f.k}" inputmode="decimal" autocomplete="off" enterkeyhint="done"/>
      <button type="button" class="elUnit" data-unit="${f.k}"${many?"":" disabled"} aria-label="${esc(TX("Единицы: {0}",u[0]?UN(u[0]):TX("нет")))}">${esc(u[0]?UN(u[0]):"—")}</button></div>
      <div class="elHint" id="elH_${f.k}"></div></div>`;}).join("");
  kd.fields.forEach(f=>{delete els["elF_"+f.k];delete els["elH_"+f.k];});
}
function setIf(el,val){if(el&&document.activeElement!==el&&el.value!==val)el.value=val;}

function render(){
  if(!root)return;
  const kd=K(),s=st(),v=s.v,t=s.rec[0];
  root.querySelectorAll(".loopKind").forEach(b=>{const on=b.dataset.kind===S.kind;b.classList.toggle("active",on);b.setAttribute("aria-selected",String(on));});
  root.querySelectorAll("[data-ph]").forEach(b=>{const on=+b.dataset.ph===S.ph;b.classList.toggle("active",on);b.setAttribute("aria-pressed",String(on));});
  root.querySelectorAll("[data-for]").forEach(b=>{b.hidden=b.dataset.for!==S.kind;});
  $("elNet").hidden=!kd.net;
  $("elNetU").hidden=!!kd.uField;
  $("elNetULbl").textContent=S.ph===3?TX("Напряжение линейное, В"):TX("Напряжение фазное, В");
  setIf($("elNetUIn"),fin(S.U));
  $("elUChips").innerHTML=(S.ph===3?U3:U1).map(([x,l])=>{const on=Math.abs(S.U-x)<1e-6;return `<button type="button" class="tab${on?" active":""}" data-u="${x}" aria-pressed="${on}">${TX(l)}</button>`;}).join("");
  $("elKindNote").textContent=kd.net?`${S.ph===3?TX("3ф"):TX("1ф")} · ${S.U>=1000?fmt(S.U/1000)+" "+UN("кВ"):fmt(S.U)+" "+UN("В")}`:`K = ${fmt(metK())}`;
  $("elValNote").textContent=S.tag?S.tag:(kd.fields.length===3?TX("любые два — третье считается"):TX("любые три — четвёртое считается"));

  buildFields();
  let bad="";
  kd.fields.forEach(f=>{
    const box=root.querySelector(`.elField[data-k="${f.k}"]`),u=unitOf(f),x=v[f.k],calc=f.k===t;
    box.classList.toggle("isCalc",calc);
    let isBad=false;
    if(calc&&!Number.isFinite(x))bad=bad||TX("Не хватает данных: заполните остальные поля");
    if(Number.isFinite(x)&&f.lim&&(x<=f.lim[0]||x>f.lim[1])){isBad=true;if(calc)bad=x>1?TX("{0} получился {1} — больше 1: проверьте остальные значения",FL(f),fmt(x)):TX("{0} получился {1} — не больше нуля: проверьте остальные значения",FL(f),fmt(x));}
    else if(Number.isFinite(x)&&x<0&&calc){isBad=true;bad=TX("{0}: меньше нуля — проверьте значения",FL(f));}
    box.classList.toggle("isBad",isBad);
    setIf($("elF_"+f.k),Number.isFinite(x)?fin(x/u[1],f.d):"");
    const ub=box.querySelector(".elUnit"),ut=u[0]?UN(u[0]):"—";if(ub.textContent!==ut)ub.textContent=ut;
    $("elH_"+f.k).innerHTML=hint(f.k,x);
  });
  derived(bad);
  table();
  cfg();
}

function hint(k,x){
  const v=st().v;
  if(!Number.isFinite(x))return "";
  if(S.kind==="pi"&&k==="c"&&x>0&&x<=1)return `φ = ${fmt(Math.acos(x)*180/Math.PI,1)}° · tgφ = ${fmt(Math.tan(Math.acos(x)),3)}`;
  if(S.kind==="mot"){
    if(k==="P")return TX("= {0} л.с. · из сети P₁ = {1} кВт",fmt(x/735.499,3),dash(fmt(x/v.e/1e3)));
    if(k==="e")return TX("С шильдика. Обычно 0,85–0,96, у малых двигателей ниже.");
  }
  if(S.kind==="cab"){
    if(k==="S"){const up=SECTIONS.find(s=>s>=x-1e-9);return up&&Math.abs(up-x)>1e-6?TX("Ближайшее стандартное сечение — <b>{0} мм²</b>",fmt(up)):"";}
    if(k==="d")return TX("= {0} В при U = {1} В",fmt(x/100*S.U),fmt(S.U));
  }
  if(S.kind==="met"&&k==="W")return S.met.sec?TX("разность × {0}",fmt(metK())):TX("без множителя");
  return "";
}
const der=(label,val,unit,cls="")=>`<div class="elDer ${cls}"><span>${TX(label)}</span><b>${dash(val)}</b><small>${TX(unit)}</small></div>`;
function derived(bad){
  const v=st().v;
  let html="",cls="gasOk",text="";
  if(S.kind==="pi"){
    const Sa=kU()*v.U*v.I,Q=Math.sqrt(Math.max(0,Sa*Sa-v.P*v.P));
    html=der("S полная",fmt(Sa/1e3),"кВА")+der("Q реакт.",fmt(Q/1e3),"квар")+der("Ток на кВт",v.P>0?fmt(v.I/(v.P/1e3),2):"","А/кВт","amp");
    text=`${S.ph===3?TX("Три фазы"):TX("Одна фаза")} · ${fmt(v.U)} ${UN("В")} · ${fmt(v.I)} ${UN("А")}`;
  }else if(S.kind==="mot"){
    const Ip=v.I*S.mot.kp;
    html=der("I пуск",fmt(Ip),"А","amp")+der("Пуск Y→Δ",fmt(Ip/3),"А")+der("S из сети",fmt(kU()*S.U*v.I/1e3),"кВА");
    text=TX("Iн {0} А при {1} В",fmt(v.I),fmt(S.U));
    if(S.ph===3&&Math.abs(S.U-400)<25&&Number.isFinite(v.I))text+=TX(" · на 230 В (Δ) ≈ {0} А",fmt(v.I*SQ3));
  }else if(S.kind==="cab"){
    const r=RHO[S.cab.mat]/v.S,loss=(S.ph===3?3:2)*v.I*v.I*r*v.L;
    html=der("ΔU",fmt(v.d/100*S.U),"В")+der("U в конце",fmt(S.U*(1-v.d/100)),"В")+der("Потери",fmt(loss/1e3),"кВт");
    if(Number.isFinite(v.d)){
      if(v.d<=5)text=TX("ΔU {0} % — в пределах частого ориентира 5 %",fmt(v.d,2));
      else if(v.d<=10){cls="gasWarnText";text=TX("ΔU {0} % — больше 5 %: сверьтесь с проектом",fmt(v.d,2));}
      else{cls="gasBad";text=TX("ΔU {0} % — много: увеличьте сечение или проверьте длину",fmt(v.d,2));}
    }
  }else{
    const W=v.W,h=S.met.h;
    html=der("Множитель",fmt(metK()),"Kтт·Kтн")+der("Разность",fmt(v.z-v.a),"на табло")+der("P средняя",h>0?fmt(W/h):"","кВт","amp");
    text=`${TX("ТТ")} ${S.met.tt1}/${S.met.tt2}${S.met.tn!=="1"?` · ${TX("ТН")} ×`+S.met.tn:""} · ${CONS()} ${fmt(W)} ${UN("кВт·ч")}`;
    if(Number.isFinite(W)&&W<0){cls="gasBad";text=TX("Конечное показание меньше начального — счётчик переходил через ноль или перепутаны поля");}
  }
  $("elDerived").innerHTML=html;
  if(bad){cls="gasBad";text=bad;}
  const stEl=$("elStatus");stEl.className="gasMaStatus "+cls;stEl.textContent=text;
}

function table(){
  const v=st().v,head=$("elTblHead"),body=$("elTbl");
  if(S.kind==="pi"||S.kind==="mot"){
    const mot=S.kind==="mot",U=mot?S.U:v.U,k=kU()*U,c=v.c,e=mot?v.e:1;
    $("elTblTitle").textContent=mot?TX("Типовые двигатели"):TX("Типовые мощности");
    $("elTblNote").textContent=`${fmt(U)} ${UN("В")} · cosφ ${fmt(c)}${mot?" · η "+fmt(e):""}`;
    head.innerHTML=`<tr><th>${UN("кВт")}</th><th>${TX("Ток, А")}</th><th>${mot?TX("Пуск, А"):UN("кВА")}</th></tr>`;
    body.innerHTML=P_STD.map(p=>{const I=p*1e3/(k*c*e),on=Math.abs(v.P-p*1e3)<1e-6;
      return `<tr data-p="${p}"${on?' class="active"':""}><td>${fmt(p)}</td><td class="loopCellI">${dash(fmt(I,I<10?2:1))}</td><td>${dash(mot?fmt(I*S.mot.kp,0):fmt(k*I/1e3,1))}</td></tr>`;}).join("");
    $("elTblHint").textContent=TX("Нажмите строку — мощность перейдёт в «Значения», ток посчитается.");
  }else if(S.kind==="cab"){
    const m=S.ph===3?SQ3:2,c=S.cab.cos,sn=Math.sqrt(Math.max(0,1-c*c));
    $("elTblTitle").textContent=TX("Сечения");
    $("elTblNote").textContent=`${S.cab.mat==="cu"?TX("медь"):TX("алюм.")} · ${fmt(v.L)} ${UN("м")} · ${fmt(v.I)} ${UN("А")}`;
    head.innerHTML=`<tr><th>${UN("мм²")}</th><th>ΔU, %</th><th>${TX("ΔU, В")}</th></tr>`;
    body.innerHTML=SECTIONS.map(s=>{const d=m*v.I*v.L*(RHO[S.cab.mat]/s*c+X0*sn)/S.U*100,on=Math.abs(v.S-s)<1e-6;
      const col=!Number.isFinite(d)||d<=5?"":d<=10?' class="loopWarn"':' class="loopBad"';
      return `<tr data-s="${s}"${on?' class="active"':""}><td>${fmt(s)}</td><td${col}>${dash(fmt(d,2))}</td><td>${dash(fmt(d/100*S.U,1))}</td></tr>`;}).join("");
    $("elTblHint").textContent=TX("Нажмите строку — сечение перейдёт в «Значения», ΔU посчитается. Допустимый ток по нагреву — по ПУЭ, здесь не проверяется.");
  }else{
    $("elTblTitle").textContent=TX("Множители ТТ");
    $("elTblNote").textContent=S.met.tn==="1"?TX("без ТН"):TX("с ТН ×{0}",S.met.tn);
    head.innerHTML=`<tr><th>${TX("ТТ")}</th><th>${TX("Kтт")}</th><th>${TX("Множитель")}</th></tr>`;
    body.innerHTML=TT1.filter(x=>x>=50).map(a=>{const kt=a/S.met.tt2,on=a===S.met.tt1;
      return `<tr data-tt="${a}"${on?' class="active"':""}><td>${a}/${S.met.tt2}</td><td>${fmt(kt)}</td><td class="loopCellI">${fmt(kt*(+S.met.tn))}</td></tr>`;}).join("");
    $("elTblHint").textContent=TX("Нажмите строку — выберется трансформатор тока.");
  }
}

function cfg(){
  const m=S.mot,c=S.cab,t=S.met;
  const note={pi:"",mot:"пуск и обороты",cab:"материал и cosφ",met:"период"};
  $("elCfgNote").textContent=TX(note[S.kind]);
  setIf($("elKp"),fin(m.kp));setIf($("elN"),fin(m.n));
  const n0=[3000,1500,1000,750,600,500].find(x=>m.n<x&&m.n>x*0.8);
  $("elMotOut").innerHTML=n0?TX("Синхронная частота <b>{0}</b> об/мин ({1} {2} полюсов) · скольжение <b>{3} %</b>",n0,3000/n0,3000/n0===1?TX("пара"):TX("пары"),fmt((n0-m.n)/n0*100,2)):TX("Обороты не похожи на асинхронный двигатель 50 Гц.");
  root.querySelectorAll("[data-mat]").forEach(b=>{const on=b.dataset.mat===c.mat;b.classList.toggle("active",on);b.setAttribute("aria-pressed",String(on));});
  setIf($("elCabCos"),fin(c.cos));
  if($("elAwg").value!==String(c.awg))$("elAwg").value=String(c.awg);
  const mm=awgMm2(c.awg),up=SECTIONS.find(s=>s>=mm-0.05);
  $("elAwgOut").innerHTML=TX("AWG {0} = <b>{1} мм²</b> · ближайшее метрическое — {2} мм²",awgName(c.awg),fmt(mm,2),fmt(up))+` <button type="button" class="tab gasLink" id="elAwgUse">${TX("в сечение")}</button>`;
  delete els.elAwgUse;
  if($("elTT1").value!==String(t.tt1))$("elTT1").value=String(t.tt1);
  if($("elTT2").value!==String(t.tt2))$("elTT2").value=String(t.tt2);
  if($("elTN").value!==t.tn)$("elTN").value=t.tn;
  root.querySelectorAll("[data-sec]").forEach(b=>{const on=+b.dataset.sec===t.sec;b.classList.toggle("active",on);b.setAttribute("aria-pressed",String(on));});
  setIf($("elHours"),fin(t.h));
  $("elHChips").innerHTML=HOURS.map(([h,l])=>`<button type="button" class="tab${t.h===h?" active":""}" data-h="${h}" aria-pressed="${t.h===h}">${TX(l)}</button>`).join("");
}

// ---------------------------------------------------------------- тексты результата
function summaryText(noHead=false){
  const v=st().v,ph=S.ph===3?TX("3ф"):TX("1ф"),u=`${ph} ${fmt(S.U)} ${UN("В")}`,head=S.tag&&!noHead?S.tag+" — ":"";
  const V=UN("В"),A=UN("А"),kW=UN("кВт");
  if(S.kind==="pi"){const Sa=kU()*v.U*v.I;return plain(`${head}${TX("Мощность и ток")}, ${ph}\nU ${fmt(v.U)} ${V} · I ${fmt(v.I)} ${A} · P ${fmt(v.P/1e3)} ${kW} · cosφ ${fmt(v.c)}\nS ${fmt(Sa/1e3)} ${UN("кВА")} · Q ${fmt(Math.sqrt(Math.max(0,Sa*Sa-v.P*v.P))/1e3)} ${UN("квар")}`);}
  if(S.kind==="mot")return plain(`${head}${TX("Двигатель")}, ${u}\nP₂ ${fmt(v.P/1e3)} ${kW} · ${TX("Iн")} ${fmt(v.I)} ${A} · cosφ ${fmt(v.c)} · η ${fmt(v.e)}\n${TX("Пуск ×{0}: {1} А, через звезду ≈ {2} А",fmt(S.mot.kp),fmt(v.I*S.mot.kp),fmt(v.I*S.mot.kp/3))}`);
  if(S.kind==="cab")return plain(`${head}${TX("Кабель")} ${S.cab.mat==="cu"?TX("медь"):TX("алюминий")} ${fmt(v.S)} ${UN("мм²")}, ${fmt(v.L)} ${UN("м")}, ${u}\nI ${fmt(v.I)} ${A} · cosφ ${fmt(S.cab.cos)} → ΔU ${fmt(v.d,2)} % (${fmt(v.d/100*S.U,1)} ${V})`);
  return plain(`${head}${TX("Учёт")}: ${TX("ТТ")} ${S.met.tt1}/${S.met.tt2}${S.met.tn!=="1"?`, ${TX("Kтн")} `+S.met.tn:""}, K ${fmt(metK())}\n${fmt(v.a)} → ${fmt(v.z)} · ${CONS()} ${fmt(v.W)} ${UN("кВт·ч")}`);
}
const taskText=()=>TX("Эл.: ")+summaryText(true).replace(/\n/g," · ");

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
async function shareSummary(){
  const text=summaryText();
  try{
    if(typeof navigator.share==="function"){await navigator.share({title:TX("Электроэнергетика"),text});toast(TX("Результат передан"));return;}
  }catch(e){if(e?.name==="AbortError")return;}
  await copyText(text,TX("Результат скопирован"));
}
let tagPicker=null;
function refreshTagList(){
  const input=$("elTag");if(!input)return;
  const app=window.TagListApp;
  if(!tagPicker&&app?.attachTagPicker)tagPicker=app.attachTagPicker(input,{anchor:input});
  tagPicker?.refresh();
}
function saveToTask(){
  const tag=String($("elTag").value||"").trim();
  if(!tag){toast(TX("Укажите тег — результат запишется в его задание"));$("elTag").focus();return;}
  const app=window.TagListApp;
  if(!app?.addResultToTag){toast(TX("Список тэгов недоступен"));return;}
  const r=app.addResultToTag(tag,taskText());
  if(!r.ok){toast(r.message||TX("Не удалось записать"));return;}
  toast(r.created?TX("Создан тэг {0} на странице «{1}», результат — в задании",r.tag,r.page):TX("Записано в задание {0}",r.tag));
  refreshTagList();
}
function flashValues(){
  const card=root.querySelector(".gasInputCard");if(!card)return;
  try{card.scrollIntoView({block:"center",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});}catch(_){}
  card.classList.remove("gasFlash");void card.offsetWidth;card.classList.add("gasFlash");
}
function changed(){recompute();persist();render();}

function bind(){
  root.addEventListener("click",e=>{
    const tr=e.target.closest("tr[data-p],tr[data-s],tr[data-tt]");
    if(tr&&root.contains(tr)){
      const s=st();
      if(tr.dataset.p){s.v.P=+tr.dataset.p*1e3;s.rec=["I",...s.rec.filter(x=>x!=="I"&&x!=="P"),"P"];}
      else if(tr.dataset.s){s.v.S=+tr.dataset.s;s.rec=["d",...s.rec.filter(x=>x!=="d"&&x!=="S"),"S"];}
      else S.met.tt1=+tr.dataset.tt;
      changed();flashValues();return;
    }
    const b=e.target.closest("button");
    if(!b||!root.contains(b)||b.disabled)return;
    if(b.dataset.kind){if(b.dataset.kind!==S.kind){S.kind=b.dataset.kind;changed();}return;}
    if(b.dataset.ph){
      S.ph=+b.dataset.ph;
      if(S.ph===1&&S.U>1000)S.U=230;
      if(S.ph===3&&S.U<300)S.U=400;
      recomputeAll();persist();render();return;
    }
    // Кнопка напряжения в P·I — это ввод U: поле становится «свежим», считается другое.
    if(b.dataset.u){S.U=+b.dataset.u;if(K().uField){S.pi.v.U=S.U;touch("U");}recomputeAll();persist();render();return;}
    if(b.dataset.unit){
      const f=K().fields.find(x=>x.k===b.dataset.unit),list=UNITS[f.u],i=list.indexOf(unitOf(f));
      st().unit[f.k]=list[(i+1)%list.length][0];persist();render();return;
    }
    if(b.dataset.mat){S.cab.mat=b.dataset.mat;changed();return;}
    if(b.dataset.sec!==undefined){S.met.sec=+b.dataset.sec;changed();return;}
    if(b.dataset.h){S.met.h=+b.dataset.h;persist();render();return;}
    switch(b.id){
      case "elAwgUse":{const up=SECTIONS.find(s=>s>=awgMm2(S.cab.awg)-0.05);S.cab.v.S=up;if(S.kind==="cab"){touch("S");}changed();toast(TX("Сечение {0} мм²",fmt(up)));break;}
      case "elCopy":copyText(summaryText(),TX("Результат скопирован"));break;
      case "elShare":shareSummary();break;
      case "elTask":saveToTask();break;
      case "elSources":window.TagListApp?.openInfo?.(TX("Источники и формулы"),isEn()?SOURCES_HTML_EN:SOURCES_HTML);break;
    }
  });
  root.addEventListener("input",e=>{
    const el=e.target;
    if(el.id==="elTag"){S.tag=String(el.value||"").trim();persist();$("elValNote").textContent=S.tag||(K().fields.length===3?TX("любые два — третье считается"):TX("любые три — четвёртое считается"));return;}
    if(el.dataset.k){
      const f=K().fields.find(x=>x.k===el.dataset.k),x=num(el.value);
      st().v[f.k]=Number.isFinite(x)?x*unitOf(f)[1]:NaN;
      if(K().uField&&f.k==="U"&&x>0)S.U=st().v.U;
      touch(f.k);
      if(K().uField&&f.k==="U"){recomputeAll();persist();render();}else changed();
      return;
    }
    const x=num(el.value);
    if(el.id==="elNetUIn"&&x>0){S.U=x;recomputeAll();persist();render();}
    else if(el.id==="elKp"&&x>0){S.mot.kp=x;persist();render();}
    else if(el.id==="elN"&&x>0){S.mot.n=x;persist();render();}
    else if(el.id==="elCabCos"&&x>0&&x<=1){S.cab.cos=x;changed();}
    else if(el.id==="elHours"&&x>0){S.met.h=x;persist();render();}
  });
  root.addEventListener("change",e=>{
    const el=e.target;
    if(el.id==="elTT1")S.met.tt1=+el.value;
    else if(el.id==="elTT2")S.met.tt2=+el.value;
    else if(el.id==="elTN")S.met.tn=el.value;
    else if(el.id==="elAwg")S.cab.awg=+el.value;
    else return;
    el.blur();changed();
  });
  // Касание поля выделяет значение целиком — новое число сразу заменяет старое.
  root.addEventListener("focusin",e=>{
    const el=e.target;if(!el.matches(".gasValueInput"))return;
    const before=el.value;
    setTimeout(()=>{if(document.activeElement===el&&el.value===before){try{el.select();}catch(_){}}},0);
  });
  root.addEventListener("focusout",e=>{if(e.target.matches("input"))setTimeout(render,0);});
  root.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches("input")&&e.target.id!=="elTag"){e.preventDefault();e.target.blur();}});
}

let boundRoot=null;
function mount(container){
  if(root&&root===container&&root.firstElementChild)return;
  root=container;build();
}
function build(){
  els={};fieldSig="";tagPicker=null;
  root.innerHTML=template();
  if(boundRoot!==root){bind();boundRoot=root;}
  $("elTag").value=S.tag||"";
  recomputeAll();render();refreshTagList();
}
// v107: смена языка — раздел размечается заново на новом языке (состояние сохраняется).
window.addEventListener("tl-langchange",()=>{if(root&&root.firstElementChild){flush();build();}});

window.addEventListener("pagehide",flush);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")flush();});

window.TagListElec={
  version:"106",
  mount,
  onShow(){refreshTagList();render();},
  onHide(){flush();},
  // Для тестов и отладки.
  _api:{KINDS,fmt,awgMm2,metK,summaryText,taskText,get state(){return S;}}
};
})();
