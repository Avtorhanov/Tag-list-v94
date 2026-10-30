/* Tag list v107 — язык интерфейса: русский / English.
   Исходные строки приложения — русские; английский берётся из словаря EN по точному тексту.
   TX("Записано в задание {0}", tag) — перевод и подстановка {0}, {1}…; в русском режиме — сама строка.
   Статичная разметка index.html переводится здесь же: запоминаются исходные тексты и подписи
   (aria-label, title, placeholder), при смене языка они переписываются, только если приложение
   их не меняло само. Динамические части приложение и модули перерисовывают по событию
   «tl-langchange». Выбор хранится на устройстве (localStorage, kip-lang-v1). */
(function(){
"use strict";
const KEY="kip-lang-v1";
function readLang(){try{const v=localStorage.getItem(KEY);if(v==="en"||v==="ru")return v;}catch(_){}return "ru";}
let lang=readLang();
const EN=Object.create(null);
const HTML=Object.create(null);

function fill(s,args){
  if(!args.length)return s;
  return s.replace(/\{(\d+)\}/g,(m,i)=>args[i]!==undefined&&args[i]!==null?String(args[i]):m);
}
// Перевод строки. Нет перевода — исходная строка (так же ведёт себя и русский режим).
function TX(s,...args){
  const k=String(s??"");
  const v=lang==="en"&&EN[k]!=null?EN[k]:k;
  return fill(v,args);
}
// Перевод готового сообщения (ошибки модулей, тосты из APK): точное совпадение или шаблон.
const PATTERNS=[];
function msg(s){
  const k=String(s??"");
  if(lang!=="en")return k;
  if(EN[k]!=null)return EN[k];
  for(const [re,rep] of PATTERNS)if(re.test(k))return k.replace(re,rep);
  return k;
}
TX.msg=msg;

// ---------------------------------------------------------------- статичная разметка
const textRecs=[],attrRecs=[];
const ATTRS=["aria-label","title","placeholder"];
function collect(root){
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  for(let n=walker.currentNode;n;n=walker.nextNode()){
    if(n.nodeType===3){
      const p=n.parentElement;
      if(!p||/^(SCRIPT|STYLE|TEXTAREA)$/.test(p.tagName))continue;
      const raw=n.nodeValue,t=raw.trim();
      if(!t||EN[t]==null)continue;
      const lead=raw.slice(0,raw.indexOf(t)),trail=raw.slice(raw.indexOf(t)+t.length);
      textRecs.push({n,ru:t,lead,trail,last:raw});
    }else if(n.nodeType===1){
      if(n.hasAttribute("data-i18n-skip")){walker.currentNode=lastDescendant(n);continue;}
      for(const a of ATTRS){
        const v=n.getAttribute(a);
        if(v&&EN[v.trim()]!=null)attrRecs.push({el:n,a,ru:v.trim(),last:v});
      }
    }
  }
}
function lastDescendant(n){while(n.lastChild)n=n.lastChild;return n;}
function applyStatic(){
  for(const r of textRecs){
    if(!r.n.isConnected||r.n.nodeValue!==r.last)continue;
    const v=r.lead+TX(r.ru)+r.trail;
    if(v!==r.last){r.n.nodeValue=v;r.last=v;}
  }
  for(const r of attrRecs){
    if(!r.el.isConnected||r.el.getAttribute(r.a)!==r.last)continue;
    const v=TX(r.ru);
    if(v!==r.last){r.el.setAttribute(r.a,v);r.last=v;}
  }
}

// ---------------------------------------------------------------- кнопка RU / EN
function syncButton(){
  const b=document.getElementById("langBtn");
  if(!b)return;
  b.dataset.lang=lang;
  // v115: одна кнопка — показывает текущий язык, нажатие переключает RU ↔ EN.
  const cur=b.querySelector(".langCur");if(cur)cur.textContent=lang==="en"?"EN":"RU";
  b.setAttribute("aria-pressed",String(lang==="en"));
  b.setAttribute("aria-label",lang==="en"?"Interface language: English. Переключить на русский":"Язык интерфейса: русский. Switch to English");
  b.title=lang==="en"?"English → Русский":"Русский → English";
}
function syncDoc(){
  document.documentElement.lang=lang;
  document.documentElement.classList.remove("tl-i18n-pending");
}

function setLang(next){
  next=next==="en"?"en":"ru";
  if(next===lang)return;
  lang=next;
  try{localStorage.setItem(KEY,lang);}catch(_){}
  syncDoc();applyStatic();syncButton();
  try{window.AndroidApp?.setLanguage?.(lang);}catch(_){}
  try{window.dispatchEvent(new CustomEvent("tl-langchange",{detail:{lang}}));}catch(e){console.warn("Tag list: langchange",e);}
}

const I18N={
  get lang(){return lang;},
  get en(){return lang==="en";},
  // Дата и время: en-GB — 15/10/2026, 16:35 (24 часа, день перед месяцем).
  get locale(){return lang==="en"?"en-GB":"ru-RU";},
  // Числа: в английском — десятичная точка. Вывод ru-RU форматирования (запятая — только
  // десятичный разделитель, разряды — неразрывный пробел) переводится заменой запятой.
  get dec(){return lang==="en"?".":",";},
  num(s){return lang==="en"?String(s).replace(/,/g,"."):String(s);},
  // Значение поля ввода (как ввёл пользователь): в английском — точка вместо десятичной запятой.
  inNum(v){v=String(v??"");return lang==="en"&&/^[\s\d,.\-−+eE  ]*$/.test(v)?v.replace(/,/g,"."):v;},
  html(key,ru){return lang==="en"&&HTML[key]!=null?HTML[key]:ru;},
  add(dict){Object.assign(EN,dict);},
  addHtml(dict){Object.assign(HTML,dict);},
  addPatterns(list){PATTERNS.push(...list);},
  has(s){return EN[String(s)]!=null;},
  set:setLang,
  toggle(){setLang(lang==="en"?"ru":"en");},
  refreshStatic:applyStatic,
  _dict:EN
};
window.TX=TX;
window.I18N=I18N;

let inited=false;
function init(){
  if(inited)return;inited=true;
  collect(document.body);
  syncDoc();
  if(lang==="en")applyStatic();
  syncButton();
  try{window.AndroidApp?.setLanguage?.(lang);}catch(_){}
  const b=document.getElementById("langBtn");
  if(b)b.addEventListener("click",()=>I18N.toggle());
}
// Разметка размечается после загрузки словаря (js/i18n-en.js вызывает _init) — до app.js,
// пока в документе только статичная разметка. app.js на всякий случай вызывает _init сам.
I18N._init=init;
})();
