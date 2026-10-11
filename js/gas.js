/* Tag list v95 — конвертор газоанализа.
   Загружается по требованию при нажатии на шапку «Tag list».
   Работает полностью на устройстве: без интернета и без внешних запросов.

   Пересчёт (идеальный газ):
     Vm [л/моль] = R·T / P            (при 0 °C и 101,325 кПа = 22,414; при 20 °C = 24,055)
     C [мг/м³]   = C [ppm] · M / Vm
     C [% об.]   = C [ppm] / 10 000
     C [% НКПР]  = C [% об.] / НКПР [% об.] · 100
     I [мА]      = 4 + 16 · (C − Cн) / (Cв − Cн)
*/
(function(){
"use strict";

const STORE_KEY="kip-gas-converter-v1";
const R=8.314462618;            // Дж/(моль·К)
const T0=273.15;
const P_UNITS={kpa:{label:"кПа",k:1},mmhg:{label:"мм рт. ст.",k:0.133322368},bar:{label:"бар",k:100}};
const ATOMS={H:1.008,C:12.011,N:14.007,O:15.999,S:32.06,Cl:35.45};

// НКПР — справочные значения по ГОСТ 31610.20-1-2020 (IEC 60079-20-1) / ГОСТ Р 51330.19-99.
// ПДК р.з. (максимально разовая) — справочно по СанПиН 1.2.3685-21.
// Для пересчёта показаний конкретного прибора используйте НКПР из его паспорта —
// значения можно изменить в «Параметрах».
const GROUPS=[
  ["hc","Углеводороды — пиролиз, ПЭ, ПП"],
  ["aro","Ароматика, спирты, растворители"],
  ["fuel","Водород и другие горючие"],
  ["tox","Токсичные и негорючие"],
  ["user","Пользовательский"]
];
const GASES=[
  {id:"ch4",name:"Метан",f:"CH4",lel:4.4,g:"hc"},
  {id:"c2h6",name:"Этан",f:"C2H6",lel:2.5,g:"hc"},
  {id:"c2h4",name:"Этилен",f:"C2H4",lel:2.3,g:"hc"},
  {id:"c2h2",name:"Ацетилен",f:"C2H2",lel:2.3,g:"hc"},
  {id:"c3h8",name:"Пропан",f:"C3H8",lel:1.7,g:"hc"},
  {id:"c3h6",name:"Пропилен",f:"C3H6",lel:2.0,g:"hc"},
  {id:"nc4h10",name:"н-Бутан",f:"C4H10",lel:1.4,g:"hc"},
  {id:"ic4h10",name:"Изобутан",f:"C4H10",lel:1.3,g:"hc"},
  {id:"ic4h8",name:"Изобутилен",f:"C4H8",lel:1.6,g:"hc"},
  {id:"c4h6",name:"1,3-Бутадиен",f:"C4H6",lel:1.4,g:"hc"},
  {id:"c5h12",name:"Пентан (смесь изомеров)",f:"C5H12",lel:1.4,g:"hc"},
  {id:"c6h14",name:"Гексан (смесь изомеров)",f:"C6H14",lel:1.0,g:"hc"},
  {id:"c7h16",name:"Гептан (смесь изомеров)",f:"C7H16",lel:1.1,g:"hc"},
  {id:"c8h18",name:"Октан",f:"C8H18",lel:0.8,g:"hc"},
  {id:"c6h6",name:"Бензол",f:"C6H6",lel:1.2,g:"aro"},
  {id:"c7h8",name:"Толуол",f:"C7H8",lel:1.1,g:"aro"},
  {id:"c8h10",name:"Ксилол (смесь изомеров)",f:"C8H10",lel:1.0,g:"aro"},
  {id:"c8h8",name:"Стирол",f:"C8H8",lel:1.1,g:"aro"},
  {id:"ch3oh",name:"Метанол",f:"CH4O",display:"CH3OH",lel:6.0,g:"aro"},
  {id:"c2h5oh",name:"Этанол",f:"C2H6O",display:"C2H5OH",lel:3.1,g:"aro"},
  {id:"acetone",name:"Ацетон",f:"C3H6O",lel:2.5,g:"aro"},
  {id:"eo",name:"Этиленоксид",f:"C2H4O",lel:2.6,g:"aro"},
  {id:"h2",name:"Водород",f:"H2",lel:4.0,g:"fuel"},
  {id:"co",name:"Оксид углерода",f:"CO",lel:10.9,pdk:20,g:"fuel"},
  {id:"h2s",name:"Сероводород",f:"H2S",lel:4.0,pdk:10,pdkNote:"3 мг/м³ — в смеси с углеводородами С1–С5",g:"fuel"},
  {id:"nh3",name:"Аммиак",f:"NH3",lel:15.0,pdk:20,g:"fuel"},
  {id:"cl2",name:"Хлор",f:"Cl2",pdk:1,g:"tox"},
  {id:"so2",name:"Диоксид серы",f:"SO2",pdk:10,g:"tox"},
  {id:"no2",name:"Диоксид азота",f:"NO2",pdk:2,g:"tox"},
  {id:"hcl",name:"Хлороводород",f:"HCl",pdk:5,g:"tox"},
  {id:"co2",name:"Диоксид углерода",f:"CO2",g:"tox"},
  {id:"o2",name:"Кислород",f:"O2",note:"в атмосферном воздухе ≈ 20,9 % об.",g:"tox"},
  {id:"custom",name:"Свой газ",f:"",g:"user"}
];
const QUICK=["ch4","c2h6","c2h4","c3h8","c3h6","h2","h2s","co","nh3","o2"];
const UNITS=[
  {id:"ppm",label:"ppm",title:"миллионные доли (млн⁻¹)"},
  {id:"mg",label:"мг/м³",title:"массовая концентрация"},
  {id:"vol",label:"% об.",title:"объёмная доля"},
  {id:"lel",label:"% НКПР",title:"доля нижнего концентрационного предела распространения пламени"},
  {id:"ppb",label:"ppb",title:"миллиардные доли (млрд⁻¹)"},
  {id:"g",label:"г/м³",title:"массовая концентрация (= мг/л)"}
];
const SCALE_UNITS=["lel","vol","ppm","mg"];
const PRESETS=[
  {id:"std20",label:"20 °C · 101,325 кПа",t:20,p:101.325,title:"Стандартные условия (ГОСТ 2939-63), ПДК рабочей зоны"},
  {id:"n0",label:"0 °C · н. у.",t:0,p:101.325,title:"Нормальные физические условия"},
  {id:"t25",label:"25 °C",t:25,p:101.325,title:"25 °C и 101,325 кПа"}
];

const gasById=new Map(GASES.map(g=>[g.id,g]));
const unitById=new Map(UNITS.map(u=>[u.id,u]));

function molarMass(formula){
  let m=0,ok=false;
  String(formula||"").replace(/([A-Z][a-z]?)(\d*)/g,(_,el,n)=>{
    if(!(el in ATOMS)){m=NaN;return "";}
    m+=ATOMS[el]*(n?Number(n):1);ok=true;return "";
  });
  return ok?Math.round(m*1000)/1000:NaN;
}
const SUB="₀₁₂₃₄₅₆₇₈₉";
function subText(f){return String(f||"").replace(/\d/g,d=>SUB[d]);}
function subHtml(f){return esc(f).replace(/(\d+)/g,"<sub>$1</sub>");}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

function parseNum(v){
  const s=String(v??"").replace(/[\s  ]/g,"").replace(/,/g,".").replace(/[−–]/g,"-");
  if(!s||s==="-"||s===".")return NaN;
  if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s))return NaN;
  return Number(s);
}
const NF=new Map();
function nf(sig){if(!NF.has(sig))NF.set(sig,new Intl.NumberFormat("ru-RU",{maximumSignificantDigits:sig}));return NF.get(sig);}
const SUP={"-":"⁻","0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹"};
function fmt(x,sig=5){
  if(!Number.isFinite(x))return "—";
  if(x===0)return "0";
  const a=Math.abs(x);
  if(a>=1e9||a<1e-6){
    const [mant,exp]=x.toExponential(Math.max(0,sig-2)).split("e");
    return `${mant.replace(".",",")}·10${String(Number(exp)).replace(/[-\d]/g,c=>SUP[c])}`;
  }
  return nf(sig).format(x);
}
// НКПР показываем как в стандарте: с одним знаком после запятой (4,0; 0,8; 15,0).
function fmtLel(x){return Number.isFinite(x)?x.toLocaleString("ru-RU",{minimumFractionDigits:1,maximumFractionDigits:3}):"—";}
function fmtFixed(x,d){return Number.isFinite(x)?x.toLocaleString("ru-RU",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";}
function plain(s){return String(s).replace(/[  ]/g," ");}

// ---------------------------------------------------------------- состояние
const DEFAULT_STATE={
  gas:"ch4",value:"1000",unit:"ppm",t:"20",p:"101,325",pUnit:"kpa",
  overrides:{},custom:{name:"",M:"",lel:"",pdk:""},
  ma:{lo:"0",hi:"100",unit:"lel",mA:"12",val:"",last:"mA"},
  params:false,tag:""
};
function loadState(){
  try{
    const raw=JSON.parse(localStorage.getItem(STORE_KEY)||"null");
    if(raw&&typeof raw==="object"){
      const s={...DEFAULT_STATE,...raw};
      s.overrides=raw.overrides&&typeof raw.overrides==="object"?raw.overrides:{};
      s.custom={...DEFAULT_STATE.custom,...(raw.custom||{})};
      s.ma={...DEFAULT_STATE.ma,...(raw.ma||{})};
      if(!gasById.has(s.gas))s.gas="ch4";
      if(!unitById.has(s.unit))s.unit="ppm";
      if(!P_UNITS[s.pUnit])s.pUnit="kpa";
      if(!SCALE_UNITS.includes(s.ma.unit))s.ma.unit="lel";
      return s;
    }
  }catch(_){}
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}
let state=loadState();
let saveTimer=0;
function persist(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(flush,250);
}
function flush(){
  clearTimeout(saveTimer);
  try{localStorage.setItem(STORE_KEY,JSON.stringify(state));}catch(_){}
}

// Параметры выбранного газа с учётом правок пользователя.
function gasParams(){
  const g=gasById.get(state.gas)||GASES[0];
  if(g.id==="custom"){
    const c=state.custom;
    return {g,name:String(c.name||"").trim()||"Свой газ",formula:"",M:parseNum(c.M),lel:parseNum(c.lel),pdk:parseNum(c.pdk),edited:false};
  }
  const o=state.overrides[g.id]||{};
  const baseM=molarMass(g.f);
  const M=o.M!=null&&o.M!==""?parseNum(o.M):baseM;
  const lel=o.lel!=null&&o.lel!==""?parseNum(o.lel):(g.lel??NaN);
  const pdk=o.pdk!=null&&o.pdk!==""?parseNum(o.pdk):(g.pdk??NaN);
  return {g,name:g.name,formula:g.display||g.f,M,lel,pdk,baseM,edited:Object.keys(o).some(k=>o[k]!==""&&o[k]!=null)};
}
function conditions(){
  const t=parseNum(state.t),pRaw=parseNum(state.p),k=P_UNITS[state.pUnit].k;
  const pk=pRaw*k;
  const ok=Number.isFinite(t)&&t>-T0&&Number.isFinite(pk)&&pk>0;
  const Vm=ok?R*(t+T0)/pk:NaN; // Дж/(моль·кПа) = л/моль
  return {t,pk,pRaw,Vm,ok};
}
// Объёмная (мольная) доля x ↔ единицы.
function toFraction(v,unit,c){
  switch(unit){
    case "ppm":return v/1e6;
    case "ppb":return v/1e9;
    case "vol":return v/100;
    case "lel":return c.lel>0?v/100*c.lel/100:NaN;
    case "mg":return c.M>0&&c.Vm>0?v*c.Vm/c.M/1e6:NaN;
    case "g":return c.M>0&&c.Vm>0?v*1000*c.Vm/c.M/1e6:NaN;
  }
  return NaN;
}
function fromFraction(x,unit,c){
  switch(unit){
    case "ppm":return x*1e6;
    case "ppb":return x*1e9;
    case "vol":return x*100;
    case "lel":return c.lel>0?x*100/c.lel*100:NaN;
    case "mg":return c.M>0&&c.Vm>0?x*1e6*c.M/c.Vm:NaN;
    case "g":return c.M>0&&c.Vm>0?x*1e6*c.M/c.Vm/1000:NaN;
  }
  return NaN;
}
function context(){
  const p=gasParams(),cond=conditions();
  return {...p,Vm:cond.Vm,cond};
}
function unitAvailable(unit,c){
  if(unit==="lel")return c.lel>0;
  if(unit==="mg"||unit==="g")return c.M>0&&c.Vm>0;
  return true;
}
function unitBlockReason(unit,c){
  if(unit==="lel")return c.g.id==="custom"?"Укажи НКПР в параметрах газа":"Газ не горючий — НКПР не нормируется";
  if(unit==="mg"||unit==="g")return !(c.Vm>0)?"Проверь температуру и давление":"Укажи молярную массу";
  return "";
}

// ---------------------------------------------------------------- разметка
const ICON={
  copy:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"></rect><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"></path></svg>',
  send:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3 10.5 13.5"></path><path d="m21 3-6.5 18-4-7.5L3 9.5Z"></path></svg>',
  down:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15"></path><path d="m6 13 6 6 6-6"></path></svg>',
  up:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5"></path><path d="m6 11 6-6 6 6"></path></svg>',
  x:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>',
  task:'<svg class="btnIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5h6M9 4.5a1.5 1.5 0 0 0-1.5 1.5H6.5A2 2 0 0 0 4.5 8v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1A1.5 1.5 0 0 0 15 4.5"></path><path d="m8.5 13.5 2.5 2.5 4.5-5"></path></svg>'
};
let root=null,els={},getTags=null;
function chip(cls,attrs,text){return `<button type="button" class="tab ${cls}" ${attrs}>${text}</button>`;}
function template(){
  const groups=GROUPS.map(([gid,label])=>{
    const opts=GASES.filter(g=>g.g===gid).map(g=>`<option value="${g.id}">${esc(g.name)}${g.f?` — ${subText(g.display||g.f)}`:""}</option>`).join("");
    return `<optgroup label="${esc(label)}">${opts}</optgroup>`;
  }).join("");
  const quick=QUICK.map(id=>{const g=gasById.get(id);return chip("gasQuickBtn",`data-gas="${id}" title="${esc(g.name)}"`,subHtml(g.display||g.f));}).join("");
  const units=UNITS.map(u=>chip("gasUnitBtn",`data-unit="${u.id}" role="radio" aria-checked="false" title="${esc(u.title)}"`,esc(u.label))).join("");
  const presets=PRESETS.map(p=>chip("gasPresetBtn",`data-preset="${p.id}" title="${esc(p.title)}"`,esc(p.label))).join("");
  const scale=SCALE_UNITS.map(id=>chip("gasScaleBtn",`data-scale="${id}" role="radio" aria-checked="false"`,esc(unitById.get(id).label))).join("");
  const pUnits=Object.entries(P_UNITS).map(([id,u])=>`<option value="${id}">${esc(u.label)}</option>`).join("");
  return `
<div class="gasGrid">
  <div class="gasCol">
    <section class="gasCard gasO1" aria-labelledby="gasSubstanceTitle">
      <div class="gasCardHead">
        <h2 id="gasSubstanceTitle">Вещество</h2>
        <button type="button" class="gasLink" id="gasParamsToggle" aria-expanded="false" aria-controls="gasParams">Параметры</button>
      </div>
      <div class="field gasField"><label class="gasSr" for="gasSelect">Газ или пар</label><select id="gasSelect">${groups}</select></div>
      <div class="gasChips gasQuick" role="group" aria-label="Быстрый выбор газа">${quick}</div>
      <div class="gasInfo" id="gasInfo"></div>
      <div class="gasParams" id="gasParams" hidden>
        <div class="field" id="gasNameField"><label for="gasCustomName">Название</label><input id="gasCustomName" autocomplete="off" placeholder="Например, смесь С3–С4"/></div>
        <div class="gasParamGrid">
          <div class="field"><label for="gasM">M, г/моль</label><input id="gasM" inputmode="decimal" autocomplete="off"/></div>
          <div class="field"><label for="gasLel">НКПР, % об.</label><input id="gasLel" inputmode="decimal" autocomplete="off" placeholder="—"/></div>
          <div class="field"><label for="gasPdk">ПДК, мг/м³</label><input id="gasPdk" inputmode="decimal" autocomplete="off" placeholder="—"/></div>
        </div>
        <div class="gasParamFoot">
          <span class="mini" id="gasParamsNote">НКПР берите из паспорта прибора, если он отличается.</span>
          <button type="button" class="secondary" id="gasReset">Справочные</button>
        </div>
      </div>
    </section>

    <section class="gasCard gasInputCard gasO2" aria-labelledby="gasValueTitle">
      <div class="gasCardHead"><h2 id="gasValueTitle">Концентрация</h2><span class="gasHeadNote" id="gasValueGas"></span></div>
      <div class="gasValueRow">
        <input id="gasValue" class="gasValueInput" inputmode="decimal" autocomplete="off" enterkeyhint="done" aria-label="Значение концентрации" placeholder="0"/>
        <span class="gasValueUnit" id="gasValueUnit" aria-hidden="true">ppm</span>
        <button type="button" class="gasClear" id="gasClear" aria-label="Очистить значение" title="Очистить">${ICON.x}</button>
      </div>
      <div class="gasUnits" role="radiogroup" aria-label="Единица исходного значения">${units}</div>
      <div class="gasWarn" id="gasWarn" role="status" hidden></div>
    </section>

    <section class="gasCard gasO4" aria-labelledby="gasCondTitle">
      <div class="gasCardHead"><h2 id="gasCondTitle">Условия пересчёта</h2><span class="gasHeadNote" id="gasVm"></span></div>
      <div class="gasChips" role="group" aria-label="Типовые условия">${presets}</div>
      <div class="gasParamGrid gasCondGrid">
        <div class="field"><label for="gasT">Температура, °C</label>
          <div class="gasJoin"><input id="gasT" inputmode="decimal" autocomplete="off"/><button type="button" class="gasSign" id="gasTSign" aria-label="Сменить знак температуры" title="Плюс / минус">±</button></div>
        </div>
        <div class="field"><label for="gasP">Давление (абс.)</label>
          <div class="gasJoin"><input id="gasP" inputmode="decimal" autocomplete="off"/><select id="gasPUnit" aria-label="Единица давления">${pUnits}</select></div>
        </div>
      </div>
      <div class="mini">мг/м³ и г/м³ зависят от температуры и давления; ppm, % об. и % НКПР — нет.</div>
    </section>
  </div>

  <div class="gasCol">
    <section class="gasCard gasResultCard gasO3" aria-labelledby="gasResultTitle">
      <div class="gasCardHead"><h2 id="gasResultTitle">Результат</h2><span class="gasHeadNote" id="gasResultCond"></span></div>
      <div class="gasResults" id="gasResults" aria-live="polite"></div>
      <div class="field gasTagField"><label for="gasTag">Тэг для задания</label><input id="gasTag" autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="done" placeholder="Например, 2131-QT-501"/></div>
      <div class="gasActions gasActions3">
        <button type="button" class="action iconOnly" id="gasCopy" aria-label="Копировать результат" title="Копировать результат">${ICON.copy}</button>
        <button type="button" class="action" id="gasTask" title="Дописать результат в задание тэга">${ICON.task}<span>В задание</span></button>
        <button type="button" class="action primary" id="gasShare">${ICON.send}<span>Отправить</span></button>
      </div>
    </section>

    <section class="gasCard gasO5" aria-labelledby="gasMaTitle">
      <div class="gasCardHead"><h2 id="gasMaTitle">Сигнал 4–20 мА</h2><span class="gasHeadNote">линейная шкала</span></div>
      <div class="gasScaleRow">
        <div class="field"><label for="gasLo">Начало шкалы</label><input id="gasLo" inputmode="decimal" autocomplete="off"/></div>
        <div class="field"><label for="gasHi">Конец шкалы</label><input id="gasHi" inputmode="decimal" autocomplete="off"/></div>
      </div>
      <div class="gasChips gasScaleUnits" role="radiogroup" aria-label="Единица шкалы">${scale}</div>
      <div class="gasMaRow">
        <div class="field"><label for="gasMa">Ток, мА</label><input id="gasMa" inputmode="decimal" autocomplete="off"/></div>
        <span class="gasMaArrow" aria-hidden="true">⇄</span>
        <div class="field"><label for="gasMaVal" id="gasMaValLabel">Значение</label><input id="gasMaVal" inputmode="decimal" autocomplete="off"/></div>
      </div>
      <div class="gasMaStatus" id="gasMaStatus" role="status"></div>
      <div class="gasActions">
        <button type="button" class="action" id="gasFromMain" title="Подставить значение из результата расчёта">${ICON.down}<span>Из расчёта</span></button>
        <button type="button" class="action" id="gasToMain" title="Передать значение шкалы в поле «Концентрация»">${ICON.up}<span>В расчёт</span></button>
      </div>
    </section>

    <details class="gasCard gasHelp gasO6">
      <summary>Формулы и источники</summary>
      <div class="gasFormula">
        <p><b>V<sub>m</sub></b> = R·T / P — молярный объём, л/моль (22,414 при 0 °C; 24,055 при 20 °C; 101,325 кПа)</p>
        <p><b>мг/м³</b> = ppm · M / V<sub>m</sub></p>
        <p><b>% об.</b> = ppm / 10 000 &nbsp;·&nbsp; <b>ppb</b> = ppm · 1000</p>
        <p><b>% НКПР</b> = % об. / НКПР · 100</p>
        <p><b>I</b> = 4 + 16 · (C − C<sub>н</sub>) / (C<sub>в</sub> − C<sub>н</sub>), мА</p>
        <p class="mini">НКПР — справочно по ГОСТ 31610.20-1-2020 (IEC 60079-20-1) и ГОСТ Р 51330.19-99. ПДК р.з. — справочно по СанПиН 1.2.3685-21. Для настройки и проверки газоанализатора используйте значения из паспорта прибора, свидетельства о поверке и проекта. Расчёт — для идеального газа, давление абсолютное. Состояние сигнала — по NAMUR NE 43.</p>
      </div>
    </details>
  </div>
</div>`;
}

function $(id){return els[id]||(els[id]=root.querySelector("#"+id));}

// ---------------------------------------------------------------- отрисовка
function setInput(id,value){
  const el=$(id);
  if(el&&document.activeElement!==el&&el.value!==value)el.value=value;
}
function renderGas(c){
  $("gasSelect").value=state.gas;
  root.querySelectorAll(".gasQuickBtn").forEach(b=>{
    const on=b.dataset.gas===state.gas;
    b.classList.toggle("active",on);b.setAttribute("aria-pressed",String(on));
  });
  const parts=[];
  const formula=c.formula?`<b>${subHtml(c.formula)}</b>`:"";
  parts.push(`<span>${formula?formula+" · ":""}M ${Number.isFinite(c.M)?fmt(c.M,6):"—"} г/моль</span>`);
  parts.push(`<span>НКПР ${c.lel>0?`${fmtLel(c.lel)} % об.`:(c.g.id==="custom"?"—":"не нормируется")}</span>`);
  if(c.pdk>0)parts.push(`<span>ПДК р.з. ${fmt(c.pdk,4)} мг/м³</span>`);
  let html=`<div class="gasInfoLine">${parts.join("")}</div>`;
  const notes=[];
  if(c.edited)notes.push("Изменены параметры — используется значение пользователя");
  if(c.g.pdkNote&&!c.edited)notes.push(`ПДК р.з.: ${c.g.pdkNote}`);
  if(c.g.note)notes.push(c.g.note);
  if(notes.length)html+=`<div class="mini gasInfoNote">${notes.map(esc).join(" · ")}</div>`;
  $("gasInfo").innerHTML=html;
  $("gasValueGas").textContent=c.g.id==="custom"?c.name:`${c.name}${c.formula?` · ${subText(c.formula)}`:""}`;

  const custom=c.g.id==="custom";
  const open=custom||state.params;
  $("gasParams").hidden=!open;
  $("gasParamsToggle").setAttribute("aria-expanded",String(open));
  $("gasParamsToggle").classList.toggle("active",open);
  $("gasParamsToggle").hidden=custom;
  $("gasNameField").hidden=!custom;
  $("gasReset").hidden=custom;
  $("gasParamsNote").textContent=custom
    ?"Укажи молярную массу и НКПР (для горючих газов) — значения сохраняются на устройстве."
    :"НКПР берите из паспорта прибора, если он отличается от справочного.";
  if(custom){
    setInput("gasCustomName",state.custom.name||"");
    setInput("gasM",state.custom.M||"");
    setInput("gasLel",state.custom.lel||"");
    setInput("gasPdk",state.custom.pdk||"");
  }else{
    const o=state.overrides[c.g.id]||{};
    setInput("gasM",o.M!=null&&o.M!==""?o.M:String(c.baseM).replace(".",","));
    setInput("gasLel",o.lel!=null&&o.lel!==""?o.lel:(c.g.lel!=null?String(c.g.lel).replace(".",","):""));
    setInput("gasPdk",o.pdk!=null&&o.pdk!==""?o.pdk:(c.g.pdk!=null?String(c.g.pdk).replace(".",","):""));
  }
  $("gasReset").disabled=!c.edited;
}
function renderUnits(c){
  root.querySelectorAll(".gasUnitBtn").forEach(b=>{
    const u=b.dataset.unit,on=u===state.unit,avail=unitAvailable(u,c);
    b.classList.toggle("active",on);
    b.setAttribute("aria-checked",String(on));
    b.classList.toggle("gasOff",!avail);
    b.title=avail?unitById.get(u).title:unitBlockReason(u,c);
  });
  $("gasValueUnit").textContent=unitById.get(state.unit).label;
}
function renderConditions(c){
  setInput("gasT",state.t);
  setInput("gasP",state.p);
  $("gasPUnit").value=state.pUnit;
  const cond=c.cond;
  $("gasVm").textContent=cond.ok?`Vm ${fmt(cond.Vm,5)} л/моль`:"проверь T и P";
  $("gasVm").classList.toggle("gasBad",!cond.ok);
  root.querySelectorAll(".gasPresetBtn").forEach(b=>{
    const p=PRESETS.find(x=>x.id===b.dataset.preset);
    const on=cond.ok&&Math.abs(cond.t-p.t)<1e-9&&Math.abs(cond.pk-p.p)<1e-6;
    b.classList.toggle("active",on);b.setAttribute("aria-pressed",String(on));
  });
  $("gasResultCond").textContent=cond.ok?`${fmt(cond.t,4)} °C · ${fmt(cond.pRaw,6)} ${P_UNITS[state.pUnit].label}`:"";
}
function currentFraction(c){
  const v=parseNum(state.value);
  if(!Number.isFinite(v))return {v,x:NaN};
  return {v,x:toFraction(v,state.unit,c)};
}
function maScale(){
  const lo=parseNum(state.ma.lo),hi=parseNum(state.ma.hi);
  return {lo,hi,ok:Number.isFinite(lo)&&Number.isFinite(hi)&&hi!==lo};
}
function mAFor(value,s){return 4+16*(value-s.lo)/(s.hi-s.lo);}
function namur(mA){
  if(!Number.isFinite(mA))return {cls:"",text:""};
  if(mA<=3.6)return {cls:"gasBad",text:"Сигнал отказа: ≤ 3,6 мА (NAMUR NE 43)"};
  if(mA<3.8)return {cls:"gasBad",text:"Ниже диапазона измерения (< 3,8 мА)"};
  if(mA<4)return {cls:"gasWarnText",text:"Ниже нуля шкалы — в пределах 3,8–4 мА"};
  if(mA<=20)return {cls:"gasOk",text:"В диапазоне шкалы 4–20 мА"};
  if(mA<=20.5)return {cls:"gasWarnText",text:"Выше шкалы — в пределах 20–20,5 мА"};
  if(mA<21)return {cls:"gasBad",text:"Выше диапазона измерения (> 20,5 мА)"};
  return {cls:"gasBad",text:"Сигнал отказа: ≥ 21 мА (NAMUR NE 43)"};
}
function renderResults(c){
  const {v,x}=currentFraction(c);
  const warn=[];
  let html="";
  if(!Number.isFinite(v)){
    html=`<div class="gasEmpty">Введи значение концентрации</div>`;
  }else if(!Number.isFinite(x)){
    html=`<div class="gasEmpty">${esc(unitBlockReason(state.unit,c))}</div>`;
  }else{
    if(x<0)warn.push("Отрицательная концентрация — проверь значение.");
    if(x>1)warn.push("Больше 100 % об. — проверь единицы измерения.");
    const rows=UNITS.filter(u=>unitAvailable(u.id,c)).map(u=>{
      const val=fromFraction(x,u.id,c);
      const avail=Number.isFinite(val);
      const src=u.id===state.unit;
      let extra="";
      if(u.id==="lel"&&avail){
        const pct=Math.max(0,Math.min(100,val));
        extra=`<span class="progressTrack gasBar" aria-hidden="true"><span class="progressFill${val>=100?" gasFillBad":""}" style="width:${pct}%"></span></span>`;
        if(val>=100)warn.push("Концентрация на уровне НКПР и выше — взрывоопасная среда.");
      }
      return `<button type="button" class="gasRow${src?" gasSrc":""}${avail?"":" gasOff"}" data-copy-unit="${u.id}" ${avail?"":"disabled"} title="${avail?"Нажми, чтобы скопировать":esc(unitBlockReason(u.id,c))}">
        <span class="gasRowLabel">${esc(u.label)}${src?'<i>исходное</i>':""}</span>
        <span class="gasRowValue">${avail?fmt(val):"—"}</span>${extra}</button>`;
    });
    if(c.pdk>0&&c.M>0&&c.Vm>0){
      const mg=fromFraction(x,"mg",c),k=mg/c.pdk;
      rows.push(`<button type="button" class="gasRow gasExtra${k>=1?" gasRowBad":""}" data-copy-text="${esc(`${fmt(k,4)} ПДК`)}" title="Нажми, чтобы скопировать">
        <span class="gasRowLabel">Доля ПДК р.з.<i>${fmt(c.pdk,4)} мг/м³</i></span><span class="gasRowValue">${fmt(k,4)} ×</span></button>`);
      if(k>=1)warn.push("Превышение ПДК рабочей зоны.");
    }
    const s=maScale();
    if(s.ok&&unitAvailable(state.ma.unit,c)){
      const sv=fromFraction(x,state.ma.unit,c);
      const mA=mAFor(sv,s);
      if(Number.isFinite(mA)){
        rows.push(`<button type="button" class="gasRow gasExtra" data-copy-text="${esc(`${fmtFixed(mA,2)} мА`)}" title="Шкала ${esc(`${fmt(s.lo)}–${fmt(s.hi)} ${unitById.get(state.ma.unit).label}`)}">
          <span class="gasRowLabel">Ток 4–20 мА<i>шкала ${esc(`${fmt(s.lo)}–${fmt(s.hi)} ${unitById.get(state.ma.unit).label}`)}</i></span><span class="gasRowValue">${fmtFixed(mA,2)} мА</span></button>`);
      }
    }
    html=rows.join("");
  }
  $("gasResults").innerHTML=html;
  const w=$("gasWarn");
  w.hidden=!warn.length;
  w.textContent=warn.join(" ");
  w.classList.toggle("gasWarnDanger",warn.some(t=>/взрывоопас|Превышение/.test(t)));
}
function renderMa(c){
  const ma=state.ma,s=maScale(),unitLabel=unitById.get(ma.unit).label;
  setInput("gasLo",ma.lo);setInput("gasHi",ma.hi);
  root.querySelectorAll(".gasScaleBtn").forEach(b=>{
    const on=b.dataset.scale===ma.unit,avail=unitAvailable(b.dataset.scale,c);
    b.classList.toggle("active",on);b.setAttribute("aria-checked",String(on));
    b.classList.toggle("gasOff",!avail);
    b.title=avail?"":unitBlockReason(b.dataset.scale,c);
  });
  $("gasMaValLabel").textContent=`Значение, ${unitLabel}`;
  let mA=parseNum(ma.mA),val=parseNum(ma.val);
  if(s.ok){
    if(ma.last==="val"){mA=Number.isFinite(val)?mAFor(val,s):NaN;setInput("gasMa",Number.isFinite(mA)?fmtPlain(mA,4):"");}
    else{val=Number.isFinite(mA)?s.lo+(mA-4)/16*(s.hi-s.lo):NaN;setInput("gasMaVal",Number.isFinite(val)?fmtPlain(val,5):"");}
  }
  const st=$("gasMaStatus");
  if(!s.ok){st.className="gasMaStatus gasBad";st.textContent="Начало и конец шкалы должны различаться";return;}
  const n=namur(mA);
  let text=n.text;
  if(!unitAvailable(ma.unit,c))text=(text?text+" · ":"")+unitBlockReason(ma.unit,c);
  st.className=`gasMaStatus ${n.cls}`;
  st.textContent=text;
  $("gasToMain").disabled=!Number.isFinite(val);
}
// Число для подстановки в поле ввода: без пробелов-разделителей, с запятой.
function fmtPlain(x,sig){
  if(!Number.isFinite(x))return "";
  const r=Number(x.toPrecision(sig));
  return String(Math.abs(r)<1e-6&&r!==0?r.toExponential():r).replace(".",",");
}
function render(){
  if(!root)return;
  const c=context();
  renderGas(c);renderUnits(c);renderConditions(c);renderResults(c);renderMa(c);
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
    toast(label||"Скопировано");
  }catch(_){toast("Не удалось скопировать");}
}
function summaryText(){
  const c=context(),{v,x}=currentFraction(c);
  if(!Number.isFinite(x))return "";
  const head=`${c.name}${c.formula?` (${c.formula})`:""}`;
  const order=[state.unit,...UNITS.map(u=>u.id).filter(id=>id!==state.unit&&id!=="ppb"&&id!=="g")];
  const vals=order.map(id=>{const val=fromFraction(x,id,c);return Number.isFinite(val)?`${plain(fmt(val))} ${unitById.get(id).label}`:null;}).filter(Boolean);
  const lines=[`Газоанализ — ${head}`,vals.join(" = ")];
  const extra=[];
  if(c.pdk>0&&c.M>0&&c.Vm>0)extra.push(`${plain(fmt(fromFraction(x,"mg",c)/c.pdk,4))} ПДК р.з. (${plain(fmt(c.pdk,4))} мг/м³)`);
  const s=maScale();
  if(s.ok&&unitAvailable(state.ma.unit,c)){
    const mA=mAFor(fromFraction(x,state.ma.unit,c),s);
    if(Number.isFinite(mA))extra.push(`${plain(fmtFixed(mA,2))} мА (шкала ${plain(fmt(s.lo))}–${plain(fmt(s.hi))} ${unitById.get(state.ma.unit).label})`);
  }
  if(extra.length)lines.push(extra.join("; "));
  const cond=c.cond;
  const cParts=[`${plain(fmt(cond.t,4))} °C`,`${plain(fmt(cond.pRaw,6))} ${P_UNITS[state.pUnit].label}`,`Vm ${plain(fmt(cond.Vm,5))} л/моль`];
  if(c.lel>0)cParts.push(`НКПР ${plain(fmtLel(c.lel))} % об.`);
  if(Number.isFinite(c.M))cParts.push(`M ${plain(fmt(c.M,6))} г/моль`);
  lines.push(`Условия: ${cParts.join(", ")}`);
  return lines.join("\n");
}
// v97: подсказки тегов под полем (общий компонент из app.js) вместо <datalist>.
let tagPicker=null;
function refreshTagList(){
  const input=root&&root.querySelector("#gasTag");if(!input)return;
  const app=window.TagListApp;
  if(!tagPicker&&app?.attachTagPicker)tagPicker=app.attachTagPicker(input);
  tagPicker?.refresh();
}
function saveToTask(){
  const tag=String($("gasTag").value||"").trim();
  if(!tag){toast("Укажите тэг — результат запишется в его задание");$("gasTag").focus();return;}
  const text=summaryText();
  if(!text){toast("Нет результата для записи");return;}
  const app=window.TagListApp;
  if(!app?.addResultToTag){toast("Список тэгов недоступен");return;}
  const r=app.addResultToTag(tag,text.replace(/^Газоанализ — /,"Газоанализ, "));
  if(!r.ok){toast(r.message||"Не удалось записать");return;}
  toast(r.created?`Создан тэг ${r.tag} на странице «${r.page}», результат — в задании`:`Записано в задание ${r.tag}`);
  refreshTagList();
}
async function shareSummary(){
  const text=summaryText();
  if(!text){toast("Нет результата для отправки");return;}
  try{
    if(typeof navigator.share==="function"){await navigator.share({title:"Газоанализ",text});toast("Результат передан");return;}
  }catch(e){if(e?.name==="AbortError")return;}
  await copyText(text,"Результат скопирован");
}
function selectGas(id){
  if(!gasById.has(id))return;
  state.gas=id;
  const c=context();
  // Если выбранная единица недоступна для нового газа — переходим на ppm.
  if(!unitAvailable(state.unit,c))state.unit="ppm";
  persist();render();
}
function setOverride(field,value){
  const c=gasParams();
  if(c.g.id==="custom"){state.custom[field]=value;}
  else{
    const o={...(state.overrides[c.g.id]||{})};
    const base=field==="M"?c.baseM:(field==="lel"?c.g.lel:c.g.pdk);
    const num=parseNum(value);
    if(value.trim()===""&&base==null)delete o[field];
    else if(Number.isFinite(num)&&base!=null&&Math.abs(num-base)<1e-9)delete o[field];
    else o[field]=value;
    if(Object.keys(o).length)state.overrides[c.g.id]=o;else delete state.overrides[c.g.id];
  }
  persist();
}

function bind(){
  root.addEventListener("click",e=>{
    const t=e.target.closest("button");
    if(!t||!root.contains(t)||t.disabled)return;
    if(t.dataset.gas){selectGas(t.dataset.gas);return;}
    if(t.dataset.unit){
      const c=context();
      if(!unitAvailable(t.dataset.unit,c)){toast(unitBlockReason(t.dataset.unit,c));return;}
      state.unit=t.dataset.unit;persist();render();return;
    }
    if(t.dataset.preset){
      const p=PRESETS.find(x=>x.id===t.dataset.preset);
      state.t=String(p.t);
      state.p=fmtPlain(p.p/P_UNITS[state.pUnit].k,6);
      persist();render();return;
    }
    if(t.dataset.scale){
      const c=context(),u=t.dataset.scale;
      if(!unitAvailable(u,c)){toast(unitBlockReason(u,c));return;}
      state.ma.unit=u;
      if(u==="lel"){state.ma.lo="0";state.ma.hi="100";}
      persist();render();return;
    }
    if(t.dataset.copyUnit){
      const c=context(),{x}=currentFraction(c);
      const val=fromFraction(x,t.dataset.copyUnit,c);
      if(Number.isFinite(val)){const s=`${plain(fmt(val))} ${unitById.get(t.dataset.copyUnit).label}`;copyText(s,`Скопировано: ${s}`);}
      return;
    }
    if(t.dataset.copyText){copyText(plain(t.dataset.copyText),`Скопировано: ${plain(t.dataset.copyText)}`);return;}
    switch(t.id){
      case "gasParamsToggle":state.params=!state.params;persist();render();
        if(state.params)setTimeout(()=>$("gasLel")?.focus({preventScroll:false}),30);break;
      case "gasReset":delete state.overrides[state.gas];persist();
        ["gasM","gasLel","gasPdk"].forEach(id=>{$(id).value="";});render();toast("Восстановлены справочные значения");break;
      case "gasTSign":{
        // На iPhone в цифровой клавиатуре нет минуса — знак меняется кнопкой.
        const t=String(state.t||"").trim();
        state.t=t.startsWith("-")||t.startsWith("−")?t.replace(/^[-−]\s*/,""):`-${t||"0"}`;
        $("gasT").value=state.t;persist();render();break;
      }
      case "gasClear":state.value="";$("gasValue").value="";persist();render();$("gasValue").focus();break;
      case "gasCopy":{const s=summaryText();if(s)copyText(s,"Результат скопирован");else toast("Нет результата для копирования");break;}
      case "gasShare":shareSummary();break;
      case "gasTask":saveToTask();break;
      case "gasFromMain":{
        const c=context(),{x}=currentFraction(c);
        const val=fromFraction(x,state.ma.unit,c);
        if(!Number.isFinite(val)){toast("В расчёте нет значения для этой шкалы");break;}
        state.ma.val=fmtPlain(val,5);state.ma.last="val";$("gasMaVal").value=state.ma.val;persist();render();break;
      }
      case "gasToMain":{
        const val=parseNum($("gasMaVal").value);
        if(!Number.isFinite(val))break;
        state.unit=state.ma.unit;state.value=fmtPlain(val,5);$("gasValue").value=state.value;persist();render();
        const card=root.querySelector(".gasInputCard");
        try{card.scrollIntoView({block:"center",behavior:"smooth"});}catch(_){}
        card.classList.remove("gasFlash");void card.offsetWidth;card.classList.add("gasFlash");
        break;
      }
    }
  });
  root.addEventListener("input",e=>{
    const t=e.target,v=t.value;
    switch(t.id){
      case "gasValue":state.value=v;break;
      case "gasT":state.t=v;break;
      case "gasP":state.p=v;break;
      case "gasCustomName":state.custom.name=v;break;
      case "gasM":setOverride("M",v);break;
      case "gasLel":setOverride("lel",v);break;
      case "gasPdk":setOverride("pdk",v);break;
      case "gasLo":state.ma.lo=v;break;
      case "gasHi":state.ma.hi=v;break;
      case "gasMa":state.ma.mA=v;state.ma.last="mA";break;
      case "gasMaVal":state.ma.val=v;state.ma.last="val";break;
      case "gasTag":state.tag=v;persist();return;
      default:return;
    }
    persist();render();
  });
  root.addEventListener("change",e=>{
    const t=e.target;
    if(t.id==="gasSelect"){selectGas(t.value);t.blur();}
    else if(t.id==="gasPUnit"){
      // Давление пересчитывается в новую единицу — физическое значение сохраняется.
      const pk=parseNum(state.p)*P_UNITS[state.pUnit].k;
      state.pUnit=t.value;
      if(Number.isFinite(pk))state.p=fmtPlain(pk/P_UNITS[state.pUnit].k,6);
      persist();render();
    }
  });
  // Enter в любом поле прячет клавиатуру — результат уже посчитан.
  root.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches("input")){e.preventDefault();e.target.blur();}});
}

function mount(container,opts={}){
  if(typeof opts.getTags==="function")getTags=opts.getTags;
  if(root&&root===container&&root.firstElementChild){refreshTagList();return;}
  root=container;els={};tagPicker=null;
  root.innerHTML=template();
  bind();
  setInput("gasTag",state.tag||"");refreshTagList();
  setInput("gasValue",state.value);
  if(state.ma.last==="val")setInput("gasMaVal",state.ma.val);else setInput("gasMa",state.ma.mA);
  render();
}

window.TagListGas={
  version:"97.1",
  mount,
  onShow(){refreshTagList();render();},
  onHide(){flush();},
  // Для тестов и отладки.
  _api:{molarMass,parseNum,fmt,toFraction,fromFraction,namur,GASES,summaryText,get state(){return state;}}
};
})();
