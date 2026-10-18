
// v107: язык интерфейса (js/i18n.js). Запасной вариант — русский без перевода, если словарь не загрузился.
if(typeof window.TX!=="function"){
  window.TX=(s,...a)=>String(s??"").replace(/\{(\d+)\}/g,(m,i)=>a[i]!==undefined?String(a[i]):m);
  window.TX.msg=s=>String(s??"");
}
try{window.I18N?._init?.();}catch(_){}
const LOC=()=>window.I18N?.locale||"ru-RU";
// v98: на Android карточки тегов плотнее по вертикали (см. css «v98 Android»).
try{if(/Android/i.test(navigator.userAgent||""))document.documentElement.classList.add("is-android");}catch(_){}

function safeGetStorage(key,fallback=null){
  try{const value=localStorage.getItem(key);return value===null?fallback:value;}
  catch(e){return fallback;}
}

function loadDocumentTitle(){
  const saved=(safeGetStorage(DOC_TITLE_KEY,"")||"").trim();
  // Migrate the previous built-in title; keep any user-defined title unchanged.
  if(saved==="КИП — чек-лист" || saved==="КИП — чек-лист • v67" || saved==="Tag-list"){
    safeSetStorage(DOC_TITLE_KEY,DEFAULT_TITLE);
    safeSetStorage("kip-last-file-name",DEFAULT_TITLE);
    return DEFAULT_TITLE;
  }
  return saved || DEFAULT_TITLE;
}

function applyDocumentTitle(){
  const el=$("docTitle");
  if(el) el.textContent=docTitle;
  document.title=docTitle;
  const appleMeta=document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if(appleMeta) appleMeta.setAttribute("content",docTitle);
  const appMeta=document.querySelector('meta[name="application-name"]');
  if(appMeta) appMeta.setAttribute("content",docTitle);
}

function saveDocumentTitle(){
  const el=$("docTitle");
  const value=(el?.textContent||"").replace(/\s+/g," ").trim();
  docTitle=value||DEFAULT_TITLE;
  safeSetStorage(DOC_TITLE_KEY,docTitle);
  safeSetStorage("kip-last-file-name",docTitle);
  const page=getActivePage();if(page){page.updatedAt=new Date().toISOString();persistPages();}
  applyDocumentTitle();
  renderLastSaved();
}

function cloneInitial(){ return INITIAL_DATA.map(x => ({...x, task:String(x.task||"")})); }

function normalizeItem(value,index=0){
  const x=(value&&typeof value==="object")?value:{};
  const numericId=Number(x.id);
  return {
    id:Number.isFinite(numericId)&&numericId>=0?numericId:index+1,
    unit:String(x.unit??"").trim(),
    tag:String(x.tag??"").trim(),
    done:x.done===true || x.done===1 || x.done==="true",
    task:String(x.task??"")
  };
}

function cloneItems(items){
  return Array.isArray(items) ? items.map((x,i)=>normalizeItem(x,i)).filter(x=>x.tag || x.unit || x.task) : [];
}

function safeSetStorage(key,value){
  try{localStorage.setItem(key,value);return true;}
  catch(e){
    console.warn("Tag list: local storage write failed",e);
    // v81: раньше ошибка записи была «тихой» — пользователь думал, что всё сохранено.
    const now=Date.now();
    if(typeof showToast==="function" && now-(safeSetStorage.lastWarn||0)>8000){
      safeSetStorage.lastWarn=now;
      setTimeout(()=>{try{showToast(TX("Не удалось сохранить на устройстве: память браузера заполнена. Сохрани JSON-копию."));}catch(_){}} ,0);
    }
    return false;
  }
}

function loadData(){
  try{
    const raw = safeGetStorage(DATA_KEY,null);
    if(raw){
      const parsed = JSON.parse(raw);
      if(Array.isArray(parsed) && parsed.length) return cloneItems(parsed);
    }
  }catch(e){}
  const fresh = cloneInitial();
  safeSetStorage(DATA_KEY, JSON.stringify(fresh));
  return fresh;
}

function createPageId(){return `page-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;}

function normalizePageName(value,fallback=TX("Страница")){
  const base=String(value??"").replace(/\s+/g," ").trim().slice(0,60)||fallback;
  const used=new Set(pages.map(page=>String(page.name||"").trim().toLocaleLowerCase("ru-RU")));
  if(!used.has(base.toLocaleLowerCase("ru-RU")))return base;
  let n=2;
  while(used.has(`${base} (${n})`.toLocaleLowerCase("ru-RU")))n++;
  return `${base} (${n})`.slice(0,60);
}

function normalizeUniquePageNames(list){
  const used=new Set();
  return list.map((page,index)=>{
    const raw=String(page.name||TX("Страница {0}",index+1)).replace(/\s+/g," ").trim()||TX("Страница {0}",index+1);
    let name=raw.slice(0,60), n=2;
    while(used.has(name.toLocaleLowerCase("ru-RU"))){
      const suffix=` (${n++})`;
      name=`${raw.slice(0,60-suffix.length)}${suffix}`;
    }
    used.add(name.toLocaleLowerCase("ru-RU"));
    return {...page,name};
  });
}

function decodeSharedState(token){
  try{
    const normalized=String(token||"").replace(/-/g,"+").replace(/_/g,"/");
    const padded=normalized+"=".repeat((4-normalized.length%4)%4);
    const binary=atob(padded);
    const bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
    const parsed=JSON.parse(new TextDecoder().decode(bytes));
    if(!parsed || parsed.v!==1 || !Array.isArray(parsed.pages) || !parsed.pages.length)return null;
    return parsed;
  }catch(_){return null;}
}

function readSharedStateFromUrl(){
  const hash=String(location.hash||"");
  const match=hash.match(/^#state=([^&]+)$/);
  if(!match)return null;
  const state=decodeSharedState(match[1]);
  if(state){
    try{history.replaceState(null,"",location.pathname+location.search);}catch(_){location.hash="";}
  }
  return state;
}

function loadPages(){
  try{
    const raw=safeGetStorage(PAGES_KEY,null);
    if(raw){
      const parsed=JSON.parse(raw);
      if(Array.isArray(parsed) && parsed.length){
        const restored=normalizeUniquePageNames(parsed.map((page,index)=>({
          id:String(page.id||createPageId()),
          name:String(page.name||TX("Страница {0}",index+1)).trim()||TX("Страница {0}",index+1),
          data:cloneItems(page.data),
          updatedAt:page.updatedAt||new Date().toISOString()
        })));
        safeSetStorage(PAGES_KEY,JSON.stringify(restored));
        return restored;
      }
    }
  }catch(e){}
  if(Array.isArray(INITIAL_PAGES) && INITIAL_PAGES.length){
    const restored=normalizeUniquePageNames(INITIAL_PAGES.map((page,index)=>({id:String(page.id||createPageId()),name:String(page.name||TX("Страница {0}",index+1)).trim()||TX("Страница {0}",index+1),data:cloneItems(page.data),updatedAt:page.updatedAt||new Date().toISOString()})));
    safeSetStorage(PAGES_KEY,JSON.stringify(restored));
    return restored;
  }
  const first={id:createPageId(),name:TX("Основная страница"),data:loadData(),updatedAt:new Date().toISOString()};
  safeSetStorage(PAGES_KEY,JSON.stringify([first]));
  return [first];
}

function loadActivePageId(){
  const stored=safeGetStorage(ACTIVE_PAGE_KEY,null);
  return pages.some(page=>page.id===stored) ? stored : pages[0].id;
}

function getActivePage(){return pages.find(page=>page.id===activePageId)||pages[0];}

function persistPages(){tagIndexVersion=(tagIndexVersion|0)+1;safeSetStorage(PAGES_KEY,JSON.stringify(pages));safeSetStorage(ACTIVE_PAGE_KEY,activePageId);}
// v100: версия данных для кэша тегов конверторов (подсказки, «В списке · страница»).
var tagIndexVersion=0;

function formatSaved(value){
  const date=new Date(value||0);
  if(Number.isNaN(date.getTime()))return TX("Сохранено на устройстве: —");
  return TX("Сохранено на устройстве: {0}",date.toLocaleString(LOC(),{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}));
}

function renderLastSaved(){
  const el=$("lastSavedText")||$("lastSaved"),page=getActivePage();
  if(el&&page)el.textContent=formatSaved(page.updatedAt);
}

function renderPages(){
  const strip=$("pageStrip");
  if(!strip)return;
  strip.innerHTML="";
  pages.forEach(page=>{
    const button=document.createElement("button");
    button.type="button";
    button.className="pageChip"+(page.id===activePageId?" active":"")+(selectedPageIds.has(page.id)?" selected":"");
    if(page.id===activePageId) button.setAttribute("aria-current","page");
    button.title=pageManageMode?TX("Нажми для выбора страницы"):TX("Нажми для открытия • удерживай для управления");
    if(pageManageMode){
      const mark=document.createElement("span");
      mark.className="pageChipMark";mark.textContent="✓";mark.setAttribute("aria-hidden","true");
      button.appendChild(mark);
    }
    const nameViewport=document.createElement("span");
    nameViewport.className="pageNameViewport";
    const name=document.createElement("span");
    name.className="pageNameText";
    name.textContent=page.name;
    nameViewport.appendChild(name);
    const count=document.createElement("span");count.className="pageCount";count.textContent=`• ${page.data.length}`;
    button.append(nameViewport,count);
    if(page.id===activePageId){
      requestAnimationFrame(()=>{
        const distance=Math.max(0,name.scrollWidth-nameViewport.clientWidth);
        if(distance>2){nameViewport.classList.add("is-marquee");nameViewport.style.setProperty("--marquee-distance",`${distance}px`);}
      });
    }
    button.onclick=()=>{
      if(pageLongPressTriggered){pageLongPressTriggered=false;return;}
      if(pageManageMode){togglePageSelection(page.id);return;}
      selectPage(page.id);
    };
    button.addEventListener("selectstart",e=>e.preventDefault());
    button.addEventListener("dragstart",e=>e.preventDefault());
    let pressX=0,pressY=0;
    button.addEventListener("pointerdown",e=>{
      if(e.pointerType==="mouse" && e.button!==0)return;
      pressX=e.clientX;pressY=e.clientY;
      startPageLongPress(page.id);
    });
    button.addEventListener("pointermove",e=>{
      if(Math.abs(e.clientX-pressX)>10 || Math.abs(e.clientY-pressY)>10)cancelPageLongPress();
    });
    button.addEventListener("pointerup",cancelPageLongPress);
    button.addEventListener("pointercancel",cancelPageLongPress);
    button.addEventListener("contextmenu",e=>{e.preventDefault();cancelPageLongPress();enterPageManage(page.id,false);});
    strip.appendChild(button);
  });
  updatePageManageBar();
}

function startPageLongPress(id){
  cancelPageLongPress();
  pageLongPressTriggered=false;
  pageLongPressTimer=setTimeout(()=>{
    pageLongPressTimer=null;
    pageLongPressTriggered=true;
    enterPageManage(id,false);
    if(navigator.vibrate)navigator.vibrate(25);
  },650);
}

function cancelPageLongPress(){
  if(pageLongPressTimer){clearTimeout(pageLongPressTimer);pageLongPressTimer=null;}
}

function updatePageManageBar(){
  const bar=$("pageManageBar");
  if(!bar)return;
  bar.classList.toggle("show",pageManageMode);
  const edit=$("pageManageEdit"),del=$("pageManageDelete");
  if(edit){edit.disabled=selectedPageIds.size!==1;edit.style.opacity=selectedPageIds.size===1?"1":".45";}
  if(del){del.disabled=selectedPageIds.size===0;del.style.opacity=selectedPageIds.size?"1":".45";}
}

function enterPageManage(id,selectAll=false){
  pageManageMode=true;
  selectedPageIds=selectAll?new Set(pages.map(page=>page.id)):new Set([id]);
  renderPages();
  updatePageManageBar();
}

function exitPageManage(){
  pageManageMode=false;
  selectedPageIds.clear();
  closePageContextMenu();
  renderPages();
  updatePageManageBar();
}

function togglePageSelection(id){
  if(selectedPageIds.has(id))selectedPageIds.delete(id);
  else selectedPageIds.add(id);
  renderPages();
  updatePageManageBar();
}

function selectAllPages(){
  if(selectedPageIds.size===pages.length)selectedPageIds.clear();
  else selectedPageIds=new Set(pages.map(page=>page.id));
  renderPages();
  updatePageManageBar();
}

function editSelectedPage(){
  if(selectedPageIds.size!==1)return;
  const id=[...selectedPageIds][0],page=pages.find(item=>item.id===id);
  if(!page)return;
  const name=prompt(TX("Название страницы"),page.name);
  if(name===null)return;
  const clean=name.replace(/\s+/g," ").trim();
  if(!clean){showToast(TX("Название не изменено"));return;}
  page.name=normalizePageName(clean,page.name);page.updatedAt=new Date().toISOString();
  persistPages();exitPageManage();showToast(TX("Название страницы сохранено"));
}

async function deleteSelectedPages(){
  const ids=[...selectedPageIds];
  resetTagSelection();
  if(!ids.length)return;
  pages=pages.filter(page=>!ids.includes(page.id));
  if(!pages.length){
    const fresh={id:createPageId(),name:TX("Основная страница"),data:[],updatedAt:new Date().toISOString()};
    pages=[fresh];activePageId=fresh.id;data=fresh.data;
  }else if(!pages.some(page=>page.id===activePageId)){
    const next=pages[0];activePageId=next.id;data=next.data;
  }
  filter="all";query="";
  if($("search"))$("search").value="";
  persistPages();pageManageMode=false;selectedPageIds.clear();closePageContextMenu();render();
  showToast(ids.length===1?TX("Страница удалена"):TX("Страницы удалены"));
}

function closePageContextMenu(){
  const menu=$("pageContextMenu");
  if(menu){menu.classList.remove("show");menu.setAttribute("aria-hidden","true");}
  contextPageId=null;
}

function resetTagSelection(){
  selectionMode=false;
  selectedTagIds.clear();
  document.body.classList.remove("selection-mode-active");
}

function selectPage(id){
  const page=pages.find(item=>item.id===id);
  if(!page)return;
  resetTagSelection();
  activePageId=page.id;
  data=page.data;
  filter="all";query="";
  if($("search"))$("search").value="";
  persistPages();render();
}

function createPage(){
  const proposed=TX("Страница {0}",pages.length+1);
  const name=prompt(TX("Название новой страницы"),proposed);
  if(name===null)return;
  const clean=normalizePageName(name.replace(/\s+/g," ").trim()||proposed,proposed);
  const page={id:createPageId(),name:clean,data:[],updatedAt:new Date().toISOString()};
  pages.push(page);resetTagSelection();activePageId=page.id;data=page.data;filter="all";query="";
  if($("search"))$("search").value="";
  persistPages();render();showToast(TX("Создана новая страница"));
}

// v100: признак «есть несохранённые правки» — смена раздела больше не переписывает
// весь список в память, если ничего не менялось (на больших списках это сотни мс).
let savePending=false;
function save(){
  savePending=false;
  const page=getActivePage();
  if(page){
    page.data=data;
    page.updatedAt=new Date().toISOString();
  }
  persistPages();
  safeSetStorage(DATA_KEY, JSON.stringify(data));
  renderLastSaved();
}

function scheduleSave(){
  savePending=true;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>save(),350);
}

function flushSave(){
  clearTimeout(saveTimer);
  save();
}


function visibleData(){
  const q = query.trim().toLowerCase();
  return data.filter(x => {
    const f = filter === "all" || (filter === "task" && !!String(x.task||"").trim()) ||
              (filter === "done" && x.done) || (filter === "todo" && !x.done) ||
              String(x.unit) === filter;
    const s = !q || x.tag.toLowerCase().includes(q) || String(x.unit).toLowerCase().includes(q);
    return f && s;
  });
}

// v97: края ряда фильтров затухают маской самого ряда, только там, где есть скрытые
// вкладки. Раньше полосы-градиенты прокручивались вместе с вкладками и «резали»
// вкладку посередине (тёмная вертикальная полоса на «Невыполненные»).
function updateTabsFade(){
  const el=document.getElementById("tabs");
  if(!el)return;
  const max=el.scrollWidth-el.clientWidth;
  el.classList.toggle("fadeL",max>1&&el.scrollLeft>2);
  el.classList.toggle("fadeR",max>1&&el.scrollLeft<max-2);
}

function renderTabs(animate=true){
  // v95: все счётчики вкладок — за один проход по списку
  // (раньше — отдельный проход по всем тегам на каждую вкладку и каждую установку).
  const counts={all:data.length,task:0,todo:0,done:0};
  const units=new Set(),unitCounts=new Map();
  for(const x of data){
    if(String(x.task||"").trim())counts.task++;
    if(x.done)counts.done++;else counts.todo++;
    const raw=String(x.unit),unit=raw.trim();
    if(unit)units.add(unit);
    unitCounts.set(raw,(unitCounts.get(raw)||0)+1);
  }
  const defs = [["all",TX("Все"),counts.all]];
  if(counts.task) defs.push(["task",TX("Задания"),counts.task]);
  defs.push(["done",TX("Выполненные"),counts.done],["todo",TX("Невыполненные"),counts.todo]);
  units.forEach(u => defs.push([u,u,unitCounts.get(u)||0]));
  if(!defs.some(x=>x[0]===filter)) filter="all";
  const frag=document.createDocumentFragment();
  defs.forEach(([key,label,count])=>{
    const b=document.createElement("button");
    b.type="button";
    b.className="tab"+(filter===key?" active":"");
    b.dataset.filter=key;
    b.textContent=`${label} (${count})`;
    frag.appendChild(b);
  });
  tabs.replaceChildren(frag);
  // v102: замер ширины — в следующем кадре, а не сразу: иначе браузер пересчитывал
  // раскладку всей страницы посреди отрисовки списка.
  if(!renderTabs.fadeFrame)renderTabs.fadeFrame=requestAnimationFrame(()=>{renderTabs.fadeFrame=0;updateTabsFade();});
  // v81: анимация вкладок только при смене фильтра/данных пользователем,
  // а не при каждой отметке/сохранении (раньше полоса вкладок «мигала»).
  if(!animate)return;
  tabs.classList.remove("tab-pop");
  requestAnimationFrame(()=>tabs.classList.add("tab-pop"));
}

function captureOpenTaskEditors(){
  const state=new Map();
  list.querySelectorAll(".row").forEach(row=>{
    const ed=row.querySelector(".taskEditorWrap");
    if(!ed||!ed.classList.contains("open"))return;
    const ta=row.querySelector(".taskBox textarea");
    const focused=!!ta&&document.activeElement===ta;
    state.set(Number(row.dataset.id),{
      editing:ed.classList.contains("editing"),focused,
      scrollTop:ta?ta.scrollTop:0,
      selStart:focused?ta.selectionStart:null,selEnd:focused?ta.selectionEnd:null
    });
  });
  return state;
}

function restoreOpenTaskEditors(state){
  if(!state||!state.size)return;
  state.forEach((st,id)=>{
    const row=list.querySelector(`.row[data-id="${id}"]`);
    const item=data.find(x=>x.id===id);
    if(!row||!item)return;
    setTaskEditor(row,item,true,false,{editing:st.editing,instant:true,scrollTop:st.scrollTop});
    if(st.focused){
      const ta=row.querySelector(".taskBox textarea");
      try{ta.focus({preventScroll:true});if(st.selStart!=null)ta.setSelectionRange(st.selStart,st.selEnd);}catch(_){}
      ta.scrollTop=st.scrollTop;
    }
  });
}

function renderList(){
  const openEditors=captureOpenTaskEditors();
  const rows=visibleData();
  const frag=document.createDocumentFragment();
  if(!rows.length){
    const e=document.createElement("div");
    e.className="empty";
    // v81: пустая страница и «ничего не найдено» — разные ситуации.
    e.textContent=data.length?TX("Ничего не найдено"):TX("Список пуст — нажми «+», чтобы добавить прибор");
    frag.appendChild(e);
    list.replaceChildren(frag);
    return;
  }
  // v102: карточка тега создаётся один раз и дальше переиспользуется (вкладки, поиск,
  // выбор, отметки только переставляют и подправляют готовые карточки). Раньше весь
  // список собирался заново при каждом действии — на 250+ тегах это и тормозило.
  // v110: номер строки — порядковый номер в списке страницы (1, 2, 3…), а не внутренний id.
  // После выборочного удаления id оставляли дыры (1, 2, 3, 4, 7, 8…), а номера должны идти подряд.
  const pos=new Map();data.forEach((x,i)=>pos.set(x,i+1));
  const rowEls=rows.map(item=>{
    let row=rowCache.get(item);
    if(!row){row=buildRow(item);rowCache.set(item,row);}
    syncRow(row,item,pos.get(item));
    // Поле задания, открытое до ухода карточки из списка, как и раньше, возвращается закрытым.
    if(row.classList.contains("taskOpen")&&!openEditors.has(item.id))setTaskEditor(row,item,false,false,{instant:true});
    return row;
  });
  const current=list.children;
  let same=current.length===rowEls.length;
  for(let i=0;same&&i<rowEls.length;i++)if(current[i]!==rowEls[i])same=false;
  if(!same){rowEls.forEach(row=>frag.appendChild(row));list.replaceChildren(frag);}
  restoreOpenTaskEditors(openEditors);
}

// item → карточка. WeakMap: карточки удалённых тегов и закрытых страниц уходят сами.
let rowCache=new WeakMap();
const TASK_PLACEHOLDER="Например: проверить питание 24 В, прозвонить линию, выполнить ПНР…";

function buildRow(item){
  const row=document.createElement("div");
  row.className="row";

  const check=document.createElement("button");
  check.type="button";
  check.className="check";

  const num=document.createElement("div");num.className="num";
  const info=document.createElement("div");info.className="info";
  const tag=document.createElement("div");tag.className="tag";

  const taskLine=document.createElement("div");taskLine.className="taskLine";
  const taskToggle=document.createElement("button");
  taskToggle.type="button";
  taskToggle.className="taskToggle";
  taskToggle.textContent=TX("Задание");
  taskToggle.setAttribute("aria-expanded","false");
  const saveTask=document.createElement("button");
  saveTask.type="button";saveTask.className="taskSave";saveTask.textContent=TX("Сохранить");
  taskLine.append(taskToggle,saveTask);
  // v102: поле задания (textarea) создаётся при первом открытии — ensureTaskEditor().
  info.append(tag,taskLine);
  const actions=document.createElement("div");
  actions.className="rowActions";

  const cancelBtn=document.createElement("button");
  cancelBtn.type="button";cancelBtn.className="rowAction rowCancel";cancelBtn.textContent="×";
  cancelBtn.title=TX("Отменить выбор");cancelBtn.setAttribute("aria-label",TX("Отменить выбор тегов"));

  const selectBtn=document.createElement("button");
  selectBtn.type="button";selectBtn.className="rowAction rowSelect";

  const copyBtn=document.createElement("button");
  copyBtn.type="button";copyBtn.className="rowAction rowCopy";copyBtn.textContent="⧉";
  copyBtn.title=TX("Скопировать тег");

  const editBtn=document.createElement("button");
  editBtn.type="button";editBtn.className="rowAction rowEdit";editBtn.textContent="✎";
  editBtn.title=TX("Изменить тег");

  actions.append(cancelBtn,selectBtn,copyBtn,editBtn);
  row.append(check,num,info,actions);
  row._ui={check,num,tag,taskToggle,selectBtn,copyBtn,editBtn,state:""};
  return row;
}

// Подправляет готовую карточку под текущие данные; ничего не трогает, если состояние то же.
function syncRow(row,item,no=itemNo(item)){
  const ui=row._ui,selected=selectedTagIds.has(item.id);
  // Текст задания мог измениться в другом месте (правка тега, «В задание» из конвертора).
  if(ui.ta&&document.activeElement!==ui.ta&&ui.ta.value!==(item.task||""))ui.ta.value=item.task||"";
  const state=`${item.id}\u0001${no}\u0001${item.tag}\u0001${item.done?1:0}\u0001${item.task?1:0}\u0001${selectionMode?1:0}\u0001${selected?1:0}`;
  if(ui.state===state)return;
  ui.state=state;
  row.dataset.id=item.id;
  row.classList.toggle("done",!!item.done);
  row.classList.toggle("selection-mode",selectionMode);
  ui.check.classList.toggle("on",!!item.done);
  ui.check.setAttribute("aria-label",item.done?TX("Отметить как невыполненное"):TX("Отметить как выполненное"));
  if(ui.num.textContent!==String(no))ui.num.textContent=no;
  if(ui.tag.textContent!==item.tag)ui.tag.textContent=item.tag;
  ui.taskToggle.classList.toggle("hasTask",!!item.task);
  ui.selectBtn.classList.toggle("selected",selected);
  ui.selectBtn.title=selected?TX("Снять выбор"):TX("Выбрать тег");
  ui.selectBtn.setAttribute("aria-label",selected?TX("Снять выбор {0}",item.tag):TX("Выбрать {0}",item.tag));
  ui.copyBtn.setAttribute("aria-label",TX("Скопировать {0}",item.tag));
  ui.editBtn.setAttribute("aria-label",TX("Изменить {0}",item.tag));
}

function ensureTaskEditor(row,item){
  let editor=row.querySelector(".taskEditorWrap");
  if(editor)return editor;
  editor=document.createElement("div");editor.className="taskEditorWrap";
  const box=document.createElement("div");box.className="taskBox";
  const ta=document.createElement("textarea");
  ta.placeholder=TX(TASK_PLACEHOLDER);
  ta.value=item?.task||"";
  box.appendChild(ta);editor.appendChild(box);
  row.querySelector(".info").appendChild(editor);
  if(row._ui)row._ui.ta=ta;
  // Закрытое состояние должно попасть в стили до открытия — иначе нет плавного раскрытия.
  // Читаем стиль, а не размер: пересчёт стилей без раскладки всей страницы.
  void getComputedStyle(editor).gridTemplateRows;
  return editor;
}

function renderSummary(){
  const total=data.length;
  const done=data.filter(x=>x.done).length;
  const remaining=Math.max(0,total-done);
  const percent=total ? Math.round((done/total)*100) : 0;
  const scope=filter==="all" ? TX("Весь список") : filter==="todo" ? TX("Только невыполненные") : filter==="done" ? TX("Только выполненные") : filter==="task" ? TX("Только с заданиями") : `Unit ${filter}`;
  $("summaryCount").textContent=TX("{0} из {1} выполнено",done,total);
  $("summaryPercent").textContent=`${percent}%`;
  $("summaryRemaining").textContent=TX("Осталось: {0}",remaining);
  $("summaryFilter").textContent=query.trim() ? TX("{0} · поиск",scope) : scope;
  $("progressFill").style.width=`${percent}%`;
  $("progressTrack").setAttribute("aria-valuenow",String(percent));
}

function render(){
  tagIndexVersion=(tagIndexVersion|0)+1;
  renderPages();renderLastSaved();renderTabs();renderSummary();updateSelectionFooter();renderList();
}

function rowItemFromTarget(target){
  const row=target.closest(".row");
  if(!row)return null;
  const id=Number(row.dataset.id);
  const item=data.find(x=>x.id===id);
  return item?{row,item}:null;
}

function updateRenderedRowState(row,item){
  row.classList.toggle("done",!!item.done);
  const check=row.querySelector(".check");
  if(check){
    check.classList.toggle("on",!!item.done);
    check.setAttribute("aria-label",item.done?TX("Отметить как невыполненное"):TX("Отметить как выполненное"));
  }
}

// v81: высота поля задания считается через скрытый «зеркальный» textarea.
// Раньше поле на мгновение сжималось (height:auto), из-за чего браузер
// подпрыгивал прокруткой страницы, а scrollTop поля сбрасывался в 0.
let taskMeasureEl=null;
function measureTaskTextarea(ta){
  if(!taskMeasureEl){
    taskMeasureEl=document.createElement("textarea");
    taskMeasureEl.setAttribute("aria-hidden","true");
    taskMeasureEl.tabIndex=-1;
    taskMeasureEl.className="taskMeasure";
    document.body.appendChild(taskMeasureEl);
  }
  const cs=getComputedStyle(ta);
  const m=taskMeasureEl.style;
  m.width=ta.getBoundingClientRect().width+"px";
  ["fontFamily","fontSize","fontWeight","lineHeight","letterSpacing","paddingTop","paddingBottom","paddingLeft","paddingRight","borderTopWidth","borderBottomWidth","borderLeftWidth","borderRightWidth","boxSizing","whiteSpace","wordBreak","overflowWrap","tabSize"].forEach(k=>{m[k]=cs[k];});
  taskMeasureEl.value=ta.value||ta.placeholder||"";
  const borders=(parseFloat(cs.borderTopWidth)||0)+(parseFloat(cs.borderBottomWidth)||0);
  return taskMeasureEl.scrollHeight+borders;
}

// v97: поле задания — не выше трёх карточек тегов, одинаково при чтении и записи.
// Дальше текст прокручивается внутри поля; второе «увеличение» поля убрано.
const TASK_FIELD_ROWS=3;
function taskEditorCap(){
  let rowH=54;
  const sample=list.querySelector(".row:not(.taskOpen)");
  if(sample){const h=sample.getBoundingClientRect().height;if(h>30&&h<120)rowH=h;}
  const gap=parseFloat(getComputedStyle(list).rowGap)||6;
  return Math.round(TASK_FIELD_ROWS*rowH+(TASK_FIELD_ROWS-1)*gap);
}

function autosizeTaskTextarea(ta,maxPx){
  if(!ta||!ta.isConnected||!ta.getBoundingClientRect().width)return;
  const cs=getComputedStyle(ta);
  const line=parseFloat(cs.lineHeight)||20;
  // Одинаковый минимум для чтения и записи: при касании текста поле не «прыгает».
  const min=ta.closest(".taskEditorWrap")?Math.max(58,line*2+20):Math.max(50,line+18);
  // Предел фиксируется, пока поле открыто, и не меняется при появлении клавиатуры.
  let cap=maxPx;
  if(!cap){
    if(ta.closest(".taskEditorWrap.open")){cap=Number(ta.dataset.cap)||taskEditorCap();ta.dataset.cap=String(cap);}
    else{delete ta.dataset.cap;cap=taskEditorCap();}
  }
  const max=Math.max(min,cap);
  const desired=Math.round(Math.min(max,Math.max(min,measureTaskTextarea(ta))));
  const previousScrollTop=ta.scrollTop;
  if(ta.style.height!==desired+"px")ta.style.height=desired+"px";
  // Изменение высоты не должно возвращать текст к началу, пока пользователь читает/пишет.
  ta.scrollTop=previousScrollTop;
}

function setTaskEditor(row,item,open,focus=false,opts={}){
  if(open)ensureTaskEditor(row,item);
  const editor=row.querySelector(".taskEditorWrap"),toggle=row.querySelector(".taskToggle"),saveBtn=row.querySelector(".taskSave"),ta=row.querySelector(".taskBox textarea");
  if(!toggle||!saveBtn)return;
  if(!editor){
    // Поле ещё не создавалось — закрывать нечего, только кнопки.
    row.classList.remove("taskOpen");toggle.classList.remove("open");saveBtn.classList.remove("show");
    toggle.setAttribute("aria-expanded","false");
    return;
  }
  const editing=!!(focus||opts.editing);
  if(opts.instant){editor.classList.add("instant");requestAnimationFrame(()=>requestAnimationFrame(()=>editor.classList.remove("instant")));}
  editor.classList.toggle("open",open);
  editor.classList.toggle("editing",open&&editing);
  editor.classList.toggle("focused",open&&editing);
  row.classList.toggle("taskOpen",open);
  toggle.classList.toggle("open",open);
  saveBtn.classList.toggle("show",open&&editing);
  toggle.setAttribute("aria-expanded",String(open));
  if(open&&ta){
    const keepScroll=opts.scrollTop!=null?opts.scrollTop:ta.scrollTop;
    autosizeTaskTextarea(ta);
    ta.scrollTop=keepScroll;
    if(focus){
      // Фокус синхронно, внутри обработчика касания: иначе iOS не открывает клавиатуру.
      try{ta.focus({preventScroll:true});}catch(_){ta.focus();}
      ta.scrollTop=keepScroll;
      scheduleTaskEditorReveal(ta);
    }
  }else if(ta){
    if(document.activeElement===ta)ta.blur();
    ta.style.height="";ta.scrollTop=0;delete ta.dataset.cap;
  }
}

// Пересчёт открытых полей задания (поворот экрана, A−/A+): предел «3 тега» зависит от высоты карточки.
function refreshOpenTaskFields(){
  list.querySelectorAll(".taskEditorWrap.open .taskBox textarea").forEach(ta=>{delete ta.dataset.cap;autosizeTaskTextarea(ta);});
}

// v97: «Задание» — первое касание открывает поле для чтения (без клавиатуры),
// второе закрывает. Клавиатура — только при касании текста; «Сохранить» видна
// только во время записи, сохраняет и прячет клавиатуру, поле остаётся открытым.
function closeTaskEditor(row,item){
  const ta=row.querySelector(".taskBox textarea");
  if(ta&&item&&ta.closest(".taskEditorWrap.editing"))item.task=ta.value;
  flushSave();
  setTaskEditor(row,item,false);
  renderTabs(false);
}
function commitTaskEditor(row,item){
  const ta=row.querySelector(".taskBox textarea");
  if(ta)item.task=String(ta.value||"").trim();
  if(ta&&ta.value!==item.task)ta.value=item.task;
  flushSave();
  row.querySelector(".taskToggle")?.classList.toggle("hasTask",!!item.task.trim());
  const keep=ta?ta.scrollTop:0;
  if(ta&&document.activeElement===ta)ta.blur();
  setTaskEditor(row,item,true,false,{editing:false,scrollTop:keep});
  renderTabs(false);
  showToast(TX("Задание сохранено"));
}

// После появления клавиатуры аккуратно показываем поле целиком (один раз),
// не трогая прокрутку, если поле уже видно.
let taskRevealTimer=0;
function revealTaskEditor(ta){
  if(!ta||!ta.isConnected||document.activeElement!==ta)return;
  const vv=window.visualViewport;
  const top=vv?vv.offsetTop:0,height=vv?vv.height:window.innerHeight;
  const r=ta.getBoundingClientRect();
  const margin=12;
  let dy=0;
  if(r.bottom>top+height-margin) dy=r.bottom-(top+height-margin);
  if(r.top-dy<top+margin) dy=r.top-(top+margin);
  if(Math.abs(dy)>2) window.scrollBy(0,dy);
}
function scheduleTaskEditorReveal(ta){
  clearTimeout(taskRevealTimer);
  taskRevealTimer=setTimeout(()=>revealTaskEditor(ta),380);
}

function setSelectionMode(enabled,initialId=null){
  selectionMode=!!enabled;
  if(!selectionMode) selectedTagIds.clear();
  else if(initialId!==null) selectedTagIds.add(initialId);
  document.body.classList.toggle("selection-mode-active",selectionMode);
  updateSelectionFooter();
  renderList();
}

function toggleTagSelection(id){
  if(selectedTagIds.has(id)) selectedTagIds.delete(id);
  else selectedTagIds.add(id);
  if(!selectedTagIds.size){
    selectionMode=false;
    document.body.classList.remove("selection-mode-active");
  }
  updateSelectionFooter();
  renderList();
}

function getSelectionScope(){
  return visibleData();
}

function updateSelectionFooter(){
  const btn=$("deleteAll"), count=selectedTagIds.size;
  const markBtn=$("markAllDone");
  const clearBtn=$("clearChecks");
  if(selectionMode){
    // v95: выборка считается только в режиме выбора (раньше — при каждой отрисовке).
    const scope=getSelectionScope();
    const scopedSelected=scope.filter(item=>selectedTagIds.has(item.id));
    const allSelected=scope.length>0 && scopedSelected.length===scope.length;
    const allDone=scopedSelected.length>0 && scopedSelected.every(item=>item.done);
    btn.disabled=!count;
    btn.title=count?TX("Удалить выбранные теги: {0}",count):TX("Выбери теги для удаления");
    markBtn.disabled=!scope.length;
    markBtn.title=allSelected?TX("Снять выбор со всех тегов текущей вкладки"):TX("Выбрать все теги текущей вкладки");
    markBtn.dataset.mode=allSelected?"clear":"select";
    clearBtn.disabled=!scopedSelected.length;
    clearBtn.title=allDone?TX("Снять статус «Выполнено» у выбранных"):TX("Отметить выбранные как выполненные");
    clearBtn.dataset.mode=allDone?"unset-done":"set-done";
    btn.dataset.count=String(count);
  }else{
    btn.disabled=false;
    markBtn.disabled=true;
    clearBtn.disabled=true;
  }
}

async function copyTags(ids){
  const wanted=new Set(ids);
  const items=data.filter(item=>wanted.has(item.id));
  if(!items.length)return;
  const lines=items.map(item=>{
    const tag=String(item.tag||"").trim();
    const task=String(item.task||"").trim().replace(/\\s*[\\r\\n]+\\s*/g," ");
    return task ? `${tag} — ${task}` : tag;
  });
  const text=lines.join("\n");
  try{
    if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else{
      const ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();
    }
    showToast(items.length===1?(items[0].task?TX("Скопирован тег с заданием: {0}",items[0].tag):TX("Скопирован тег: {0}",items[0].tag)):TX("Скопировано тегов с заданиями: {0}",items.length));
  }catch(_){showToast(TX("Не удалось скопировать тег"));}
}

function enterTagSelection(id){
  setSelectionMode(true,id);
  if(navigator.vibrate)navigator.vibrate(25);
}

// v98: строка перерисовывается в момент включения режима выбора, и click, который браузер
// присылает после отпускания пальца, попадал в новую строку и тут же снимал выбор.
// Этот один click гасится; любое новое касание снимает защиту.
let suppressRowClickUntil=0;
function endLongPressGesture(){
  if(longPressTriggered){longPressTriggered=false;suppressRowClickUntil=Date.now()+1000;}
}
document.addEventListener("pointerup",endLongPressGesture,true);
document.addEventListener("pointercancel",endLongPressGesture,true);
document.addEventListener("pointerdown",()=>{suppressRowClickUntil=0;},true);

function startLongPress(id){
  cancelLongPress();
  longPressTriggered=false;
  longPressTimer=setTimeout(()=>{
    longPressTriggered=true;
    enterTagSelection(id);
  },650);
}

function cancelLongPress(){
  if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;}
}

function openEdit(id){
  editId=id;
  const item=data.find(x=>x.id===id);
  if(!item)return;
  $("modalTitleText").textContent=TX("Редактировать прибор");
  setAddMode("manual");
  $("addChoice").style.display="none";
  tagInput.value=item.tag;checkTagLine();
  manualTaskInput.value=item.task||"";
  statusInput.value=item.done?"done":"todo";
  deleteBtn.style.display="block";
  overlay.classList.add("show");
  setTimeout(()=>tagInput.focus(),50);
}

function closeModal(){
  const active=document.activeElement;
  if(active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) active.blur();
  overlay.classList.remove("show");
  editId=null;
}

// v105: номер установки — по формату тега (ISA-5.1: цифры перед буквами, KKS: блок и система).
function unitFromTag(tag){
  if(window.TagFormat)return TagFormat.unitOf(tag);
  const m=String(tag||"").trim().match(/^(\d{1,5})-/);
  return m ? m[1] : "";
}

function tagKey(v){
  return String(v||"").toUpperCase().replace(/[–—−_]/g,"-").replace(/\s+/g,"").trim();
}

// v110: видимый номер строки — позиция в списке страницы.
function itemNo(item){const i=data.indexOf(item);return i<0?"":i+1;}

function findDuplicateTag(tag,ignoreId=null){
  const key=tagKey(tag);
  return data.find(item=>tagKey(item.tag)===key && item.id!==ignoreId)||null;
}

function openDuplicateDialog(duplicate,pending){
  pendingDuplicate={duplicateId:duplicate.id,pending};
  const sug=dupSuffixSuggest(pending.tag,new Set(data.map(x=>tagKey(x.tag))));
  pendingDuplicate.suggest=sug;
  $("duplicateMessage").innerHTML=TX("Тег <strong>{0}</strong> уже есть на этой странице (позиция №{1}, {2}).",escapeHtml(pending.tag),itemNo(duplicate),escapeHtml(duplicate.tag))
    +"<br><br>"+TX("Если это другой прибор с тем же номером (резерв, пара A/B), добавьте букву вплотную к номеру — это уже не дубликат: <b>{0}</b>.",escapeHtml(sug||pending.tag+"A"))
    +"<br>"+TX("Если запись та же — удалите прежнюю или измените новый тег.");
  const asBtn=$("duplicateSuffixBtn");
  if(asBtn){asBtn.hidden=!sug;asBtn.textContent=TX("Добавить как {0}",sug);}
  $("duplicateOverlay").classList.add("show");
}

function closeDuplicateDialog(){pendingDuplicate=null;$("duplicateOverlay").classList.remove("show");}

// v105: тег проверяется по выбранному формату (кнопка ISA-5.1 у тумблера OCR).
// При правке готового тега подходит и любой известный формат, а неизменённый тег сохраняется как есть.
function manualTagCheck(value){
  const raw=String(value||"").trim();
  if(!raw)return null;
  if(editId!==null){
    const prev=data.find(x=>x.id===editId);
    if(prev&&tagKey(prev.tag)===tagKey(raw))return {ok:true,tag:prev.tag,unit:String(prev.unit||"").trim()||unitFromTag(prev.tag),fixes:[],same:true};
    return TagFormat.anyValid(raw);
  }
  return TagFormat.check(raw);
}

function saveModal(){
  const raw=tagInput.value.trim();
  if(!raw){showToast(TX("Введите тег"));tagInput.focus();return;}
  const r=manualTagCheck(raw);
  if(!r||!r.ok){showToast(TX("Тег не подходит под формат «{0}»: {1}. Формат меняется кнопкой {2} рядом с OCR.",TagFormat.name(),TX(r?r.reason:"не похоже на тег"),TagFormat.button()[0]));tagInput.focus();return;}
  const tag=r.tag,unit=r.unit||"";
  const done=statusInput.value==="done";
  const task=manualTaskInput.value.trim();
  const duplicate=findDuplicateTag(tag,editId);
  if(duplicate){openDuplicateDialog(duplicate,{unit,tag,done,task,editId});return;}
  if(editId!==null){
    const item=data.find(x=>x.id===editId);
    if(item){item.unit=unit;item.tag=tag;item.done=done;item.task=task;}
  }else{
    const max=data.reduce((m,x)=>Math.max(m,Number(x.id)||0),0);
    data.push({id:max+1,unit,tag,done,task});
  }
  // v98: closeModal() обнуляет editId — раньше после правки показывалось «Прибор добавлен».
  const wasEdit=editId!==null;
  save();closeModal();render();showToast(wasEdit?TX("Сохранено"):TX("Прибор добавлен"));
}

async function deleteCurrent(){
  if(editId===null)return;
  const item=data.find(x=>x.id===editId);
  if(!item)return;
  if(!await askConfirm(TX("Удалить {0}?",item.tag),TX("Удаление прибора"),TX("Удалить")))return;
  data=data.filter(x=>x.id!==editId);
  save();closeModal();render();showToast(TX("Прибор удалён"));
}

function showToast(text){
  // v107: готовые сообщения (в том числе из APK) переводятся по словарю.
  text=TX.msg(text);
  const t=$("toast");if(!t)return;t.textContent=text;t.classList.add("show");
  // v81: длинные сообщения показываются дольше, чтобы их успевали прочитать.
  const ms=Math.min(5200,Math.max(1600,String(text||"").length*55));
  clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove("show"),ms);
}

function safeFileBase(name){
  return name.trim()
    .replace(/[\\/:*?"<>|]/g,"-")
    .replace(/\s+/g," ")
    .replace(/\.+$/,"") || TX("КИП-чек-лист");
}

function renderExportPageButtons(){
  const wrap=$("exportPageButtons");
  if(!wrap)return;
  wrap.innerHTML="";
  pages.forEach((page,index)=>{
    const button=document.createElement("button");
    button.type="button";
    button.className="choice";
    button.innerHTML=`<span class="ico">${index===0?"⌂":"≡"}</span>${escapeHtml(page.name||TX("Страница {0}",index+1))}`;
    button.addEventListener("click",()=>sharePageReport(page.id));
    wrap.appendChild(button);
  });
}

function openExportMenu(){
  $("exportTitle").textContent=TX("Сохранить / отправить");
  renderExportPageButtons();
  $("exportOverlay").classList.add("show");
}

function closeExportMenu(){ $("exportOverlay").classList.remove("show"); }

function reportDateTime(){
  return new Date().toLocaleString(LOC(),{
    day:"2-digit",month:"2-digit",year:"numeric",
    hour:"2-digit",minute:"2-digit"
  });
}

function cleanReportField(value){
  return String(value??"")
    .replace(/[\r\n\t]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function pageTitleForReport(page){
  const name=cleanReportField(page?.name);
  return name||TX("Без названия");
}

function reportPageHeader(page){
  return `${pageTitleForReport(page)}\n${reportDateTime()}`;
}

function formatReportItems(items,includeTasks=false){
  return items.map((item,index)=>{
    const tag=cleanReportField(item.tag)||TX("Без тега");
    const task=cleanReportField(item.task);
    return `${index+1}. ${tag}${includeTasks&&task?` — ${task}`:""}`;
  }).join("\n");
}

function buildGroupedTextReport(kind="all"){
  const page=getActivePage();
  if(!page)return "";
  const done=page.data.filter(item=>item.done);
  const todo=page.data.filter(item=>!item.done);
  const tasks=page.data.filter(item=>!!cleanReportField(item.task));
  const sections=[];
  const addSection=(title,items,includeTasks=false)=>{
    if(!items.length)return;
    sections.push(`${title}
${formatReportItems(items,includeTasks)}`);
  };
  if(kind==="done") addSection(TX("Выполненные"),done);
  else if(kind==="todo") addSection(TX("Невыполненные"),todo);
  else if(kind==="task") addSection(TX("Задания"),tasks,true);
  else { addSection(TX("Выполненные"),done); addSection(TX("Невыполненные"),todo); }
  const body=sections.length?sections.join("\n\n"):TX("Нет данных");
  return `${reportPageHeader(page)}\n\n${body}`;
}

function buildPageTextReport(page,kind="all"){
  if(!page)return "";
  const done=page.data.filter(item=>item.done);
  const todo=page.data.filter(item=>!item.done);
  const tasks=page.data.filter(item=>!!cleanReportField(item.task));
  const sections=[];
  const addSection=(title,items,includeTasks=false)=>{
    if(items.length) sections.push(`  ${title}
${formatReportItems(items,includeTasks).replace(/^/gm,"    ")}`);
  };
  if(kind==="done") addSection(TX("Выполненные"),done);
  else if(kind==="todo") addSection(TX("Невыполненные"),todo);
  else if(kind==="task") addSection(TX("Задания"),tasks,true);
  else { addSection(TX("Выполненные"),done); addSection(TX("Невыполненные"),todo); }
  const body=sections.length?sections.join("\n\n") : "  "+TX("Нет данных");
  return `**${pageTitleForReport(page)}**\n\n${body}`;
}

function buildFullStateTextReport(){
  const chunks=[`**${cleanReportField(docTitle)||"Tag list"}**`];
  pages.forEach(page=>{
    const done=page.data.filter(item=>item.done);
    const todo=page.data.filter(item=>!item.done);
    const tasks=page.data.filter(item=>!!cleanReportField(item.task));
    const section=(title,items,includeTasks=false)=>items.length?`  ${title}\n${formatReportItems(items,includeTasks).replace(/^/gm,"    ")}`:`  ${title}\n    —`;
    chunks.push(`\n\n**${pageTitleForReport(page)}**\n\n${section(TX("Выполненные"),done)}\n\n${section(TX("Невыполненные"),todo)}\n\n${section(TX("Задания"),tasks,true)}`);
  });
  return chunks.join("");
}

function buildTitlesReport(){
  return pages.map((page,index)=>`  ${index+1}. ${pageTitleForReport(page)}`).join("\n");
}

async function shareTextPayload(title,text){
  closeExportMenu();
  try{
    if(navigator.share){await navigator.share({title,text});showToast(TX("Текст передан"));return;}
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);showToast(TX("Текст скопирован"));return;}
    throw new Error("share-unavailable");
  }catch(e){if(e.name!=="AbortError")showToast(TX("Не удалось передать текст"));}
}

async function shareTextReport(kind){
  const labels={all:"Весь список",done:"Выполненные",todo:"Невыполненные",task:"Задания",pages:"Титулы"};
  const text=kind==="pages"?buildTitlesReport():buildPageTextReport(getActivePage(),kind);
  await shareTextPayload(`${docTitle} — ${TX(labels[kind])}`,text);
}

async function shareFullStateText(){
  await shareTextPayload(TX("{0} — всё состояние",docTitle),buildFullStateTextReport());
}

function buildStateObject(){
  flushSave();
  return {
    schemaVersion:1,v:1,
    document:{title:docTitle,updatedAt:new Date().toISOString()},
    title:docTitle,
    pages:pages.map(page=>({id:String(page.id),name:String(page.name||"").trim(),data:cloneItems(page.data),updatedAt:page.updatedAt||new Date().toISOString()})),
    activePageId:String(activePageId||""),
    filter,query,theme:safeGetStorage(THEME_KEY,"light")
  };
}
function stateJsonText(){return JSON.stringify(buildStateObject(),null,2);}
function jsonFileName(){
  const stamp=new Date().toISOString().replace(/[:.]/g,"-").replace(/Z$/,"");
  return `${safeFileBase(docTitle||"Tag-list")} — ${stamp}.json`;
}
function downloadJsonFile(text,fileName){
  const bridge=window.AndroidApp;
  if(bridge && typeof bridge.saveFile==="function"){bridge.saveFile(fileName,"application/json",text);return;}
  const blob=new Blob([text],{type:"application/json;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=fileName;a.rel="noopener";document.body.appendChild(a);a.click();a.remove();
  // v95: Chrome на Android может начать загрузку уже после закрытия окна выбора папки;
  // слишком ранний revoke давал пустой файл. Ссылку держим минуту.
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
// v95: системный выбор папки (File System Access) в Chrome на Android пишет через
// content:// без атомарной записи — на части хранилищ файл остаётся пустым.
// На Android сохраняем обычной загрузкой (папка «Загрузки» / выбор папки браузером).
function isAndroidBrowser(){return /Android/i.test(navigator.userAgent||"") && !window.AndroidApp;}
// Встроенные браузеры мессенджеров (Android WebView) не умеют скачивать blob-файлы.
function isEmbeddedAndroidWebView(){return isAndroidBrowser() && /;\s*wv\)/.test(navigator.userAgent||"");}
async function writeJsonWithPicker(text,fileName){
  const handle=await window.showSaveFilePicker({
    suggestedName:fileName,
    types:[{description:"Tag list JSON",accept:{"application/json":[".json"]}}]
  });
  const writable=await handle.createWritable({keepExistingData:false});
  await writable.write(new Blob([text],{type:"application/json;charset=utf-8"}));
  await writable.close();
  // Проверяем, что файл действительно получил данные.
  try{
    const saved=await handle.getFile();
    if(text.length && saved.size===0)throw new Error("empty-write");
  }catch(e){if(e?.message==="empty-write")throw e;}
}
async function saveCurrentStateJson(){
  let text="",fileName="";
  try{
    text=stateJsonText();fileName=jsonFileName();
    if(window.AndroidApp && typeof window.AndroidApp.saveFile==="function"){
      window.AndroidApp.saveFile(fileName,"application/json",text);closeExportMenu();return;
    }
    if(isEmbeddedAndroidWebView()){
      // Скачать файл отсюда нельзя — отдаём JSON через «Поделиться» или буфер обмена.
      closeExportMenu();
      const file=stateShareFile(text,fileName);
      if(file && typeof navigator.share==="function"){
        try{await navigator.share({title:TX("{0} — состояние",docTitle),files:[file]});showToast(TX("JSON передан"));return;}
        catch(err){if(err?.name==="AbortError")return;}
      }
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);showToast(TX("Встроенный браузер не сохраняет файлы — JSON скопирован. Открой приложение в Chrome."));return;}
      throw new Error("save-unavailable");
    }
    if(window.showSaveFilePicker && !isAndroidBrowser()){
      try{
        await writeJsonWithPicker(text,fileName);
        showToast(TX("JSON сохранён"));closeExportMenu();return;
      }catch(pickerError){
        if(pickerError?.name==="AbortError")return;
        // Запись через выбор файла не удалась — сохраняем обычной загрузкой.
      }
    }
    downloadJsonFile(text,fileName);
    showToast(isAndroidBrowser()?TX("JSON сохранён в «Загрузки»"):TX("JSON сохранён в файлы/загрузки"));
    closeExportMenu();
  }catch(e){
    if(e?.name!=="AbortError")showToast(TX("Не удалось сохранить JSON"));
  }
}
function openJsonStatePicker(){
  closeExportMenu();
  const input=$("stateJsonInput");
  if(input) input.click();
}
async function backupAndOpenJsonState(){
  const input=$("stateJsonInput");
  if(!input?.files?.length)return;
  const file=input.files[0];
  input.value="";
  try{ await importJsonStateFile(file); }
  catch(e){ showToast(TX.msg(e?.message)||TX("Не удалось открыть JSON")); }
}
// v81: отправка состояния .json сразу в мессенджер.
// Chrome/Samsung Internet/Edge на Android принимают в «Поделиться» только файлы из
// короткого списка типов (.txt, .csv, .pdf, изображения…); .json туда не входит,
// поэтому share() падал и срабатывал запасной путь (скачивание). На Chromium файл
// отправляется как «… .json.txt» (text/plain) — внутри тот же JSON, и он открывается
// кнопкой «Открыть» как обычно. В Safari (iPhone) уходит настоящий .json.
// В APK-версии используется системное окно Android с настоящим .json.
function isChromiumEngine(){
  // На iPhone/iPad любой браузер работает на WebKit — там .json отправляется как есть.
  if(/\b(iPhone|iPad|iPod)\b/.test(navigator.userAgent||""))return false;
  try{
    const brands=navigator.userAgentData?.brands||[];
    if(brands.some(b=>/Chromium|Google Chrome|Microsoft Edge|Opera|Samsung/i.test(b.brand)))return true;
  }catch(_){}
  const ua=navigator.userAgent||"";
  return /\b(Chrome|Chromium|CrMo|SamsungBrowser)\/\d+/.test(ua) && !/\b(CriOS|FxiOS|EdgiOS|OPiOS)\//.test(ua);
}
function nativeBridge(){
  const b=window.AndroidApp;
  return b && typeof b.shareFile==="function" ? b : null;
}
function stateShareFile(text,fileName){
  if(typeof File!=="function")return null;
  if(isChromiumEngine()) return new File([text],`${fileName}.txt`,{type:"text/plain"});
  return new File([text],fileName,{type:"application/json"});
}
async function shareCurrentStateJson(){
  const text=stateJsonText(),fileName=jsonFileName();
  closeExportMenu();
  const bridge=nativeBridge();
  if(bridge){
    try{
      if(bridge.shareFile(fileName,"application/json",text,TX("{0} — состояние",docTitle))){showToast(TX("Выбери мессенджер для отправки JSON"));return;}
    }catch(_){}
  }
  try{
    const file=stateShareFile(text,fileName);
    if(file && typeof navigator.share==="function"){
      // Не проверяем canShare(): он не учитывает тип файлов и на части WebView отсутствует.
      try{
        await navigator.share({title:TX("{0} — состояние",docTitle),text:TX("Состояние приложения «{0}»",docTitle),files:[file]});
        showToast(TX("JSON передан"));return;
      }catch(shareError){
        if(shareError?.name==="AbortError") return;
        // Реальная ошибка — запасной путь ниже.
      }
    }
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text);
      showToast(TX("JSON скопирован в буфер обмена"));return;
    }
    downloadJsonFile(text,fileName);showToast(TX("JSON подготовлен для сохранения"));
  }catch(e){
    if(e?.name==="AbortError")return;
    try{downloadJsonFile(text,fileName);showToast(TX("Не удалось отправить напрямую — JSON подготовлен для сохранения"));}
    catch(_){showToast(TX("Не удалось отправить или сохранить JSON"));}
  }
}
function validateImportedState(parsed){
  if(!parsed||typeof parsed!=="object")throw new Error(TX("JSON не является объектом состояния Tag list."));
  const version=Number(parsed.schemaVersion||parsed.v||0);
  if(version!==1)throw new Error(TX("Неподдерживаемая версия JSON: {0}.",version||TX("не указана")));
  if(!Array.isArray(parsed.pages)||!parsed.pages.length)throw new Error(TX("В JSON нет страниц."));
  const normalized=normalizeUniquePageNames(parsed.pages.map((page,index)=>{
    if(!page||typeof page!=="object")throw new Error(TX("Некорректная страница №{0}.",index+1));
    return {id:String(page.id||createPageId()),name:String(page.name||TX("Страница {0}",index+1)).trim()||TX("Страница {0}",index+1),data:cloneItems(page.data),updatedAt:page.updatedAt||new Date().toISOString()};
  }));
  const requestedActive=String(parsed.activePageId||"");
  const active=normalized.some(p=>p.id===requestedActive)?requestedActive:normalized[0].id;
  return {
    pages:normalized,activePageId:active,
    title:String(parsed.title||parsed.document?.title||"Tag list").trim()||"Tag list",
    filter:["all","task","done","todo"].includes(parsed.filter)||(typeof parsed.filter==="string"&&/^\d{1,8}$/.test(parsed.filter))?parsed.filter:"all",
    query:typeof parsed.query==="string"?parsed.query:"",
    theme:String(parsed.theme||"light")
  };
}
function createStateBackupFile(){
  // Keep a recoverable local snapshot. Avoid triggering a second download while
  // a mobile browser is already handling the user's selected JSON file.
  safeSetStorage("kip-checklist-last-state-backup-v1",stateJsonText());
}
function applyImportedState(parsed,createBackup=true){
  const next=validateImportedState(parsed);
  if(createBackup) createStateBackupFile();
  clearTimeout(saveTimer);savePending=false;
  pages=next.pages;activePageId=next.activePageId;data=(pages.find(p=>p.id===activePageId)||pages[0]).data;
  docTitle=next.title;filter=next.filter;query=next.query;
  if($("search"))$("search").value=query;
  safeSetStorage(DOC_TITLE_KEY,docTitle);safeSetStorage(PAGES_KEY,JSON.stringify(pages));safeSetStorage(ACTIVE_PAGE_KEY,activePageId);safeSetStorage(DATA_KEY,JSON.stringify(data));safeSetStorage(THEME_KEY,next.theme);
  applyTheme(next.theme);applyDocumentTitle();resetTagSelection();render();return next;
}
async function readTextFileCompat(file){
  if(typeof file.text==="function")return file.text();
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(new Error(TX("Не удалось прочитать выбранный файл.")));
    reader.readAsText(file,"UTF-8");
  });
}
async function importJsonStateFile(file){
  if(!file)throw new Error(TX("JSON-файл не выбран."));
  if(file.size>10*1024*1024)throw new Error(TX("JSON больше 10 МБ."));
  const text=await readTextFileCompat(file);let parsed;
  try{parsed=JSON.parse(text.replace(/^\uFEFF/,""));}catch(_){throw new Error(TX("Файл содержит некорректный JSON."));}
  // Validation happens before backup or mutation. Successful import stores a
  // local recovery snapshot, then replaces the live state and redraws the UI.
  applyImportedState(parsed,true);
  closeModal();closeExportMenu();
  showToast(TX("Открыто состояние из {0}. Предыдущее состояние сохранено локально.",file.name||"JSON"));
  return true;
}
async function sharePageReport(pageId){
  const page=pages.find(p=>p.id===pageId);
  if(!page)return;
  await shareTextPayload(`${pageTitleForReport(page)}`,buildPageTextReport(page,"all"));
}

// ---------------------------------------------------------------- v102: окно «Отчёт»
// Страницы (можно несколько) · Выполненные / Невыполненные / Всё · «С заданиями» ·
// исполнители · текст, который можно поправить перед отправкой.
// Ручные правки не пропадают при смене выбора: отчёт собирается из строк с ключами
// (тег, заголовок раздела, установка), правки хранятся как «изменено / удалено /
// добавлено после строки» и накладываются на новый отчёт; нумерация пересчитывается.
const REPORT_KEY="kip-report-v1";
const REPORT_SEEN_KEY="kip-report-seen-v1";
const REPORT_NUM=/^\s*\d+\.\s*/;
let reportState=null;
let reportOps={rep:{},del:{},ins:{}};
let reportAutoLines=[];
let reportPeopleSig="";

function reportStrings(list){return Array.isArray(list)?list.map(x=>cleanReportField(x)).filter(Boolean):[];}
function loadReportState(){
  let st={};
  try{st=JSON.parse(safeGetStorage(REPORT_KEY,"{}")||"{}")||{};}catch(_){st={};}
  const people=[...new Set(reportStrings(st.people))].slice(0,60);
  return {
    pages:reportStrings(st.pages),
    kind:["done","todo","all"].includes(st.kind)?st.kind:"done",
    withTasks:st.withTasks!==false,
    people,
    on:reportStrings(st.on).filter(n=>people.includes(n))
  };
}
function saveReportState(){if(reportState)safeSetStorage(REPORT_KEY,JSON.stringify(reportState));}
function reportValidatePages(){
  const ids=new Set(pages.map(p=>String(p.id)));
  reportState.pages=reportState.pages.filter(id=>ids.has(id));
}
function reportChosenPages(){
  const wanted=new Set(reportState.pages);
  return pages.filter(p=>wanted.has(String(p.id)));
}
const reportHasOps=()=>Object.keys(reportOps.rep).length+Object.keys(reportOps.del).length+Object.keys(reportOps.ins).length>0;

function buildReportLines(){
  const chosen=reportChosenPages(),multi=chosen.length>1,L=[];
  if(!chosen.length)return L;
  const push=(t,k,num=false)=>L.push({t,k,num});
  if(!multi)push(pageTitleForReport(chosen[0]),"p:"+chosen[0].id);
  const who=reportState.people.filter(n=>reportState.on.includes(n));
  if(who.length)push(TX("Исполнители: {0}",who.join(", ")),"who");
  chosen.forEach(page=>{
    const items=page.data||[],pid=String(page.id);
    const done=items.filter(x=>x.done),todo=items.filter(x=>!x.done);
    if(L.length)push("","b:"+pid+":0");
    if(multi)push(pageTitleForReport(page),"p:"+pid);
    const pct=items.length?Math.round(done.length/items.length*100):0;
    push(TX("Выполнено {0} из {1} ({2} %)",done.length,items.length,pct),"stat:"+pid);
    const section=(head,list,kind)=>{
      push("","b:"+pid+":"+kind);
      push(`${head} (${list.length})`,"sec:"+pid+":"+kind);
      if(!list.length){push("—","dash:"+pid+":"+kind);return;}
      const groups=new Map();
      list.forEach(x=>{const u=cleanReportField(x.unit)||unitFromTag(x.tag)||TX("Без установки");if(!groups.has(u))groups.set(u,[]);groups.get(u).push(x);});
      let n=0;
      groups.forEach((group,unit)=>{
        if(groups.size>1)push(`▸ ${unit}`,"u:"+pid+":"+kind+":"+unit);
        group.forEach(x=>{
          const tag=cleanReportField(x.tag)||TX("Без тега"),task=cleanReportField(x.task);
          push(`${++n}. ${tag}${reportState.withTasks&&task?` — ${task}`:""}`,"t:"+pid+":"+x.id+":"+tag,true);
        });
      });
    };
    if(reportState.kind!=="todo")section(TX("✅ Выполнено"),done,"done");
    if(reportState.kind!=="done")section(TX("⏳ Не выполнено"),todo,"todo");
  });
  return L;
}

function reportTagOf(key){const i=key.lastIndexOf(":");return key.startsWith("t:")&&i>0?key.slice(i+1):"";}
function diffReportOps(auto,userText){
  const a=auto.map(l=>l.t),b=userText.split("\n"),n=a.length,m=b.length;
  const out={rep:{},del:{},ins:{}};
  // Длинные отчёты: таблица сравнения строк n×m — до ~4 млн ячеек, иначе только начало/конец.
  let pre=0;while(pre<n&&pre<m&&a[pre]===b[pre])pre++;
  let suf=0;while(suf<n-pre&&suf<m-pre&&a[n-1-suf]===b[m-1-suf])suf++;
  const A=a.slice(pre,n-suf),B=b.slice(pre,m-suf),an=A.length,bm=B.length;
  let dp=null;
  if(an*bm<=4e6){
    dp=Array.from({length:an+1},()=>new Uint16Array(bm+1));
    for(let i=an-1;i>=0;i--)for(let j=bm-1;j>=0;j--)dp[i][j]=A[i]===B[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  }
  let anchor=pre>0?auto[pre-1].k:"^",R=[],I=[];
  const flush=()=>{
    if(!R.length&&!I.length)return;
    const pair=new Map(),used=new Set();
    R.forEach(ri=>{const tag=reportTagOf(auto[ri].k);if(tag){const j=I.findIndex((u,x)=>!used.has(x)&&u.includes(tag));if(j>=0){used.add(j);pair.set(j,ri);}}});
    const pairedR=new Set(pair.values());
    const restR=R.filter(ri=>!pairedR.has(ri));
    // Строка тега считается исправленной, только если новая строка тоже с номером;
    // иначе это удалённый тег и добавленная заметка.
    I.forEach((u,x)=>{
      if(used.has(x)||!restR.length)return;
      const isNum=REPORT_NUM.test(u);
      const k=restR.findIndex(r=>auto[r].k.startsWith("t:")===isNum);
      if(k>=0){used.add(x);pair.set(x,restR.splice(k,1)[0]);}
    });
    const paired=new Set(pair.values());
    R.forEach(ri=>{if(!paired.has(ri))out.del[auto[ri].k]=1;});
    let anc=anchor;
    I.forEach((u,x)=>{
      if(pair.has(x)){
        const L=auto[pair.get(x)];anc=L.k;
        const same=L.num?u.replace(REPORT_NUM,"")===L.t.replace(REPORT_NUM,""):u===L.t;
        if(!same)out.rep[L.k]=L.num?u.replace(REPORT_NUM,""):u;
      }else (out.ins[anc]=out.ins[anc]||[]).push(u);
    });
    if(R.length)anchor=auto[R[R.length-1]].k;
    R=[];I=[];
  };
  if(dp){
    let i=0,j=0;
    while(i<an||j<bm){
      if(i<an&&j<bm&&A[i]===B[j]){flush();anchor=auto[pre+i].k;i++;j++;}
      else if(j<bm&&(i>=an||dp[i][j+1]>=dp[i+1][j])){I.push(B[j]);j++;}
      else{R.push(pre+i);i++;}
    }
  }else{
    for(let i=0;i<an;i++)R.push(pre+i);
    I.push(...B);
  }
  flush();
  return out;
}
function applyReportOps(auto){
  const out=[];
  (reportOps.ins["^"]||[]).forEach(t=>out.push({t,num:false}));
  auto.forEach(L=>{
    if(!reportOps.del[L.k])out.push({t:L.k in reportOps.rep?reportOps.rep[L.k]:(L.num?L.t.replace(REPORT_NUM,""):L.t),num:L.num});
    (reportOps.ins[L.k]||[]).forEach(t=>out.push({t,num:false}));
  });
  let n=0;
  return out.map(o=>{if(/^(✅|⏳)/.test(o.t))n=0;return o.num?`${++n}. ${o.t}`:o.t;}).join("\n");
}

function regenerateReport(){
  reportAutoLines=buildReportLines();
  const text=applyReportOps(reportAutoLines),ta=$("reportText");
  if(ta.value!==text)ta.value=text;
  paintReportEditState();
}
function paintReportEditState(){
  const edited=reportHasOps(),ta=$("reportText");
  ta.classList.toggle("edited",edited);
  const box=$("reportEditState");
  box.replaceChildren();
  if(edited){
    const warn=document.createElement("span");warn.className="rpWarn";warn.textContent=TX("Изменено вручную");
    const reset=document.createElement("button");reset.type="button";reset.className="rpLink";reset.id="reportResetEdit";reset.textContent=TX("Вернуть исходный");
    box.append(warn,reset);
  }else{
    const hint=document.createElement("span");
    hint.textContent=reportEditing?TX("Правка: дополните или исправьте текст"):TX("Двойное касание по тексту — правка на весь экран");
    box.append(hint);
  }
  const has=!!ta.value.trim();
  $("reportSend").disabled=!has;
  $("reportSend").textContent=has?TX("Отправить"):TX("Выберите страницу");
}

function renderReportPages(){
  const box=$("reportPages");
  const sig=pages.map(p=>`${p.id}\u0001${p.name}\u0001${p.data.length}`).join("\u0002");
  if(box.dataset.sig!==sig){
    box.dataset.sig=sig;
    box.replaceChildren(...pages.map(page=>{
      const b=document.createElement("button");
      b.type="button";b.className="rpPage";b.dataset.pageId=String(page.id);
      const ck=document.createElement("span");ck.className="rpCheck";ck.textContent="✓";ck.setAttribute("aria-hidden","true");
      const nm=document.createElement("span");nm.className="rpPageName";nm.textContent=pageTitleForReport(page);
      const ct=document.createElement("span");ct.className="rpPageCount";ct.textContent=String(page.data.length);
      b.append(ck,nm,ct);
      return b;
    }));
  }
  const chosen=new Set(reportState.pages);
  box.querySelectorAll(".rpPage").forEach(b=>b.setAttribute("aria-pressed",String(chosen.has(b.dataset.pageId))));
  $("reportAllPages").textContent=reportState.pages.length===pages.length?TX("Снять все"):TX("Выбрать все");
}
function renderReportTiles(){
  let done=0,todo=0;
  reportChosenPages().forEach(p=>(p.data||[]).forEach(x=>{if(x.done)done++;else todo++;}));
  const counts={done,todo,all:done+todo};
  document.querySelectorAll(".rpTile").forEach(t=>{
    const k=t.dataset.reportKind;
    t.setAttribute("aria-pressed",String(reportState.kind===k));
    const num=t.querySelector(".rpNum");
    if(num.textContent!==String(counts[k]))num.textContent=String(counts[k]);
  });
}
function reportInitials(name){return name.split(/\s+/).filter(Boolean).map(w=>w[0]).join("").slice(0,2).toUpperCase();}
function renderReportPeople(){
  const box=$("reportPeople");
  const sig=reportState.people.join("\u0001");
  if(box.dataset.sig!==sig||!box.querySelector(".rpAdd")){
    box.dataset.sig=sig;
    const items=reportState.people.map(name=>{
      const b=document.createElement("button");
      b.type="button";b.className="rpPerson";b.dataset.person=name;
      const av=document.createElement("span");av.className="rpAv";av.textContent=reportInitials(name);av.setAttribute("aria-hidden","true");
      const nm=document.createElement("span");nm.className="rpName";nm.textContent=name;
      b.append(av,nm);
      return b;
    });
    const add=document.createElement("button");add.type="button";add.className="rpAdd";add.id="reportAddPeople";add.textContent=TX("+ Из контактов");
    box.replaceChildren(...items,add);
  }
  const on=new Set(reportState.on);
  box.querySelectorAll(".rpPerson").forEach(b=>{
    const active=on.has(b.dataset.person);
    b.setAttribute("aria-pressed",String(active));
    b.title=active?TX("Убрать из отчёта"):TX("Добавить в отчёт");
  });
}
function renderReport(){
  renderReportPages();
  renderReportTiles();
  $("reportWithTasks").checked=!!reportState.withTasks;
  renderReportPeople();
  regenerateReport();
}

function openReport(){
  flushSave();
  if(!reportState)reportState=loadReportState();
  reportValidatePages();
  if(!reportState.pages.length)reportState.pages=[String(activePageId)];
  safeSetStorage(REPORT_SEEN_KEY,"1");
  $("reportBtn")?.classList.remove("isNew");
  exitReportEdit();
  renderReport();
  $("reportBody").scrollTop=0;
  $("reportText").scrollTop=0;
  watchReportViewport(true);
  $("reportOverlay").classList.add("show");
}
function closeReport(){
  exitReportEdit();
  const ta=$("reportText");
  if(document.activeElement===ta)ta.blur();
  closeReportPick();
  $("reportOverlay").classList.remove("show");
  watchReportViewport(false);
}

// v103: окно занимает ровно видимую область экрана. На iPhone клавиатура не сжимает страницу,
// а перекрывает её — поэтому окно подгоняется под visualViewport, и «Отправить» остаётся над клавиатурой.
// В APK (adjustResize) и на Android в браузере видимая область и так уменьшается — тот же код.
let reportViewportOn=false;
function syncReportViewport(){
  const ov=$("reportOverlay");
  if(!ov)return;
  const vv=window.visualViewport;
  const h=Math.round(vv?vv.height:window.innerHeight),top=Math.round(vv?vv.offsetTop:0);
  ov.style.setProperty("--rp-vh",h+"px");
  ov.style.setProperty("--rp-top",top+"px");
  // Клавиатура открыта — нижний отступ под «полоску» iPhone не нужен.
  ov.classList.toggle("kb",window.innerHeight-h>120);
  if(reportEditing)requestAnimationFrame(()=>keepReportCaretVisible());
}
function watchReportViewport(on){
  const vv=window.visualViewport;
  if(on===reportViewportOn){if(on)syncReportViewport();return;}
  reportViewportOn=on;
  const fn=on?"addEventListener":"removeEventListener";
  vv?.[fn]("resize",syncReportViewport);
  vv?.[fn]("scroll",syncReportViewport);
  window[fn]("resize",syncReportViewport);
  if(on)syncReportViewport();
}

// v103: правка текста. Обычное касание и прокрутка — чтение (клавиатура не выскакивает),
// двойное касание — правка: настройки прячутся, поле текста на всё окно, курсор там, где коснулись.
let reportEditing=false;
function reportTextMirror(ta){
  const r=ta.getBoundingClientRect(),cs=getComputedStyle(ta),m=document.createElement("div");
  ["boxSizing","paddingTop","paddingRight","paddingBottom","paddingLeft","borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth",
   "borderTopStyle","borderRightStyle","borderBottomStyle","borderLeftStyle","fontFamily","fontSize","fontWeight","fontStyle","lineHeight",
   "letterSpacing","wordSpacing","textTransform","textIndent","tabSize","wordBreak","overflowWrap"].forEach(k=>{m.style[k]=cs[k];});
  Object.assign(m.style,{position:"fixed",left:r.left+"px",top:r.top+"px",width:r.width+"px",height:r.height+"px",margin:"0",
    overflow:"hidden",whiteSpace:"pre-wrap",opacity:"0",zIndex:"2147483647",borderColor:"transparent",background:"transparent",
    userSelect:"text",webkitUserSelect:"text",pointerEvents:"auto"});
  m.textContent=(ta.value||"")+"\u200b";
  document.body.appendChild(m);
  m.scrollTop=ta.scrollTop;
  return m;
}
// Номер символа под пальцем: тот же текст в невидимой копии поля поверх него (без перерисовки экрана).
function reportOffsetAtPoint(ta,x,y){
  let m=null;
  try{
    m=reportTextMirror(ta);
    let node=null,offset=0;
    if(document.caretRangeFromPoint){const r=document.caretRangeFromPoint(x,y);if(r){node=r.startContainer;offset=r.startOffset;}}
    else if(document.caretPositionFromPoint){const r=document.caretPositionFromPoint(x,y);if(r){node=r.offsetNode;offset=r.offset;}}
    if(node&&m.contains(node))return Math.max(0,Math.min(ta.value.length,offset));
  }catch(_){}finally{m?.remove();}
  return null;
}
// Высота от начала текста до курсора — чтобы прокрутить поле к месту правки.
function reportCaretTop(ta,pos){
  let m=null;
  try{
    m=reportTextMirror(ta);m.scrollTop=0;
    const node=m.firstChild,rg=document.createRange();
    const at=Math.max(0,Math.min(pos,node.length-1));
    rg.setStart(node,at);rg.setEnd(node,at+1);
    const rects=rg.getClientRects(),rect=rects[0]||rg.getBoundingClientRect();
    return rect.top-m.getBoundingClientRect().top;
  }catch(_){return null;}finally{m?.remove();}
}
function keepReportCaretVisible(center=false){
  const ta=$("reportText");
  if(!ta||document.activeElement!==ta)return;
  const y=reportCaretTop(ta,ta.selectionEnd);
  if(y==null)return;
  const line=parseFloat(getComputedStyle(ta).lineHeight)||22,view=ta.clientHeight;
  if(center){ta.scrollTop=Math.max(0,y-view*0.3);return;}
  if(y<ta.scrollTop+line*0.5)ta.scrollTop=Math.max(0,y-line);
  else if(y+line*1.5>ta.scrollTop+view)ta.scrollTop=y+line*2-view;
}
// focused=true — поле уже в фокусе от касания (клавиатура открыта браузером), фокус не трогаем.
function enterReportEdit(pos=null,focused=false){
  const ta=$("reportText");
  if(reportEditing||!ta||!$("reportOverlay").classList.contains("show"))return;
  if(pos==null){
    const sel=ta.selectionEnd;
    pos=Number.isFinite(sel)&&(sel>0||focused)?sel:ta.value.length;
  }
  if(!focused&&document.activeElement===ta)ta.blur();
  reportEditing=true;
  ta.readOnly=false;
  $("reportSheet").classList.add("editing");
  $("reportEditDone").hidden=false;
  paintReportEditState();
  if(!focused){try{ta.focus({preventScroll:true});}catch(_){ta.focus();}}
  try{ta.setSelectionRange(pos,pos);}catch(_){}
  keepReportCaretVisible(true);
}
function exitReportEdit(){
  const ta=$("reportText");
  if(!reportEditing)return;
  reportEditing=false;
  const pos=ta.selectionEnd;
  if(document.activeElement===ta)ta.blur();
  ta.readOnly=true;
  $("reportSheet").classList.remove("editing");
  $("reportEditDone").hidden=true;
  paintReportEditState();
  // Строка, которую правили, остаётся на виду и в обычном окне.
  const y=reportCaretTop(ta,pos);
  if(y!=null)ta.scrollTop=Math.max(0,y-ta.clientHeight*0.4);
}
function reportChanged(){saveReportState();renderReport();}

function reportAddPerson(name,enable=true){
  const clean=cleanReportField(name).slice(0,60);
  if(!clean)return false;
  if(!reportState.people.includes(clean))reportState.people.push(clean);
  if(enable&&!reportState.on.includes(clean))reportState.on.push(clean);
  return true;
}
function reportContactsAvailable(){
  return typeof window.AndroidApp?.pickContact==="function"||("contacts" in navigator&&typeof navigator.contacts?.select==="function");
}
const IS_IOS=/iP(hone|ad|od)/.test(navigator.userAgent||"")||(/Macintosh/.test(navigator.userAgent||"")&&navigator.maxTouchPoints>1);
function renderReportPickList(){
  const list=$("reportPickList");
  if(!reportState.people.length){
    const e=document.createElement("div");e.className="rpEmpty";e.textContent=TX("Пока никого нет — выберите в контактах или впишите имя.");
    list.replaceChildren(e);return;
  }
  const on=new Set(reportState.on);
  list.replaceChildren(...reportState.people.map((name,i)=>{
    const row=document.createElement("label");row.className="rpPick";row.htmlFor=`reportPick${i}`;
    const cb=document.createElement("input");cb.type="checkbox";cb.id=`reportPick${i}`;cb.checked=on.has(name);cb.dataset.person=name;
    const nm=document.createElement("span");nm.className="rpPickName";nm.textContent=name;
    const forget=document.createElement("button");forget.type="button";forget.className="rpForget";forget.textContent="×";
    forget.dataset.forget=name;forget.title=TX("Убрать из списка");forget.setAttribute("aria-label",TX("Убрать {0} из списка",name));
    row.append(cb,nm,forget);
    return row;
  }));
}
function reportPickCommitChecks(){
  $("reportPickList").querySelectorAll("input[type=checkbox]").forEach(cb=>{
    const name=cb.dataset.person;
    if(cb.checked){if(!reportState.on.includes(name))reportState.on.push(name);}
    else reportState.on=reportState.on.filter(x=>x!==name);
  });
}
function openReportPick(){
  // v104: на iPhone кнопка видна всегда — без доступа к телефонной книге она открывает ввод имени
  // с подсказками iPhone и объясняет, как включить выбор контактов.
  $("reportContactsBtn").hidden=!(reportContactsAvailable()||IS_IOS);
  $("reportPickHint").hidden=true;
  $("reportManualName").value="";
  renderReportPickList();
  $("reportPickOverlay").classList.add("show");
}
function closeReportPick(apply=true){
  const ov=$("reportPickOverlay");
  if(!ov?.classList.contains("show"))return;
  if(apply)reportPickCommitChecks();
  const inp=$("reportManualName");
  if(document.activeElement===inp)inp.blur();
  ov.classList.remove("show");
  reportChanged();
}
function reportManualAdd(){
  const inp=$("reportManualName");
  reportPickCommitChecks();
  if(reportAddPerson(inp.value)){inp.value="";saveReportState();renderReportPickList();}
}
async function reportPickFromContacts(){
  reportPickCommitChecks();
  const bridge=window.AndroidApp;
  if(typeof bridge?.pickContact==="function"){try{bridge.pickContact();}catch(_){showToast(TX("Не удалось открыть контакты"));}return;}
  if(!("contacts" in navigator&&typeof navigator.contacts?.select==="function")){
    // iPhone без Contact Picker API: сайтам телефонная книга недоступна.
    const inp=$("reportManualName"),hint=$("reportPickHint");
    hint.hidden=false;
    try{inp.focus({preventScroll:true});}catch(_){inp.focus();}
    return;
  }
  try{
    const picked=await navigator.contacts.select(["name"],{multiple:true});
    let added=0;
    (picked||[]).forEach(c=>{if(reportAddPerson(Array.isArray(c?.name)?c.name[0]:c?.name))added++;});
    if(added){saveReportState();renderReportPickList();}
  }catch(e){if(e?.name!=="AbortError"&&e?.name!=="InvalidStateError")showToast(TX("Контакты недоступны — впишите имя вручную"));}
}
// APK: имя выбранного в системных контактах человека (MainActivity → RC_CONTACT).
window.__tagListContactPicked=name=>{
  if(!reportState)reportState=loadReportState();
  if(!reportAddPerson(name))return;
  saveReportState();
  if($("reportPickOverlay")?.classList.contains("show"))renderReportPickList();
  else if($("reportOverlay")?.classList.contains("show"))renderReport();
};

async function sendReport(){
  const ta=$("reportText");
  const text=ta.value.replace(/\s+$/,"");
  if(!text.trim())return;
  const chosen=reportChosenPages();
  const title=chosen.length===1?pageTitleForReport(chosen[0]):TX("{0} — отчёт",cleanReportField(docTitle)||"Tag list");
  if(document.activeElement===ta)ta.blur();
  try{
    if(navigator.share){await navigator.share({title,text});closeReport();showToast(TX("Отчёт передан"));return;}
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);closeReport();showToast(TX("Текст отчёта скопирован"));return;}
    throw new Error("share-unavailable");
  }catch(e){
    if(e?.name==="AbortError")return;
    try{ta.focus({preventScroll:true});ta.select();}catch(_){}
    showToast(TX("Не удалось передать — текст выделен, скопируйте его"));
  }
}

// v101: русские буквы, похожие на латинские (Р, Т, Е, А…), внутри тега переводятся в латиницу:
// распознавание и ручной ввод часто дают «2131-РТ-102» вместо 2131-PT-102.
const OCR_HOMOGLYPHS={"А":"A","В":"B","Е":"E","К":"K","М":"M","Н":"H","Р":"P","С":"C","Т":"T","У":"Y","Х":"X"};
function normalizeOcrText(text){
  return String(text||'').toUpperCase()
    .replace(/[–—−_]/g,"-")
    .replace(/[АВЕКМНРСТУХ]/g,ch=>OCR_HOMOGLYPHS[ch])
    .replace(/[ОO]/g,"O")
    .replace(/[ІI]/g,"I")
    .replace(/[Ё]/g,"E")
    .replace(/[\r\n]+/g,"\n");
}

// v105: канонический вид — по выбранному формату (раньше только «4 цифры-буквы-3 цифры»,
// номер из 4 цифр обрезался до 3).
function canonicalTag(s){
  return window.TagFormat?TagFormat.canonical(s):null;
}

function knownTags(){ return data.map(x=>x.tag).filter(Boolean); }

function updateOcrConfigStatus(){
  const online=ocrEngine()==="online";
  for(const id of ["ocrOnlineToggle","headOcrToggle"]){const t=$(id);if(t)t.checked=online;}
  document.querySelector(".ocrEngineRow")?.classList.toggle("online",online);
  $("headOcr")?.classList.toggle("on",online);
  $("ocrEngineTitle").textContent=online?"OCR.space, Engine 3 → 2":TX("На телефоне, без интернета");
  $("ocrConfigStatus").textContent=online?TX("Нужны интернет и VPN, фото уходит на сервер"):TX("Фото не покидает устройство");
  updateNetStrip();
}
// Строка под заголовком меню: при включённом OCR.space напоминает про сеть и VPN и показывает, отвечает ли сервис.
let netStripCheck=0;
function updateNetStrip(state){
  const strip=$("netStrip");if(!strip)return;
  const show=ocrEngine()==="online"&&overlay.classList.contains("addMenu");
  strip.classList.toggle("open",show);
  if(!show)return;
  const st=state||(ocrNetworkKnownUp()?"up":"check");
  strip.classList.toggle("up",st==="up");strip.classList.toggle("down",st==="down");
  $("netStripState").textContent=st==="up"?TX("· OCR.space на связи"):st==="down"?TX("· OCR.space пока не отвечает"):TX("· проверяю связь…");
  if(!state&&st==="check"){
    const n=++netStripCheck;
    probeOcrNetwork(true).then(up=>{if(n===netStripCheck)updateNetStrip(up?"up":"down");});
  }
}
function setOcrEngine(online){
  safeSetStorage(OCR_ENGINE_KEY,online?"online":"local");
  updateOcrConfigStatus();
  if(online)probeOcrNetwork(true);
  else if(ocrPhoto)loadLocalOcr().then(()=>window.LocalOCR.warmUp()).catch(()=>{});
}

function setProgress(v){ $('ocrBar').style.width=Math.max(0,Math.min(100,v))+'%'; }

function setFileProgress(v){ const el=$("fileBar"); if(el) el.style.width=Math.max(0,Math.min(100,v))+'%'; }

function nextFrame(){ return new Promise(resolve=>requestAnimationFrame(()=>resolve())); }

function levenshtein(a,b){
  const m=a.length,n=b.length,prev=Array(n+1).fill(0),cur=Array(n+1).fill(0);
  for(let j=0;j<=n;j++)prev[j]=j;
  for(let i=1;i<=m;i++){cur[0]=i;for(let j=1;j<=n;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));for(let j=0;j<=n;j++)prev[j]=cur[j]}
  return prev[n];
}

function fuzzyKnownTag(tag){
  const all=knownTags(); if(!all.length)return tag;
  const exact=all.find(k=>tagKey(k)===tagKey(tag)); if(exact)return exact;
  const compact=x=>x.toUpperCase().replace(/[^A-Z0-9]/g,'');
  const a=compact(tag); let best=null,bestD=99;
  for(const k of all){const b=compact(k);if(Math.abs(a.length-b.length)>1)continue;const d=levenshtein(a,b); if(d<bestD){bestD=d;best=k}}
  // Для фото разрешаем только небольшую OCR-ошибку. Большая дистанция создаёт ложное
  // сопоставление с ближайшим существующим тегом.
  return best && bestD<=1 ? best : tag;
}

function extractTagsSmart(text){
  const found=new Set();
  for(const t of TagFormat.find(String(text||"").replace(/[\r\n]+/g,"\n")))found.add(fuzzyKnownTag(t.tag));
  return [...found];
}

function cleanImportedTask(value){
  let t=String(value||'')
    .replace(/\u00a0/g,' ')
    .replace(/[\r\n\t]+/g,' ')
    .replace(/\s+/g,' ')
    .replace(/^[\s\-–—:;,.|•·]+|[\s\-–—:;,.|•·]+$/g,'')
    .trim();
  if(!t)return '';
  // Убираем служебные поля таблиц, которые не являются заданием.
  t=t.replace(/^\s*\d+\.\s*(?:✔️?|✓|☑|О|O|0)?\s*[—–:-|•·]*\s*/i,'')
     .replace(/^\s*(?:✔️?|✓|☑|О|O|0)\s*[—–:-|•·]+\s*/i,'')
     .replace(/\b(?:\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g,' ')
     .replace(/\b(?:unit|установка)\s*\d{4}\b/gi,' ')
     .replace(/\b(?:кип\s*[—-]?\s*чек[- ]?лист|всего|выполнено|невыполнено)\b/gi,' ')
     .replace(/^\s*={2,}.*?={2,}\s*$/,' ')
     .replace(/\s{2,}/g,' ')
     .trim();
  if(!t)return '';
  if(/^\d{4}$/.test(t))return '';
  if(/^(?:страница|page)\s*\d+$/i.test(t))return '';
  if(/^(?:emerson|wika|chongqing\s+chuanyi|tesey|эмерсон)$/i.test(t))return '';
  if(/^[A-Z0-9][A-Z0-9 ._\/-]{1,45}$/.test(t) && !/[А-ЯЁа-яё]/.test(t))return '';
  if(/^[\d\s.,;:/()\-–—]+$/.test(t))return '';
  return t.slice(0,240);
}

function completeMeaningfulTaskPhrase(value){
  let t=String(value||"").replace(/\s+/g," ").trim();
  if(!t)return "";
  // Не угадываем отсутствующие технические данные. Дополняем только очевидные
  // производственные фразы, когда начало фразы однозначно указывает на действие.
  const completions=[
    [/\bнет\s+теговой\s+би\b/i,"нет теговой бирки"],
    [/\bнет\s+обратно\b/i,"нет обратной связи"],
    [/\bнет\s+обратн\w*\b/i,"нет обратной связи"],
    [/\bнет\s+питани\w*\b/i,"нет питания"],
    [/\bнет\s+связ\w*\b/i,"нет связи"],
    [/\bнет\s+прибор\w*\b/i,"нет прибора"],
    [/\bнет\s+датчик\w*\b/i,"нет датчика"],
    [/\bнет\s+кабел\w*\b/i,"нет кабеля"],
    [/\bнет\s+воздух\w*\b/i,"нет воздуха"],
    [/\bнет\s+пневм\w*\b/i,"нет пневмопитания"]
  ];
  for(const [re,replacement] of completions){if(re.test(t))t=t.replace(re,replacement);}
  return t;
}

function extractMeaningfulWords(value){
  const t=String(value||"").replace(/\s+/g," ").trim();
  if(!t)return "";
  // Сохраняем цельные слова и короткие технические обозначения, удаляя
  // отдельные OCR-фрагменты без самостоятельного смысла.
  const tokens=t.split(" ").filter(Boolean);
  const kept=tokens.filter(tok=>{
    const clean=tok.replace(/^[^A-Za-zА-ЯЁа-яё0-9]+|[^A-Za-zА-ЯЁа-яё0-9%№/.-]+$/g,"");
    if(!clean)return false;
    if(/^[^A-Za-zА-ЯЁа-яё0-9]+$/.test(clean))return false;
    if(clean.length===1 && !/[А-ЯЁа-яёA-Za-z0-9]/.test(clean))return false;
    return true;
  });
  return kept.join(" ");
}

function taskLikeText(value){
  let t=cleanImportedTask(value);
  if(!t)return '';
  t=extractMeaningfulWords(t);
  if(!t)return '';
  t=completeMeaningfulTaskPhrase(t);
  // v105: задания по-английски (зарубежные перечни): ключевые слова или фраза из двух слов со строчными буквами.
  const enWords=(t.match(/\b[A-Za-z]{3,}\b/g)||[]).filter(w=>/[a-z]/.test(w));
  const hasMeaning=/[А-ЯЁа-яё]/.test(t) || /\b(?:check|replace|repair|broken|sensor|install|verify|change|calibrat\w*|flush\w*|stroke|test\w*|pending|valve|transmitter|cable|wiring|signal|leak\w*|fault\w*|alarm|setpoint|span|damaged|missing|power|supply|перенастро|замен|провер|оборван|неисправ|сенсор|датчик|ремонт|монтаж|клапан|соленоид|манифольд|утечк|давлен|бирк|шильдик|кабель|муфт|болт|высот|фото|устран|погнут|клин|заед|связ|HART|прибор|питани|пневм|воздух)\b/i.test(t) || enWords.length>=2;
  return hasMeaning?t.slice(0,240):'';
}

function normalizeDoneMark(value){
  const v=String(value??'').trim().toLowerCase();
  if(!v)return false;
  return /^(✓|✔|☑|☒|✕|✖|×|\+|v|да|yes|true|done|готово|выполнено|1)$/i.test(v);
}

function stripTagFromContext(text){
  let t=String(text||'');
  const spans=TagFormat.find(t);
  for(let i=spans.length-1;i>=0;i--)t=t.slice(0,spans[i].start)+' '+t.slice(spans[i].end);
  return cleanImportedTask(t);
}

function isNoiseImportLine(line){
  const t=String(line||'').trim();
  if(!t)return true;
  if(/^(?:кип\s*[—-]?\s*чек[- ]?лист|всего\s*:|выполнено\s*:|невыполнено\s*:|===|---|добавить|выполнено)$/i.test(t))return true;
  if(/^(?:основная\s+страница|страница\s+\d+)$/i.test(t))return true;
  return false;
}

function extractJsonTagRecords(text){
  const raw=String(text||'').trim();
  if(!raw || !/^[\[{]/.test(raw))return [];
  let parsed;try{parsed=JSON.parse(raw)}catch(_){return []}
  const out=[];
  const walk=(node)=>{
    if(Array.isArray(node)){node.forEach(walk);return;}
    if(!node || typeof node!=='object')return;
    const keys=Object.keys(node);
    const tagKeyName=keys.find(k=>/^(tag|тег|tag_number|tagNumber)$/i.test(k));
    if(tagKeyName){
      // v105: поле «тег» в JSON — любой известный формат (выбранный, ISA-5.1, KKS).
      const rawTag=String(node[tagKeyName]??'').trim();
      const r=rawTag?TagFormat.anyValid(rawTag):null;
      if(r&&r.ok){
        const taskKey=keys.find(k=>/^(task|задание|assignment|note|комментарий|comment)$/i.test(k));
        const doneKey=keys.find(k=>/^(done|completed|complete|выполнено|статус|status)$/i.test(k));
        out.push({unit:r.unit||"",tag:r.tag,done:normalizeDoneMark(node[doneKey]),task:taskLikeText(node[taskKey]??'')});
      }
    }
    keys.forEach(k=>walk(node[k]));
  };
  walk(parsed);
  return out;
}

function extractTagRecordsFromText(text){
  const jsonRecords=extractJsonTagRecords(text);
  if(jsonRecords.length){
    const map=new Map();
    for(const r of jsonRecords){const key=tagKey(r.tag),prev=map.get(key);if(!prev)map.set(key,r);else{prev.done=prev.done||r.done;prev.task=prev.task||r.task;}}
    return [...map.values()];
  }
  const lines=String(text||'').replace(/\r/g,'').split('\n');
  const records=[];
  // v101: буква-суффикс (…-061A) только вплотную к номеру: отметка «v» через пробел — не часть тега.
  // v105: теги ищутся по выбранному формату (TagFormat): ISA-5.1, KKS или свой образец.
  let current=null;
  for(const rawLine of lines){
    const line=String(rawLine||'').trim();
    if(!line)continue;
    const matches=TagFormat.find(line);
    if(matches.length){
      for(let i=0;i<matches.length;i++){
        const m=matches[i],tag=m.tag;
        if(!tag)continue;
        const start=m.end;
        const end=i+1<matches.length?matches[i+1].start:line.length;
        const after=line.slice(start,end);
        // v101: номер строки таблицы («556», «12.») перед тегом — не задание.
        const beforeRaw=i===0?line.slice(0,m.start):'';
        const before=/^[\s\d.)№#|]*$/.test(beforeRaw)?'':beforeRaw;
        const context=stripTagFromContext(`${before} ${after}`);
        const markContext=`${before} ${after}`;
        const done=/(^|[\s|;,:\t])(✓|✔|☑|☒|✕|✖|×|\+|v|да|yes|true|done|выполнено|готово)(?=[\s|;,:\t]|$)/i.test(markContext)
          ||/[✓✔☑☒✕✖×]/.test(markContext)
          || /(^|\s)[+v]\s*$/i.test(markContext.trim());
        current={unit:m.unit||"",tag,done,task:taskLikeText(context)};
        records.push(current);
      }
    }else if(current && !isNoiseImportLine(line)){
      const continuation=taskLikeText(line.replace(/^[\-–—:|•]+/,'').trim());
      if(continuation){
        const combined=cleanImportedTask(`${current.task} ${continuation}`);
        current.task=completeMeaningfulTaskPhrase(combined).slice(0,240);
      }
    }
  }
  const map=new Map();
  for(const r of records){
    const key=tagKey(r.tag),prev=map.get(key);
    if(!prev)map.set(key,r);
    else{
      prev.done=prev.done||r.done;
      if(r.task)prev.task=prev.task?cleanImportedTask(`${prev.task} ${r.task}`):r.task;
    }
  }
  return [...map.values()].map(r=>({...r,task:cleanImportedTask(r.task)}));
}

function setAddMode(mode){
  addMode=mode;
  overlay.classList.toggle("import-mode",mode==="camera"||mode==="photo"||mode==="file");
  const photoMode=(mode==="camera"||mode==="photo");
  const fileMode=mode==="file";
  $("cameraChoice").classList.toggle("active",mode==="camera");
  $("photoChoice").classList.toggle("active",mode==="photo");
  $("fileChoice").classList.toggle("active",fileMode);
  $("addChoice").style.display=(photoMode||fileMode)?"none":"grid";
  $("manualForm").style.display=mode==="manual"?"block":"none";
  $("photoForm").style.display=photoMode?"flex":"none";
  $("fileForm").style.display=fileMode?"flex":"none";
  // v101: тумблер OCR.space у заголовка — только в меню «Добавить прибор» (не при редактировании).
  overlay.classList.toggle("addMenu",mode==="manual"&&editId===null);
  setReviewing(false);
  updateOcrConfigStatus();
  if(typeof layoutAddHead==="function")layoutAddHead();
}

function openAdd(){
  editId=null;
  $("modalTitleText").textContent=TX("Добавить"); // v105: короче — заголовок, формат и OCR в одну строку
  setAddMode("manual");
  $("addChoice").style.display="grid";
  tagInput.value="";checkTagLine();lastImport=null;lastOcrText="";
  manualTaskInput.value="";
  statusInput.value="todo";
  deleteBtn.style.display="none";
  $("importList").innerHTML="";
  $("importActions").style.display="none";
  $("photoImportLegend").classList.remove("ready");
  $("ocrStatus").textContent="";
  $("fileImportList").innerHTML="";
  $("fileImportActions").style.display="none";
  $("fileImportLegend").classList.remove("ready");
  $("fileImportStatus").textContent="";
  $("fileProgressWrap").style.display="none";
  setFileProgress(0);
  overlay.classList.add("show");
  resetOcrPhoto();updateOcrConfigStatus();updateFmtButton();
  if(ocrEngine()==="online")probeOcrNetwork(); // заранее узнать, доступен ли OCR.space
  setTimeout(()=>tagInput.focus(),50);
}

function escapeHtml(value){return String(value||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}

function loadSheetJs(){
  if(window.XLSX)return Promise.resolve(window.XLSX);
  if(sheetJsPromise)return sheetJsPromise;
  sheetJsPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    // v81: SheetJS 0.18.5 лежит в самом приложении (js/vendor) — Excel читается
    // полностью локально, без интернета. Единственный сетевой запрос приложения — OCR фото.
    script.src=new URL("./js/vendor/xlsx.full.min.js",document.baseURI).href;
    script.async=true;
    script.onload=()=>window.XLSX ? resolve(window.XLSX) : reject(new Error(TX("Не удалось запустить модуль Excel")));
    script.onerror=()=>{script.remove();reject(new Error(TX("Не удалось загрузить модуль Excel (js/vendor/xlsx.full.min.js). Проверь, что файл опубликован вместе с приложением.")));};
    document.head.appendChild(script);
  }).catch(err=>{sheetJsPromise=null;throw err;});
  return sheetJsPromise;
}

// v109: дубликат с буквой. Тег, который уже есть на этой странице, — не повод запрещать строку навсегда:
// второй прибор с тем же номером (резерв, A/B) отличается буквой вплотную к номеру — 2131-PT-414A.
// Флажок «Добавить» строки-дубликата выключен, пока тег совпадает; после правки он включается сам.
// Свободная буква: 2131-PT-414 → 414A; если 414A занят — 414B; для 414A → 414B.
function dupSuffixSuggest(tag,taken){
  const t=String(tag||"").trim().toUpperCase();if(!t)return "";
  const m=t.match(/^(.*\d)([A-Z])$/);
  const base=m?m[1]:t;const from=m?m[2].charCodeAt(0)-64:0;
  const tries=[];
  for(let i=from;i<26;i++)tries.push(String.fromCharCode(65+i));
  if(m)for(let i=0;i<from-1;i++)tries.push(String.fromCharCode(65+i));
  for(const L of tries){
    const cand=base+L,key=tagKey(cand);
    if(taken&&taken.has(key))continue;
    const r=window.TagFormat?TagFormat.anyValid(cand):{ok:true,tag:cand};
    if(r&&r.ok&&tagKey(r.tag)===key)return r.tag;
  }
  return "";
}
// Строки списка найденного: флажок, подсветка и пояснение под тегом — по текущему тексту поля.
function refreshImportRows(box){
  if(!box)return;
  const rows=[...box.querySelectorAll(".importItem")];
  const existing=new Map(data.map(x=>[tagKey(x.tag),x]));
  const pageName=String(getActivePage()?.name||"").trim();
  const keys=rows.map(row=>{const v=row.querySelector(".importTag")?.value||"";const r=v.trim()?TagFormat.anyValid(v):null;return r&&r.ok?tagKey(r.tag):"";});
  const taken=new Set([...existing.keys(),...keys.filter(Boolean)]);
  const seen=new Map();
  rows.forEach((row,i)=>{
    const inp=row.querySelector(".importTag"),pick=row.querySelector(".importPick");if(!inp||!pick)return;
    const raw=inp.value.trim(),key=keys[i];
    let state="ok",html="";
    if(!raw){state="bad";html=TX("Пустой тег — впишите тег или снимите отметку.");}
    else if(!key){const r=TagFormat.anyValid(raw);state="bad";html=TX("Не похоже на тег: {0}.",escapeHtml(TX(r?r.reason:"не похоже на тег")));}
    else if(existing.has(key)){
      state="dup";const prev=existing.get(key);const sug=dupSuffixSuggest(raw,taken);
      html=TX("Уже есть на странице «{0}» (строка №{1}).",escapeHtml(pageName),itemNo(prev))+" "+(sug?TX("Второй прибор с тем же номером — допишите букву к номеру: {0}",`<button class="dupFix" data-dup-fix="${escapeHtml(sug)}" type="button">${escapeHtml(sug)}</button>`):TX("Измените тег, чтобы добавить его."));
    }else if(seen.has(key)){
      state="dup";const sug=dupSuffixSuggest(raw,taken);
      html=TX("Повтор: этот тег уже выше в списке (№{0}).",seen.get(key)+1)+(sug?" "+TX("Допишите букву: {0}",`<button class="dupFix" data-dup-fix="${escapeHtml(sug)}" type="button">${escapeHtml(sug)}</button>`):"");
    }else if(row.dataset.wasDup==="1"){html=TX("✓ Новый тег — будет добавлен.");}
    if(key&&!seen.has(key))seen.set(key,i);
    const prev=row.dataset.state||"";
    if(state==="dup"){pick.checked=false;pick.disabled=true;if(!prev||prev==="ok")row.dataset.wasDup="1";}
    else{pick.disabled=false;if(prev==="dup")pick.checked=true;}
    row.dataset.state=state;row.classList.toggle("isDup",state==="dup");row.classList.toggle("isBad",state==="bad"&&pick.checked);
    inp.style.borderColor="";
    let hint=row.querySelector(".importDup");
    if(!html){hint?.remove();return;}
    if(!hint){hint=document.createElement("div");hint.className="importDup";hint.setAttribute("aria-live","polite");row.querySelector(".importRow").after(hint);}
    hint.className="importDup"+(state==="dup"?" dup":state==="bad"?" bad":" ok");
    if(hint.innerHTML!==html)hint.innerHTML=html;
  });
  const dups=rows.filter(r=>r.dataset.state==="dup").length;
  const note=box.querySelector(".importDupNote");
  if(dups){
    const n=note||document.createElement("div");n.className="importDupNote";
    const html=TX("Повторы ({0}) не отмечены: такие теги уже есть на этой странице. Если это другой прибор с тем же номером (резерв, пара A/B), допишите букву вплотную к номеру — <b>414A</b>, <b>414B</b> — и строка добавится.",dups);
    if(n.innerHTML!==html)n.innerHTML=html;
    if(!note)box.prepend(n);
  }else note?.remove();
}
function wireImportRow(box,row){
  const inp=row.querySelector(".importTag");
  inp?.addEventListener("input",()=>refreshImportRows(box));
  row.querySelector(".importPick")?.addEventListener("change",()=>refreshImportRows(box));
}
document.addEventListener("click",e=>{
  const b=e.target.closest?.("[data-dup-fix]");if(!b)return;
  e.preventDefault();
  if(b.closest(".importItem")){const row=b.closest(".importItem"),inp=row.querySelector(".importTag");inp.value=b.dataset.dupFix;refreshImportRows(row.closest(".importList"));inp.focus();return;}
  if(b.closest("#tagCheck")){tagInput.value=b.dataset.dupFix;checkTagLine();tagInput.focus();}
});

function renderFileCandidates(){
  const box=$("fileImportList"),actions=$("fileImportActions");
  box.innerHTML="";
  $("fileImportLegend").classList.remove("ready");
  $("fileBackBtn").style.display=fileCandidates.length?"none":"block";
  setReviewing(fileCandidates.length>0);
  if(!fileCandidates.length){
    box.innerHTML=emptyFormatHtml(lastImport?.text);addFormatNote($("fileImportStatus"));
    actions.style.display="none";return;
  }
  const existing=new Set(data.map(item=>tagKey(item.tag)));
  $("fileImportLegend").classList.add("ready");
  fileCandidates.forEach(candidate=>{
    const tag=String(candidate.tag||"").toUpperCase(),already=existing.has(tagKey(tag));
    const row=document.createElement("div");row.className="importItem";row.dataset.candidateTag=tag;
    const line=document.createElement("div");line.className="importRow";
    const pick=document.createElement("input");pick.type="checkbox";pick.className="importPick";pick.checked=!already;pick.disabled=already;pick.title=TX("Добавить");pick.setAttribute("aria-label",TX("Добавить {0}",tag));
    const inp=document.createElement("input");inp.type="text";inp.value=tag;inp.className="importTag";inp.setAttribute("aria-label",TX("Тег {0}",tag));
    const taskToggle=document.createElement("button");taskToggle.type="button";taskToggle.className="importTaskInline"+(candidate.task?" hasTask":"");taskToggle.title=candidate.task?TX("Задание: есть запись"):TX("Задание");taskToggle.setAttribute("aria-label",TX("Задание для {0}",tag));taskToggle.setAttribute("aria-expanded",candidate.task?"true":"false");
    const done=document.createElement("input");done.type="checkbox";done.className="importDone";done.checked=!!candidate.done;done.title=TX("Выполнено");done.setAttribute("aria-label",TX("Выполнено: {0}",tag));
    const taskWrap=document.createElement("div");taskWrap.className="importTaskWrap"+(candidate.task?" open":"");
    const task=document.createElement("textarea");task.className="importTask";task.rows=1;task.placeholder=TX("Опишите задание");task.value=candidate.task||"";taskWrap.appendChild(task);
    taskToggle.addEventListener("click",()=>{const open=taskWrap.classList.toggle("open");taskToggle.setAttribute("aria-expanded",String(open));if(open)setTimeout(()=>{task.scrollTop=0;autosizeTaskTextarea(task,104);task.focus();requestAnimationFrame(()=>task.scrollTop=0);},20);});
    task.addEventListener("input",()=>{const has=!!task.value.trim();taskToggle.classList.toggle("hasTask",has);taskToggle.title=has?TX("Задание: есть запись"):TX("Задание");});
    line.append(pick,inp,taskToggle,done);row.append(line,taskWrap);box.appendChild(row);wireImportRow(box,row);
  });
  refreshImportRows(box);
  importUnitHeaders(box,fileCandidates.map(c=>String(c.tag||"")));
  addFormatNote($("fileImportStatus"));
  actions.style.display="flex";
}

async function processTextImport(text,label=TX("Текст"),startProgress=35){
  const status=$("fileImportStatus");
  $("fileProgressWrap").style.display="block";setFileProgress(startProgress);await nextFrame();
  lastImport={text,label};
  const records=extractTagRecordsFromText(text);
  setFileProgress(Math.max(startProgress+8,78));await nextFrame();
  fileCandidates=records;
  status.textContent=TX("{0}: найдено тегов {1}. Проверь задания и отметки перед добавлением.",label,records.length);
  renderFileCandidates();
  setFileProgress(100);setTimeout(()=>{$("fileProgressWrap").style.display="none"},450);
}

// v101: «Вставить» в меню сразу читает буфер обмена (в APK — через приложение) и показывает найденные теги.
async function pasteTextImport(){
  let text="",label=TX("Буфер обмена"),unreadable=false;
  try{
    if(!navigator.clipboard?.readText)throw new Error("clipboard");
    text=await navigator.clipboard.readText();
  }catch(e){unreadable=true;}
  if(!String(text||"").trim()){
    const typed=prompt(unreadable?TX("Вставь сюда скопированный текст со списком тегов и заданий:"):TX("Буфер обмена пуст. Вставь сюда текст со списком тегов и заданий:"),"");
    if(!typed||!typed.trim()){if(unreadable)showToast(TX("Не удалось прочитать буфер обмена. Скопируй список тегов и нажми «Вставить» ещё раз."));return;}
    text=typed;label=TX("Вставленный текст");
  }
  openFileReview();
  await processTextImport(text,label);
}
// Окно результатов импорта из файла или буфера — без подсказок и кнопок выбора.
function openFileReview(){
  setAddMode("file");
  $("fileImportList").innerHTML="";$("fileImportActions").style.display="none";$("fileImportLegend").classList.remove("ready");
  $("fileImportStatus").textContent="";$("fileBackBtn").style.display="none";fileCandidates=[];
}

async function runFileImport(file){
  const status=$("fileImportStatus");
  $("fileImportList").innerHTML="";$("fileImportActions").style.display="none";fileCandidates=[];
  $("fileProgressWrap").style.display="block";setFileProgress(5);
  try{
    if(file.size>10*1024*1024)throw new Error(TX("Файл больше 10 МБ. Для бюджетного устройства лучше экспортировать нужный лист или сохранить его как CSV."));
    await nextFrame();
    const name=String(file.name||"").toLowerCase();let text="";
    if(/\.(xlsx|xls)$/.test(name)){
      status.textContent=TX("Открываю Excel локально на устройстве…");setFileProgress(20);await nextFrame();
      const XLSX=await loadSheetJs();setFileProgress(38);await nextFrame();
      const workbook=XLSX.read(await file.arrayBuffer(),{type:"array",cellText:true,cellDates:false});
      setFileProgress(58);await nextFrame();
      // Сохраняем строки как TSV, чтобы извлечь не только теги, но и соседние поля
      // «Выполнено» / «Задание».
      text=workbook.SheetNames.map(sheetName=>XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName],{FS:"\t"})).join("\n");
      setFileProgress(72);await nextFrame();
    }else if(/\.json$/.test(name)||file.type==="application/json"){
      status.textContent=TX("Открываю состояние из JSON…");setFileProgress(45);await nextFrame();
      await importJsonStateFile(file);setFileProgress(100);
      status.textContent=TX("{0}: состояние открыто.",file.name||"JSON");
      setTimeout(()=>{$("fileProgressWrap").style.display="none"},500);
      return;
    }else if(/\.(csv|tsv|txt)$/.test(name)||/^text\//.test(file.type||"")){
      status.textContent=TX("Читаю файл…");setFileProgress(28);await nextFrame();
      text=await file.text();setFileProgress(68);await nextFrame();
    }else throw new Error(TX("Поддерживаются XLSX, XLS, CSV, TSV, TXT и JSON. Для PDF или Word сначала сохрани таблицу как CSV или Excel."));
    await processTextImport(text,file.name||TX("Файл"),Math.max(72,Number($('fileBar').style.width.replace("%",""))||72));
    setFileProgress(100);status.textContent=TX("{0}: найдено тегов {1}. Проверь задания и отметки перед добавлением.",file.name||TX("Файл"),fileCandidates.length);addFormatNote(status);
    setTimeout(()=>{$("fileProgressWrap").style.display="none"},500);
  }catch(error){
    console.error(error);setFileProgress(0);status.textContent=TX("Не удалось импортировать: {0}",TX.msg(error.message||error));
    $("fileBackBtn").style.display="block";
  }
}

function importFileCandidates(){
  const rows=[...$("fileImportList").querySelectorAll(".importItem")];
  const existing=new Set(data.map(item=>tagKey(item.tag)));const additions=[],duplicates=[],invalid=[];
  rows.forEach((row,index)=>{
    const checked=row.querySelector('.importPick');if(!checked?.checked)return;
    const tagInput=row.querySelector('.importTag'),doneInput=row.querySelector('.importDone'),taskInput=row.querySelector('.importTask');
    // v105: тег из списка проверяется по формату (выбранному или любому известному).
    const r=TagFormat.anyValid(tagInput.value);
    if(!r||!r.ok){invalid.push(index+1);return;}
    const tag=r.tag,unit=r.unit||"",key=tagKey(tag);
    if(existing.has(key)){duplicates.push(tag);return;}
    existing.add(key);additions.push({unit,tag,done:!!doneInput?.checked,task:String(taskInput?.value||"").trim()});
  });
  if(invalid.length){showToast(TX("Исправь тег(и) №{0} перед добавлением",invalid.join(", ")));return;}
  if(duplicates.length){const unique=[...new Set(duplicates)];showToast(TX("Дубликаты не добавлены: {0}. Измени тег или сними отметку.",unique.join(", ")));return;}
  if(!additions.length){showToast(TX("Новых тегов для добавления нет"));return;}
  const max=data.reduce((m,x)=>Math.max(m,Number(x.id)||0),0),before=data.length;
  data=data.concat(additions.map((x,i)=>({id:max+i+1,...x})));
  try{save();if(data.length!==before+additions.length)throw new Error(TX("Проверка количества после сохранения не прошла"));}
  catch(error){console.error(error);data=data.slice(0,before);save();showToast(TX("Не удалось сохранить добавленные теги. Повтори ещё раз."));return;}
  closeModal();render();showToast(TX("Добавлено из файла/текста: {0}",additions.length));
}

// v98: пункт шрифта показывается, только если на этом устройстве он действительно
// отличается от системного — и латиница (теги), и кириллица (интерфейс) — и не повторяет
// уже показанный пункт. Так в списке нет «пустых» пунктов, которые молча подменяются
// системным шрифтом или рисуют кириллицу системным. Замер шириной текста на canvas.
let fontProbeCtx=null;
function fontSignature(family){
  const ctx=fontProbeCtx||(fontProbeCtx=document.createElement("canvas").getContext("2d"));
  return ["2131-PZT-414A wm","КИП Жжщы задание"].map(text=>{
    ctx.font="1px serif";ctx.font=`40px ${family}`;
    if(!/40px/.test(ctx.font))throw new Error("font-parse");
    return ctx.measureText(text).width;
  });
}
function availableFontOptions(){
  try{
    const near=(a,b)=>Math.abs(a-b)<=0.5;
    const sys=fontSignature(SYSTEM_FONT_STACK),kept=[{option:FONT_OPTIONS[0],sig:sys}];
    for(const option of FONT_OPTIONS.slice(1)){
      const sig=fontSignature(option.family);
      if(near(sig[0],sys[0])||near(sig[1],sys[1]))continue;
      if(kept.some(k=>near(k.sig[0],sig[0])&&near(k.sig[1],sig[1])))continue;
      kept.push({option,sig});
    }
    return kept.map(k=>k.option);
  }catch(_){return FONT_OPTIONS.slice();}
}
function getFontOption(id){const list=availableFontOptions();return list.find(x=>x.id===id)||list[0];}

let currentFontId="system";
function applyFontFamily(id,persist=true){
  const option=getFontOption(id);
  currentFontId=option.id;
  document.documentElement.style.setProperty("--appFont",option.family);
  // При запуске не затираем сохранённый выбор, если шрифт сейчас недоступен.
  if(persist)safeSetStorage(FONT_FAMILY_KEY,option.id);
  const btn=$("fontBtn");
  if(btn){btn.title=TX("Шрифт: {0}",TX(option.name));btn.setAttribute("aria-label",TX("Выбрать шрифт. Сейчас: {0}",TX(option.name)));}
}

function cycleFont(){
  const list=availableFontOptions();
  const idx=list.findIndex(x=>x.id===currentFontId);
  const next=list[(idx+1+list.length)%list.length];
  applyFontFamily(next.id);
  const bubble=$("fontBubble");
  bubble.textContent=TX(next.name);
  bubble.classList.add("show");
  clearTimeout(cycleFont.timer);
  cycleFont.timer=setTimeout(()=>bubble.classList.remove("show"),850);
}

function openDryReport(kind){
  const labels={all:"Весь список",done:"Выполненные",todo:"Невыполненные",task:"Задания"};
  const text=kind==="all"?buildGroupedTextReport("all"):buildGroupedTextReport(kind);
  $("dryListOverlay").classList.remove("show");
  $("fullReportTitle").textContent=TX("Сухой список · {0}",TX(labels[kind]||""));
  $("fullReportText").textContent=text;
  $("fullReportOverlay").classList.add("show");
}

function closeDryReport(){
  const active=document.activeElement;
  if(active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) active.blur();
  $("fullReportOverlay").classList.remove("show");
}

function askConfirm(message,title=TX("Подтверждение"),okText=TX("Удалить")){
  $("confirmTitle").textContent=title;
  $("confirmMessage").innerHTML=escapeHtml(message).replace(/\n/g,"<br>");
  $("confirmOk").textContent=okText;
  $("confirmOverlay").classList.add("show");
  return new Promise(resolve=>{confirmResolver=resolve;});
}

function finishConfirm(result){$("confirmOverlay").classList.remove("show");const r=confirmResolver;confirmResolver=null;if(r)r(result);}

function applyTheme(theme){
  const selected=THEME_ORDER.includes(theme)?theme:"light";
  // v102: при смене темы переходы цвета выключаются на два кадра. Иначе браузер заводил
  // отдельную анимацию цвета на каждую карточку и кнопку — на длинном списке смена темы
  // занимала до секунды.
  const root=document.documentElement;
  if(root.dataset.theme&&root.dataset.theme!==selected){
    root.classList.add("theme-switching");
    clearTimeout(applyTheme.timer);
    applyTheme.timer=setTimeout(()=>requestAnimationFrame(()=>root.classList.remove("theme-switching")),60);
  }
  document.documentElement.dataset.theme=selected;
  safeSetStorage(THEME_KEY,selected);
  syncSystemBars();
  const icon=$("themeIcon");
  if(icon)icon.textContent=THEME_ICON[selected];
  const btn=$("themeBtn");
  if(btn){btn.title=TX("Тема: {0}. Нажми для смены",selected);btn.setAttribute("aria-label",TX("Сменить тему. Сейчас: {0}",selected));}
}

// v102: строка состояния (iPhone — theme-color, APK — системная строка) красится ровно
// в цвет верха страницы, а при открытом окне — в тот же затемнённый цвет, что и страница
// под окном. Раньше полоса над шапкой оставалась светлой/яркой, когда всё под ней
// затемнялось, и выглядела пустой незаполненной полосой.
let systemBarColor="";
function parseCssColor(value){
  const m=String(value||"").match(/rgba?\(([^)]+)\)/);
  if(!m)return null;
  const p=m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
  return {r:p[0]||0,g:p[1]||0,b:p[2]||0,a:p.length>3&&Number.isFinite(p[3])?p[3]:1};
}
function syncSystemBars(){
  const root=document.documentElement;
  // Пока идёт заставка, строка состояния — в цвет заставки (index.html).
  if(root.classList.contains("tl-splash")&&!root.classList.contains("tl-splash-out"))return;
  const base=parseCssColor(getComputedStyle(document.body).backgroundColor)||{r:236,g:239,b:242,a:1};
  let c={r:base.r,g:base.g,b:base.b};
  document.querySelectorAll(".overlay.show").forEach(el=>{
    const o=parseCssColor(getComputedStyle(el).backgroundColor);
    if(!o||o.a<=0)return;
    c={r:o.r*o.a+c.r*(1-o.a),g:o.g*o.a+c.g*(1-o.a),b:o.b*o.a+c.b*(1-o.a)};
  });
  const hex="#"+[c.r,c.g,c.b].map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0")).join("");
  if(hex===systemBarColor)return;
  systemBarColor=hex;
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.content=hex;
  // APK: цвет системной строки и тёмные/светлые значки на ней.
  const light=(0.2126*c.r+0.7152*c.g+0.0722*c.b)/255>0.6;
  try{window.AndroidApp?.setThemeColor?.(hex,light);}catch(_){}
}

function cycleTheme(){
  const current=safeGetStorage(THEME_KEY,"light")||"light";
  const next=THEME_ORDER[(THEME_ORDER.indexOf(current)+1)%THEME_ORDER.length];
  applyTheme(next);
}

function refreshAfterViewportChange(){
  clearTimeout(viewportRefreshTimer);
  viewportRefreshTimer=setTimeout(()=>{
    const vv=window.visualViewport;
    const height=Math.round(vv?.height||window.innerHeight||0);
    document.documentElement.style.setProperty("--viewport-h", `${height}px`);
    document.documentElement.style.setProperty("--modal-vh", `${Math.max(240,height)}px`);
    const active=document.activeElement;
    const width=Math.round(window.innerWidth||0);
    const widthChanged=Math.abs(width-lastViewportWidth)>2;
    lastViewportWidth=width;
    if(active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && active.closest(".sheet")){
      scrollModalFieldIntoView(active);
    }else if(active && active.matches?.(".taskBox textarea")){
      // v81: клавиатура открылась/закрылась над полем задания — список НЕ перестраиваем
      // (раньше это закрывало поле и дёргало экран), только показываем поле.
      scheduleTaskEditorReveal(active);
    }else if(widthChanged){
      // Поворот/изменение ширины: обновляем только размеры открытых полей.
      refreshOpenTaskFields();
    }
  },60);
}

function isStandaloneApp(){
  return window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
}

function hideInstallButton(){
  deferredInstallPrompt=null;
  if(installAppBtn) installAppBtn.hidden=true;
}

function showInstallFallback(){
  const ua=navigator.userAgent||"";
  const isiOS=/iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
  if(isiOS){
    showToast(TX("Установка на iPhone: нажми «Поделиться» → «На экран „Домой“»"));
  }else{
    showToast(TX("Установка через кнопку сейчас недоступна. Открой меню браузера и выбери «Установить приложение»."));
  }
}

async function fileToJpeg(file,maxSide=1800,quality=.76,maxBytes=900*1024){
  return new Promise((resolve,reject)=>{
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=async()=>{
      try{
        let side=maxSide, q=quality, blob=null;
        // Android camera photos can be very large. OCR.space free API has a 1 MB file limit,
        // so compress adaptively before sending instead of uploading the original.
        for(let attempt=0;attempt<6;attempt++){
          const scale=Math.min(1,side/Math.max(img.naturalWidth,img.naturalHeight));
          const c=document.createElement('canvas');
          c.width=Math.max(1,Math.round(img.naturalWidth*scale));
          c.height=Math.max(1,Math.round(img.naturalHeight*scale));
          const ctx=c.getContext('2d',{alpha:false});
          ctx.drawImage(img,0,0,c.width,c.height);
          blob=await new Promise(r=>c.toBlob(r,'image/jpeg',q));
          if(blob && blob.size<=maxBytes) break;
          side=Math.round(side*.82); q=Math.max(.58,q-.05);
        }
        URL.revokeObjectURL(url);
        if(!blob) return reject(new Error(TX('Не удалось подготовить изображение')));
        if(blob.size>maxBytes && maxBytes<=900*1024) return reject(new Error(TX('Фото слишком большое для OCR. Попробуй снять ближе или использовать «Загрузка фото».')));
        resolve(blob);
      }catch(e){URL.revokeObjectURL(url);reject(e)}
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error(TX('Не удалось открыть изображение')))};
    img.src=url;
  });
}

function fetchWithTimeout(url,options={},timeoutMs=35000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  return fetch(url,{...options,signal:controller.signal})
    .finally(()=>clearTimeout(timer))
    .catch(e=>{
      if(e && e.name==='AbortError') throw new Error(TX('Сервис распознавания не ответил вовремя. Попробуй ещё раз или используй резервный OCR.'));
      throw e;
    });
}

async function runOCR(file){
  const runToken=++ocrRunToken;
  $("ocrProgressWrap").style.display="block";
  setProgress(5);
  try{
    $("ocrStatus").textContent=TX("Подготавливаю фото…");
    ocrCandidateMeta=new Map();
    const image=await fileToJpeg(file,1800,.76,900*1024);
    if(runToken!==ocrRunToken)return;
    const key=safeGetStorage('kipOcrSpaceKey','helloworld')||'helloworld';
    const localPage=location.protocol==='file:' || location.origin==='null' || /android\.fileexplorer\.myprovider/i.test(location.origin);
    if(localPage){
      $("ocrStatus").textContent=TX("Для распознавания открой приложение через HTTPS (например GitHub Pages).");
      setProgress(0);
      return;
    }
    let lastError=null;
    for(const engine of ['3','2']){
      try{
        $("ocrStatus").textContent=engine==='3' ? "OCR.space Engine 3…" : TX("Engine 3 не сработал — пробую Engine 2…");
        setProgress(engine==='2'?25:55);
        const fd=new FormData();
        fd.append('file',image,'kip-photo.jpg');
        fd.append('apikey',key);
        fd.append('language','auto');
        fd.append('OCREngine',engine);
        fd.append('isTable','true');
        fd.append('detectOrientation','true');
        fd.append('scale','true');
        fd.append('isOverlayRequired','false');
        const r=await fetchWithTimeout('https://api.ocr.space/parse/image',{method:'POST',body:fd},engine==='2'?20000:30000);
        if(!r.ok)throw new Error(`OCR.space HTTP ${r.status}`);
        setProgress(engine==='3'?82:70);
        const out=await r.json();
        if(out.IsErroredOnProcessing)throw new Error(out.ErrorMessage||out.ErrorDetails||'OCR.space error');
        const text=(out.ParsedResults||[]).map(x=>x.ParsedText||'').join('\n');
        lastOcrText=text;
        const records=extractTagRecordsFromText(text);
        ocrCandidates=records.length?records.map(x=>x.tag):extractTagsSmart(text);
        ocrCandidateMeta=new Map(records.map(x=>[tagKey(x.tag),{completed:!!x.done,task:x.task||"",score:0.65}]));
        if(runToken!==ocrRunToken)return;
        setProgress(100);
        $("ocrStatus").textContent=TX("OCR.space Engine {0}: найдено кандидатов {1}. Проверь отметки и задания перед добавлением.",engine,ocrCandidates.length);
        renderImportCandidates();
        return;
      }catch(e){
        lastError=e;
        if(engine==='2')continue;
      }
    }
    throw lastError||new Error(TX('OCR.space не ответил'));
  }catch(e){
    if(runToken!==ocrRunToken)return;
    console.error(e);
    setProgress(0);
    $("ocrStatus").textContent=TX("Ошибка распознавания: {0}. Проверь интернет и VPN — нужен доступ к OCR.space.",TX.msg(e.message||e));
  }
}

// ---------------------------------------------------------------- v101: фото — превью, обрезка, локальное распознавание
// По умолчанию фото распознаётся на телефоне (js/ocr-local.js, без интернета).
// Тумблер «OCR.space» в окне фото включает прежнее онлайн-распознавание (Engine 3 → 2, нужны сеть и VPN).
const OCR_ENGINE_KEY="kipOcrEngine";
function ocrEngine(){return safeGetStorage(OCR_ENGINE_KEY,"local")==="online"?"online":"local";}
let ocrPhoto=null; // {name, source: ImageBitmap, crop: {x,y,w,h}|null}
let ocrCropMode=false,ocrCropEdit=null,ocrCropGesture=null;const ocrCropPtrs=new Map();

let localOcrPromise=null;
function loadLocalOcr(){
  if(window.LocalOCR)return Promise.resolve();
  if(localOcrPromise)return localOcrPromise;
  localOcrPromise=new Promise((resolve,reject)=>{
    const s=document.createElement("script");s.async=true;s.src=new URL("./js/ocr-local.js",document.baseURI).href;
    s.onload=()=>resolve();s.onerror=()=>{s.remove();reject(new Error(TX("Не найден модуль распознавания js/ocr-local.js")));};
    document.head.appendChild(s);
  }).catch(err=>{localOcrPromise=null;throw err;});
  return localOcrPromise;
}

function resetOcrPhoto(){
  setReviewing(false);
  ocrPhoto=null;ocrCropMode=false;ocrCropEdit=null;ocrCropGesture=null;ocrCropPtrs.clear();lastOcrText="";
  ++ocrRunToken;updateOcrPhotoUi();
}
async function showOcrPhoto(file){
  try{
    let bmp;try{bmp=await createImageBitmap(file,{imageOrientation:"from-image"});}catch(_){bmp=await createImageBitmap(file);}
    ++ocrRunToken;
    ocrPhoto={name:file.name||TX("Фото"),source:bmp,crop:null};ocrCropMode=false;ocrCropEdit=null;ocrCropPtrs.clear();ocrCropGesture=null;
    ocrCandidates=[];ocrCandidateMeta=new Map();setReviewing(false);lastOcrText="";
    $("importList").innerHTML="";$("importActions").style.display="none";$("photoImportLegend").classList.remove("ready");
    $("ocrProgressWrap").style.display="none";setProgress(0);
    $("ocrStatus").textContent=TX("При необходимости выделите участок, затем нажмите «Распознать».");
    updateOcrPhotoUi();drawOcrPhoto();
    // Пока человек смотрит на фото, движок уже загружается.
    if(ocrEngine()==="local")loadLocalOcr().then(()=>window.LocalOCR.warmUp()).catch(()=>{});
  }catch(e){$("ocrStatus").textContent=TX("Не удалось открыть фото: {0}",TX.msg(e.message||e));}
}
function ocrFullRect(){return{x:0,y:0,w:ocrPhoto.source.width,h:ocrPhoto.source.height};}
function ocrRegion(){return ocrPhoto.crop||ocrFullRect();}
function updateOcrPhotoUi(){
  const has=!!ocrPhoto,canvas=$("ocrCanvas"),box=$("ocrPreview");
  canvas.hidden=!has;$("ocrPickBtn").hidden=has;
  $("ocrCropBtn").hidden=!has||ocrCropMode;
  $("ocrRunRow").hidden=ocrCropMode;$("ocrCropBar").hidden=!ocrCropMode;
  $("ocrRunBtn").disabled=!has;
  box.classList.toggle("cropping",ocrCropMode);
  box.classList.toggle("compact",!ocrCropMode&&!!$("importList").children.length);
  const hint=$("ocrCropHint");
  if(ocrCropMode){hint.hidden=false;hint.textContent=TX("Тяните углы и стороны, двигайте рамку, раздвигайте двумя пальцами.");}
  else if(has&&ocrPhoto.crop){hint.hidden=false;hint.textContent=TX("Распознаётся выделенный участок.");}
  else hint.hidden=true;
}
function drawOcrPhoto(){
  if(!ocrPhoto)return;
  const src=ocrPhoto.source,c=$("ocrCanvas"),s=Math.min(1,1400/Math.max(src.width,src.height));
  const W=Math.round(src.width*s),H=Math.round(src.height*s);
  if(c.width!==W||c.height!==H){c.width=W;c.height=H;}
  const g=c.getContext("2d");g.drawImage(src,0,0,W,H);
  const r=ocrCropMode?ocrCropEdit:ocrPhoto.crop;if(!r)return;
  const k=c.width/Math.max(1,c.getBoundingClientRect().width||c.width);
  const x=r.x*s,y=r.y*s,w=r.w*s,h=r.h*s;
  g.save();g.fillStyle=ocrCropMode?"rgba(10,14,22,.62)":"rgba(10,14,22,.5)";g.beginPath();g.rect(0,0,W,H);g.rect(x,y,w,h);g.fill("evenodd");
  if(!ocrCropMode){g.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()||"#1d5fc4";g.lineWidth=Math.max(2,2*k);g.strokeRect(x,y,w,h);g.restore();return;}
  g.shadowColor="rgba(0,0,0,.6)";g.shadowBlur=3*k;
  g.strokeStyle="rgba(255,255,255,.55)";g.lineWidth=1*k;g.setLineDash([5*k,4*k]);
  for(let i=1;i<3;i++){g.beginPath();g.moveTo(x+w*i/3,y);g.lineTo(x+w*i/3,y+h);g.moveTo(x,y+h*i/3);g.lineTo(x+w,y+h*i/3);g.stroke();}
  g.setLineDash([]);g.strokeStyle="#fff";g.lineWidth=1.5*k;g.strokeRect(x,y,w,h);
  const L=Math.min(24*k,w/2.5,h/2.5),T=4*k,M=Math.min(14*k,w/4,h/4);g.lineWidth=T;g.lineCap="square";g.beginPath();
  for(const [cx,cy,sx,sy] of [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]]){g.moveTo(cx+sx*L,cy+sy*T/2);g.lineTo(cx+sx*T/2,cy+sy*T/2);g.lineTo(cx+sx*T/2,cy+sy*L);}
  g.moveTo(x+w/2-M,y+T/2);g.lineTo(x+w/2+M,y+T/2);g.moveTo(x+w/2-M,y+h-T/2);g.lineTo(x+w/2+M,y+h-T/2);
  g.moveTo(x+T/2,y+h/2-M);g.lineTo(x+T/2,y+h/2+M);g.moveTo(x+w-T/2,y+h/2-M);g.lineTo(x+w-T/2,y+h/2+M);
  g.stroke();g.restore();
}
// Обрезка как в галерее телефона: рамка сразу по всему фото, углы и стороны тянутся,
// рамка двигается пальцем, двумя пальцами раздвигается; каждое касание продолжает с текущей рамки.
function startOcrCrop(){if(!ocrPhoto)return;if(reviewSnap==="half"&&overlay.classList.contains("reviewing")){reviewSnap="full";applyReviewSnap();}ocrCropEdit=ocrPhoto.crop?{...ocrPhoto.crop}:ocrFullRect();ocrCropMode=true;ocrCropPtrs.clear();ocrCropGesture=null;updateOcrPhotoUi();requestAnimationFrame(drawOcrPhoto);}
function applyOcrCrop(){
  if(!ocrCropMode)return;const src=ocrPhoto.source,r=ocrCropEdit;
  const full=r.x<=1&&r.y<=1&&r.w>=src.width-2&&r.h>=src.height-2;
  ocrPhoto.crop=full?null:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.w),h:Math.round(r.h)};
  ocrCropMode=false;ocrCropEdit=null;ocrCropPtrs.clear();ocrCropGesture=null;updateOcrPhotoUi();drawOcrPhoto();
}
function cancelOcrCrop(){ocrCropMode=false;ocrCropEdit=null;ocrCropPtrs.clear();ocrCropGesture=null;updateOcrPhotoUi();drawOcrPhoto();}
function ocrCssPerSrc(){return Math.max(1e-6,$("ocrCanvas").getBoundingClientRect().width/ocrPhoto.source.width);}
function ocrToSrc(e){const b=$("ocrCanvas").getBoundingClientRect(),src=ocrPhoto.source;return{x:(e.clientX-b.left)/b.width*src.width,y:(e.clientY-b.top)/b.height*src.height};}
const clampN=(v,a,b)=>Math.max(a,Math.min(b,v));
function ocrCropHit(p){
  // Снаружи рамки зона захвата 26 px, внутри — не больше четверти стороны: в узкой рамке середина остаётся для сдвига.
  const k=ocrCssPerSrc(),r=ocrCropEdit,out=26/k,inX=Math.min(26,r.w*k/4)/k,inY=Math.min(26,r.h*k/4)/k;
  const L=r.x,R=r.x+r.w,T=r.y,B=r.y+r.h,spanX=p.x>=L-out&&p.x<=R+out,spanY=p.y>=T-out&&p.y<=B+out;
  const nT=spanX&&p.y>=T-out&&p.y<=T+inY,nB=spanX&&p.y<=B+out&&p.y>=B-inY,nL=spanY&&p.x>=L-out&&p.x<=L+inX,nR=spanY&&p.x<=R+out&&p.x>=R-inX;
  const h=nT&&(!nB||Math.abs(p.y-T)<=Math.abs(p.y-B))?"n":nB?"s":"",v=nL&&(!nR||Math.abs(p.x-L)<=Math.abs(p.x-R))?"w":nR?"e":"";
  if(h||v)return h+v;
  return p.x>L&&p.x<R&&p.y>T&&p.y<B?"move":null;
}
function ocrCropMin(){return Math.max(12,30/ocrCssPerSrc());}
function ocrCropSingle(p){
  const g=ocrCropGesture,r0=g.r0,src=ocrPhoto.source,dx=p.x-g.start.x,dy=p.y-g.start.y,mn=ocrCropMin();
  if(g.type==="move"){ocrCropEdit={...r0,x:clampN(r0.x+dx,0,src.width-r0.w),y:clampN(r0.y+dy,0,src.height-r0.h)};return;}
  let L=r0.x,R=r0.x+r0.w,T=r0.y,B=r0.y+r0.h;
  if(g.type.includes("w"))L=clampN(L+dx,0,R-mn);
  if(g.type.includes("e"))R=clampN(R+dx,L+mn,src.width);
  if(g.type.includes("n"))T=clampN(T+dy,0,B-mn);
  if(g.type.includes("s"))B=clampN(B+dy,T+mn,src.height);
  ocrCropEdit={x:L,y:T,w:R-L,h:B-T};
}
function ocrCropPinch(){
  const g=ocrCropGesture,[a,b]=[...ocrCropPtrs.values()],src=ocrPhoto.source,mn=ocrCropMin(),floor=60/ocrCssPerSrc();
  const sx=Math.max(Math.abs(a.x-b.x),floor)/Math.max(Math.abs(g.a0.x-g.b0.x),floor),sy=Math.max(Math.abs(a.y-b.y),floor)/Math.max(Math.abs(g.a0.y-g.b0.y),floor);
  const w=clampN(g.r0.w*sx,mn,src.width),h=clampN(g.r0.h*sy,mn,src.height);
  const cx=g.r0.x+g.r0.w/2+((a.x+b.x)-(g.a0.x+g.b0.x))/2,cy=g.r0.y+g.r0.h/2+((a.y+b.y)-(g.a0.y+g.b0.y))/2;
  ocrCropEdit={x:clampN(cx-w/2,0,src.width-w),y:clampN(cy-h/2,0,src.height-h),w,h};
}
function wireOcrCrop(){
  const box=$("ocrPreview");
  box.addEventListener("pointerdown",e=>{
    if(!ocrCropMode||!ocrPhoto)return;e.preventDefault();
    try{box.setPointerCapture(e.pointerId);}catch(_){}
    ocrCropPtrs.set(e.pointerId,ocrToSrc(e));
    if(ocrCropPtrs.size===2){const [a0,b0]=[...ocrCropPtrs.values()];ocrCropGesture={type:"pinch",r0:{...ocrCropEdit},a0,b0};}
    else if(ocrCropPtrs.size===1){const p=ocrToSrc(e),t=ocrCropHit(p);ocrCropGesture=t?{type:t,start:p,r0:{...ocrCropEdit}}:null;}
  });
  box.addEventListener("pointermove",e=>{
    if(!ocrCropMode||!ocrCropPtrs.has(e.pointerId))return;e.preventDefault();
    ocrCropPtrs.set(e.pointerId,ocrToSrc(e));
    if(!ocrCropGesture)return;
    if(ocrCropGesture.type==="pinch"){if(ocrCropPtrs.size>=2)ocrCropPinch();}else ocrCropSingle(ocrCropPtrs.get(e.pointerId));
    drawOcrPhoto();
  });
  const end=e=>{
    if(!ocrCropPtrs.has(e.pointerId))return;ocrCropPtrs.delete(e.pointerId);
    // После щипка оставшийся палец ничего не двигает, пока его не поднимут.
    if(ocrCropGesture&&ocrCropGesture.type==="pinch"&&ocrCropPtrs.size===1)ocrCropGesture=null;
    if(!ocrCropPtrs.size)ocrCropGesture=null;
  };
  box.addEventListener("pointerup",end);box.addEventListener("pointercancel",end);
  window.addEventListener("resize",()=>{if(ocrCropMode)drawOcrPhoto();},{passive:true});
}

function runSelectedOcr(){
  if(!ocrPhoto)return;
  if(ocrCropMode)applyOcrCrop();
  if(ocrEngine()==="local"){runLocalOcr();return;}
  if(ocrNetworkKnownUp()){runOnlineOcr();return;}
  pendingOcrPick=runOnlineOcr;
  $("netOverlay").classList.add("show");
  probeOcrNetwork(true);
}
function ocrRegionCanvas(maxSide=3200){
  const r=ocrRegion(),s=Math.min(1,maxSide/Math.max(r.w,r.h));
  const c=document.createElement("canvas");c.width=Math.max(1,Math.round(r.w*s));c.height=Math.max(1,Math.round(r.h*s));
  c.getContext("2d").drawImage(ocrPhoto.source,r.x,r.y,r.w,r.h,0,0,c.width,c.height);
  return c;
}
async function runOnlineOcr(){
  if(!ocrPhoto)return;
  const blob=await new Promise(res=>ocrRegionCanvas().toBlob(res,"image/jpeg",.92));
  if(!blob){$("ocrStatus").textContent=TX("Не удалось подготовить фото");return;}
  await runOCR(blob);
  updateOcrPhotoUi();
}
async function runLocalOcr(){
  const runToken=++ocrRunToken,btn=$("ocrRunBtn");btn.disabled=true;
  $("ocrProgressWrap").style.display="block";setProgress(3);
  $("importList").innerHTML="";$("importActions").style.display="none";$("photoImportLegend").classList.remove("ready");
  const status=t=>{if(runToken===ocrRunToken)$("ocrStatus").textContent=TX.msg(t);};
  status(TX("Запускаю распознавание…"));
  try{
    await loadLocalOcr();
    const res=await window.LocalOCR.recognize(ocrPhoto.source,ocrRegion(),{stage:status,progress:v=>{if(runToken===ocrRunToken)setProgress(6+92*v);}});
    if(runToken!==ocrRunToken)return;
    lastOcrText=res.text;
    const records=extractTagRecordsFromText(res.text);
    ocrCandidates=records.length?records.map(x=>x.tag):extractTagsSmart(res.text);
    ocrCandidateMeta=new Map(records.map(x=>[tagKey(x.tag),{completed:!!x.done,task:x.task||"",score:0.65}]));
    setProgress(100);
    status(TX("На телефоне: найдено кандидатов {0} за {1} с. Проверь отметки и задания перед добавлением.",ocrCandidates.length,(res.ms/1000).toFixed(1).replace(".",window.I18N?.dec||",")));
    renderImportCandidates();
  }catch(e){
    if(runToken!==ocrRunToken)return;
    console.error(e);setProgress(0);
    status(TX("Не удалось распознать на телефоне: {0}. Если есть интернет и VPN, включите тумблер OCR.space.",TX.msg(e.message||e)));
  }finally{
    if(runToken===ocrRunToken){btn.disabled=!ocrPhoto;updateOcrPhotoUi();}
  }
}

// v101: окно просмотра найденных тегов тянется за ручку (или заголовок) — на весь экран или на половину.
// Отпускание ближе к одному из положений или быстрый жест вверх/вниз выбирает положение; касание ручки — переключает.
const REVIEW_KEY="kipReviewSheet";
let reviewSnap=safeGetStorage(REVIEW_KEY,"full")==="half"?"half":"full";
function setReviewing(on){overlay.classList.toggle("reviewing",!!on);applyReviewSnap();}
function applyReviewSnap(){
  overlay.classList.toggle("sheetHalf",overlay.classList.contains("reviewing")&&reviewSnap==="half");
  $("sheetGrip")?.setAttribute("aria-label",reviewSnap==="half"?TX("Развернуть на весь экран"):TX("Свернуть до половины экрана"));
}
function wireSheetGrip(){
  const sheet=overlay.querySelector(".sheet"),grip=$("sheetGrip"),title=$("modalTitle");
  let drag=null;
  const fullH=()=>window.innerHeight-8,minH=()=>window.innerHeight*.3;
  const start=e=>{
    if(!overlay.classList.contains("reviewing")||ocrCropMode||(e.pointerType==="mouse"&&e.button!==0))return;
    const now=performance.now();
    drag={id:e.pointerId,el:e.currentTarget,y0:e.clientY,h0:sheet.getBoundingClientRect().height,moved:false,lastY:e.clientY,lastT:now,v:0};
    try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_){}
  };
  const move=e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const dy=e.clientY-drag.y0;
    if(!drag.moved&&Math.abs(dy)<6)return;
    if(!drag.moved){drag.moved=true;sheet.classList.add("dragging");}
    e.preventDefault();
    sheet.style.height=Math.max(minH(),Math.min(fullH(),drag.h0-dy))+"px";
    const now=performance.now();drag.v=(e.clientY-drag.lastY)/Math.max(1,now-drag.lastT);drag.lastY=e.clientY;drag.lastT=now;
  };
  const end=e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const d=drag;drag=null;
    if(!d.moved){if(d.el===grip)reviewSnap=reviewSnap==="half"?"full":"half";}
    else{
      const h=sheet.getBoundingClientRect().height,mid=(window.innerHeight*.56+fullH())/2;
      reviewSnap=d.v>.5?"half":d.v<-.5?"full":(h>=mid?"full":"half");
    }
    sheet.classList.remove("dragging");sheet.style.height="";
    safeSetStorage(REVIEW_KEY,reviewSnap);applyReviewSnap();
  };
  for(const el of [grip,title]){
    el.addEventListener("pointerdown",start);el.addEventListener("pointermove",move);
    el.addEventListener("pointerup",end);el.addEventListener("pointercancel",end);
  }
}
function renderImportCandidates(){
  const box=$('importList'),actions=$('importActions');
  setReviewing(ocrCandidates.length>0);
  box.innerHTML='';
  $("photoImportLegend").classList.remove("ready");
  if(!ocrCandidates.length){
    box.innerHTML=lastOcrText&&TagFormat.scanNow(lastOcrText).skipped.length?emptyFormatHtml(lastOcrText):'<div class="mini">'+TX('Подходящих КИП-тегов не найдено. Попробуй сфотографировать ближе, ровнее или выдели участок со списком.')+'</div>';
    addFormatNote($("ocrStatus"));
    actions.style.display='none'; return;
  }
  const existing=new Set(data.map(x=>tagKey(x.tag)));
  $("photoImportLegend").classList.add("ready");
  ocrCandidates.forEach(candidate=>{
    const tag=String(candidate||'').toUpperCase(),already=existing.has(tagKey(tag));
    const meta=ocrCandidateMeta.get(tagKey(tag))||{completed:false,task:''};
    const row=document.createElement('div'); row.className='importItem'; row.dataset.candidateTag=tag;
    const line=document.createElement('div'); line.className='importRow';

    const pick=document.createElement('input');
    pick.type='checkbox'; pick.className='importPick'; pick.checked=!already; pick.disabled=already;
    pick.setAttribute('aria-label',TX('Добавить {0}',tag)); pick.title=TX('Добавить');

    const inp=document.createElement('input');
    inp.type='text'; inp.value=tag; inp.className='importTag'; inp.setAttribute('aria-label',TX('Тег {0}',tag));

    const done=document.createElement('input');
    done.type='checkbox'; done.className='importDone'; done.checked=!!meta.completed;
    if(meta.evidence) done.title=TX('Выполнено: {0}',meta.evidence);
    done.setAttribute('aria-label',TX('Выполнено: {0}',tag)); done.title=TX('Выполнено');

    const taskToggle=document.createElement('button');
    taskToggle.type='button'; taskToggle.className='importTaskInline'+(meta.task?' hasTask':'');
    taskToggle.textContent='▾'; taskToggle.title=meta.task?TX('Задание: есть запись'):TX('Задание');
    taskToggle.setAttribute('aria-expanded',meta.task?'true':'false');
    taskToggle.setAttribute('aria-label',TX('Задание для {0}',tag));

    const taskWrap=document.createElement('div'); taskWrap.className='importTaskWrap'+(meta.task?' open':'');
    const task=document.createElement('textarea');
    task.className='importTask'; task.rows=1; task.placeholder=TX('Опишите задание'); task.value=meta.task||'';
    task.setAttribute('aria-label',TX('Задание для {0}',tag)); taskWrap.appendChild(task);

    taskToggle.addEventListener('click',()=>{
      const open=taskWrap.classList.toggle('open');
      taskToggle.setAttribute('aria-expanded',String(open));
      taskToggle.classList.toggle('hasTask',!!task.value.trim());
      taskToggle.title=task.value.trim()?TX('Задание: есть запись'):TX('Задание');
      if(open)setTimeout(()=>{task.scrollTop=0;autosizeTaskTextarea(task,104);task.focus();requestAnimationFrame(()=>task.scrollTop=0);},20);
    });
    task.addEventListener('input',()=>{
      const has=!!task.value.trim();
      taskToggle.classList.toggle('hasTask',has);
      taskToggle.title=has?TX('Задание: есть запись'):TX('Задание');
    });
    line.append(pick,inp,taskToggle,done);
    row.append(line,taskWrap); box.appendChild(row); wireImportRow(box,row);
  });
  refreshImportRows(box);
  importUnitHeaders(box,ocrCandidates.map(c=>String(c||"")));
  addFormatNote($("ocrStatus"));
  actions.style.display='flex';
}

function importCandidates(){
  const rows=[...$("importList").querySelectorAll(".importItem")];
  const selected=[];const invalid=[];
  rows.forEach((row,index)=>{
    const cb=row.querySelector('.importPick');if(!cb?.checked)return;
    const inp=row.querySelector('.importTag');const done=row.querySelector('.importDone');const task=row.querySelector('.importTask');
    const r=TagFormat.anyValid(inp.value);
    if(!r||!r.ok){invalid.push(index+1);return;}
    selected.push({unit:r.unit||"",tag:r.tag,done:!!done?.checked,task:String(task?.value||"").trim()});
  });
  if(invalid.length){showToast(TX("Исправь тег(и) №{0} перед добавлением",invalid.join(", ")));return;}
  if(!selected.length){showToast(TX("Ничего не выбрано для добавления"));return;}
  const existing=new Set(data.map(x=>tagKey(x.tag)));const batch=new Set();const duplicates=[];
  for(const item of selected){const key=tagKey(item.tag);if(existing.has(key)||batch.has(key))duplicates.push(item.tag);else batch.add(key);}
  if(duplicates.length){
    const unique=[...new Set(duplicates)];
    showToast(TX("Дубликаты не добавлены: {0}. Измени тег или сними отметку.",unique.join(", ")));
    rows.forEach(row=>{const inp=row.querySelector('.importTag');if(inp&&unique.includes(inp.value.trim().toUpperCase()))inp.style.borderColor="#d9534f";});
    return;
  }
  const max=data.reduce((m,x)=>Math.max(m,Number(x.id)||0),0);
  const additions=selected.map((x,i)=>({id:max+i+1,unit:x.unit,tag:x.tag,done:x.done,task:x.task||""}));
  const before=data.length;
  data=data.concat(additions);
  try{save();if(data.length!==before+additions.length)throw new Error(TX("Проверка количества после сохранения не прошла"));}
  catch(error){console.error(error);data=data.slice(0,before);save();showToast(TX("Не удалось сохранить добавленные теги. Повтори ещё раз."));return;}
  closeModal();render();showToast(TX("Добавлено распознанных: {0}",additions.length));
}

const INITIAL_DATA = [];
const INITIAL_PAGES = null;
const DATA_KEY = "kip-checklist-v56";
const FONT_KEY = "kip-checklist-font-v1";
const FONT_FAMILY_KEY = "kip-checklist-font-family-v1";
const DOC_TITLE_KEY = "kip-checklist-title-v1";
const PAGES_KEY = "kip-checklist-pages-v56";
const ACTIVE_PAGE_KEY = "kip-checklist-active-page-v56";
const THEME_KEY = "kip-checklist-theme-v56";
const DEFAULT_TITLE = "Tag list";

const sharedState=readSharedStateFromUrl();
if(sharedState){
  if(sharedState.title) safeSetStorage(DOC_TITLE_KEY,String(sharedState.title));
  if(Array.isArray(sharedState.pages)) safeSetStorage(PAGES_KEY,JSON.stringify(sharedState.pages));
  if(sharedState.activePageId) safeSetStorage(ACTIVE_PAGE_KEY,String(sharedState.activePageId));
  if(sharedState.theme) safeSetStorage(THEME_KEY,String(sharedState.theme));
  if(Array.isArray(sharedState.pages)){
    const active=sharedState.pages.find(page=>page.id===sharedState.activePageId)||sharedState.pages[0];
    if(active) safeSetStorage(DATA_KEY,JSON.stringify(active.data||[]));
  }
}

// Не даём браузеру превращать вертикальное вытягивание страницы в pull-to-refresh,
// если движок поддерживает overscroll-behavior. Обычный вертикальный скролл при этом сохраняется.
try{document.documentElement.style.overscrollBehaviorY="none";document.body.style.overscrollBehaviorY="none";}catch(_){}

let docTitle = loadDocumentTitle();
let pages = loadPages();
let activePageId = loadActivePageId();
let data = getActivePage().data;
let filter = ["all","task","done","todo"].includes(sharedState?.filter) || (typeof sharedState?.filter==="string" && /^\d{1,8}$/.test(sharedState.filter)) ? sharedState.filter : "all";
let query = typeof sharedState?.query==="string" ? sharedState.query : "";
let pageManageMode = false;
let selectedPageIds = new Set();
let pageLongPressTimer = null;
let pageLongPressTriggered = false;
let editId = null;
let selectionMode = false;
let selectedTagIds = new Set();
let longPressTimer = null;
let longPressTriggered = false;
let pendingDuplicate = null;
let saveTimer = null;

const $ = id => document.getElementById(id);

// v68 UX: блокируем прокрутку основного списка при открытом модальном окне,
// сохраняя текущую позицию страницы. Сам .sheet остаётся прокручиваемым.
let modalScrollY = 0;
let modalLocked = false;
function updateModalScrollLock(){
  syncSystemBars();
  const open = !!document.querySelector(".overlay.show");
  if(open && !modalLocked){
    modalScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.dataset.modalScrollY = String(modalScrollY);
    document.body.style.position = "fixed";
    document.body.style.top = `-${modalScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.classList.add("modal-open");
    modalLocked = true;
  }else if(!open && modalLocked){
    document.body.classList.remove("modal-open");
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    const y = Number(document.body.dataset.modalScrollY || modalScrollY || 0);
    delete document.body.dataset.modalScrollY;
    modalLocked = false;
    requestAnimationFrame(()=>window.scrollTo(0,y));
  }
}

const modalObserver = new MutationObserver(updateModalScrollLock);
const tabs = $("tabs"), list = $("list");
const overlay = $("overlay"), tagInput = $("tagInput");
const statusInput = $("statusInput"), manualTaskInput = $("manualTaskInput"), modalTitle = $("modalTitle"), deleteBtn = $("deleteBtn");

document.querySelectorAll(".overlay").forEach(el=>modalObserver.observe(el,{attributes:true,attributeFilter:["class"]}));

function scrollModalFieldIntoView(target){
  const sheet=target?.closest?.(".sheet");
  if(!sheet)return;
  const vv=window.visualViewport;
  const visibleTop=(vv?.offsetTop||0)+12;
  const visibleBottom=(vv?.offsetTop||0)+(vv?.height||window.innerHeight)-12;
  const rect=target.getBoundingClientRect();
  if(rect.top<visibleTop || rect.bottom>visibleBottom){
    try{target.scrollIntoView({block:"center",inline:"nearest",behavior:"smooth"});}catch(_){}
  }
  const manualForm=target.closest("#manualForm");
  const actions=manualForm?.querySelector(".actions");
  if(actions){
    requestAnimationFrame(()=>{
      const r=actions.getBoundingClientRect();
      const bottom=(vv?.offsetTop||0)+(vv?.height||window.innerHeight)-12;
      if(r.bottom>bottom){
        sheet.scrollTop+=Math.ceil(r.bottom-bottom+18);
      }
    });
  }
}

document.addEventListener("focusin",e=>{
  const target=e.target;
  if(!target?.matches?.("input,textarea,select"))return;
  if(!target.closest(".sheet"))return;
  if(target.id==="reportText")return; // v103: окно «Отчёт» само держит поле и кнопку над клавиатурой
  setTimeout(()=>scrollModalFieldIntoView(target),120);
  setTimeout(()=>scrollModalFieldIntoView(target),320);
});

document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")flushSave();});
window.addEventListener("pagehide",flushSave);

// Один набор обработчиков вместо обработчика на каждом теге. Это заметно снижает
// количество объектов/замыканий на длинных списках и уменьшает нагрузку на iPhone/Android.
tabs.addEventListener("scroll",updateTabsFade,{passive:true});
window.addEventListener("resize",updateTabsFade,{passive:true});
(document.fonts?.ready||Promise.resolve()).then(updateTabsFade);
tabs.addEventListener("click",e=>{
  const b=e.target.closest(".tab");
  if(!b)return;
  filter=b.dataset.filter||"all";
  if(selectionMode){
    const ids=new Set(visibleData().map(item=>item.id));
    selectedTagIds=new Set([...selectedTagIds].filter(id=>ids.has(id)));
  }
  updateSelectionFooter();
  renderTabs();renderSummary();renderList();
});

list.addEventListener("click",e=>{
  if(suppressRowClickUntil&&Date.now()<suppressRowClickUntil){
    suppressRowClickUntil=0;e.preventDefault();e.stopPropagation();return;
  }
  const ref=rowItemFromTarget(e.target);
  if(!ref)return;
  const {row,item}=ref;

  const editBtn=e.target.closest(".rowEdit");
  if(editBtn){
    e.stopPropagation();
    openEdit(item.id);
    return;
  }
  const cancelBtn=e.target.closest(".rowCancel");
  if(cancelBtn){
    e.stopPropagation();
    setSelectionMode(false);
    return;
  }
  const selectBtn=e.target.closest(".rowSelect");
  if(selectBtn){
    e.stopPropagation();
    toggleTagSelection(item.id);
    return;
  }
  const copyBtn=e.target.closest(".rowCopy");
  if(copyBtn){
    e.stopPropagation();
    const ids=selectedTagIds.size?[...selectedTagIds]:[item.id];
    copyTags(ids);
    return;
  }
  if(e.target.closest(".check")){
    e.stopPropagation();
    item.done=!item.done;
    save();
    updateRenderedRowState(row,item);
    renderTabs(false);renderSummary();
    if(filter==="done"||filter==="todo")renderList();
    return;
  }
  if(selectionMode && !e.target.closest("button,textarea,input,select")){
    e.stopPropagation();
    toggleTagSelection(item.id);
    return;
  }
  const taskToggle=e.target.closest(".taskToggle");
  if(taskToggle){
    e.stopPropagation();
    const editor=row.querySelector(".taskEditorWrap");
    // Первое касание — открыть для чтения (без фокуса и клавиатуры), второе — закрыть.
    if(editor?.classList.contains("open")) closeTaskEditor(row,item);
    else setTaskEditor(row,item,true,false);
    return;
  }
  const taskSave=e.target.closest(".taskSave");
  if(taskSave){
    e.stopPropagation();
    commitTaskEditor(row,item);
    return;
  }
  if(longPressTriggered){e.preventDefault();longPressTriggered=false;}
});
list.addEventListener("contextmenu",e=>{
  // На Android долгий тап может породить contextmenu. Он никогда не открывает
  // редактирование: редактирование доступно только через карандаш.
  if(e.target.closest(".row") && !e.target.closest("textarea,input,select")){
    e.preventDefault();
    e.stopPropagation();
    longPressTriggered=false;
  }
});
list.addEventListener("touchstart",e=>{
  if(e.target.closest("textarea,input,select,button"))return;
  const ref=rowItemFromTarget(e.target);
  if(ref)startLongPress(ref.item.id);
},{passive:true});
list.addEventListener("touchmove",e=>{if(e.target.closest(".row"))cancelLongPress();},{passive:true});
list.addEventListener("touchend",cancelLongPress,{passive:true});
list.addEventListener("touchcancel",cancelLongPress,{passive:true});

let pullGuardStartY=0;
document.addEventListener("touchstart",e=>{
  if(e.touches?.length!==1)return;
  pullGuardStartY=e.touches[0].clientY;
},{passive:true});
document.addEventListener("touchmove",e=>{
  if(e.touches?.length!==1)return;
  const dy=e.touches[0].clientY-pullGuardStartY;
  if(window.scrollY<=0 && dy>8 && !e.target.closest(".pageStrip,.tabs,.importList,.taskBox textarea,.fullReportText,.fullReportSheet,.sheet")){
    e.preventDefault();
  }
},{passive:false});

let addMode="manual";
let ocrCandidates=[];
let ocrCandidateMeta=new Map();
let ocrRunToken=0;

let fileCandidates=[];
let sheetJsPromise=null;

// Только системные шрифты: ничего не скачивается, работает без интернета.
// Каждый пункт — стек «шрифт iPhone, шрифт Android, общий запасной». Android берёт
// семейства по именам из своего fonts.xml: sans-serif-condensed — Roboto Condensed,
// serif-monospace и Courier New — Cutive Mono, Georgia — Noto Serif, monospace — Droid Sans Mono.
// Arial, Verdana и Trebuchet MS убраны: на Android их нет, и они подменялись системным Roboto.
// Пункт, который на устройстве не отличается от системного, скрывается (availableFontOptions);
// сохранённый выбор такого или удалённого шрифта показывается «Системным».
const SYSTEM_FONT_STACK='-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
const FONT_OPTIONS=[
  {id:"system",name:"Системный",family:SYSTEM_FONT_STACK,sample:"Aa КИП 123"},
  // Узкий: длинные теги помещаются в строку. iPhone — Avenir Next Condensed, Android — Roboto Condensed.
  {id:"condensed",name:"Узкий",family:`"sans-serif-condensed","Avenir Next Condensed","Roboto Condensed","Arial Narrow",${SYSTEM_FONT_STACK}`,sample:"Aa КИП 123"},
  {id:"georgia",name:"Georgia",family:'Georgia,"Times New Roman",serif',sample:"Aa КИП 123"},
  // Моно без засечек: iPhone — SF Mono (Menlo на старых iOS), Android — Droid Sans Mono.
  {id:"mono",name:"Моно",family:'ui-monospace,"SF Mono",Menlo,Consolas,monospace',sample:"Aa КИП 123"},
  // «Пишущая машинка»: iPhone — Courier New, Android — Cutive Mono (кириллица — Droid Sans Mono).
  {id:"courier",name:"Courier New",family:'"Courier New",Courier,"serif-monospace",monospace',sample:"Aa КИП 123"}
];

// ===== v98: справка — маленькие «!» в каждом разделе и в окнах, одно общее окно справки =====
// Тексты — коротко «что для чего». Формулы и нормативы конверторов — в их модулях
// (кнопка «Источники и формулы» внизу страниц «Газ» и «4–20»).
const HELP_SVG={
  eye:'<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.8"></circle>',
  send:'<path d="M21.5 2.5 10.8 13.2"></path><path d="m21.5 2.5-6.8 19-3.9-8.3-8.3-3.9Z"></path>',
  search:'<circle cx="10.8" cy="10.8" r="6.2"></circle><path d="m16 16 5 5"></path>',
  report:'<rect x="5" y="4.5" width="14" height="17" rx="2.5"></rect><path d="M9 3h6v3.2H9z"></path><path d="m8.6 12.4 1.8 1.8 3.4-3.6"></path><path d="M8.6 17.4h6.8"></path>',
  install:'<path d="M12 4v11"></path><path d="m7 10.5 5 5 5-5"></path><path d="M5 20h14"></path>',
  open:'<path d="M3.5 17.5v-11a2 2 0 0 1 2-2h3.7l2 2.5h7.3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"></path><path d="M12 16.5v-6"></path><path d="m9.3 13.2 2.7-2.7 2.7 2.7"></path>',
  save:'<path d="M12 3.5v11"></path><path d="m7.5 10 4.5 4.5 4.5-4.5"></path><path d="M4.5 15.5v1.8A2.7 2.7 0 0 0 7.2 20h9.6a2.7 2.7 0 0 0 2.7-2.7v-1.8"></path>',
  text:'<path d="M13.5 3.5H7A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5V9.5Z"></path><path d="M13.5 3.5v6h6"></path><path d="M8.5 13.5h7M8.5 17h5"></path>',
  all:'<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"></path><circle class="helpDot" cx="5" cy="6.5" r="1.25"></circle><circle class="helpDot" cx="5" cy="12" r="1.25"></circle><circle class="helpDot" cx="5" cy="17.5" r="1.25"></circle>',
  done:'<circle cx="12" cy="12" r="8.5"></circle><path d="m8.3 12.3 2.6 2.6 4.9-5.2"></path>',
  todo:'<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.6V12l2.9 1.8"></path>',
  task:'<path d="M4.5 19.5h4L19 9a2.8 2.8 0 0 0-4-4L4.5 15.5Z"></path><path d="m13.5 6.5 4 4"></path>',
  camera:'<path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h2l1.6-2.2h5.8l1.6 2.2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"></path><circle cx="12" cy="13" r="3.6"></circle>',
  photo:'<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"></rect><circle cx="9" cy="9.5" r="1.7"></circle><path d="m20.5 15.5-5-5-8.5 9"></path>',
  paste:'<rect x="5.5" y="5" width="13" height="15.5" rx="2.5"></rect><path d="M9 5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v1"></path><path d="M9 11h6M9 14.5h6M9 18h3.5"></path>',
  check:'<rect x="4" y="4" width="16" height="16" rx="3.5"></rect><path d="m8.2 12.2 2.6 2.6 5-5.3"></path>'
};
const hK=inner=>`<span class="hK" aria-hidden="true">${inner}</span>`;
const hS=name=>hK(`<svg class="hIco" viewBox="0 0 24 24">${HELP_SVG[name]}</svg>`);
const hT=text=>hK(`<span class="hKT">${text}</span>`);
const hLi=(key,body)=>`<li>${key}<span>${body}</span></li>`;
const HELP={
  list:{title:"Тэги — справка",html:`
<p class="helpLead">Чек-лист приборов: что сделано, что осталось и задания по каждому тегу. Данные хранятся только на этом телефоне.</p>
<h3>Кнопки под шапкой</h3>
<ul>
${hLi(hS("eye"),"<b>Сухой список</b> — перечень на весь экран: весь, выполненные, невыполненные, задания.")}
${hLi(hT("Aa"),"<b>Шрифт</b> — по кругу. В списке только шрифты, которые есть на этом телефоне.")}
${hLi(hS("send"),"<b>Сохранить / отправить</b> — отчёт текстом в мессенджер или файл состояния .json.")}
${hLi(hT("A±"),"<b>Размер текста</b> — меньше / больше.")}
${hLi(hS("report"),"<b>Отчёт</b> — в рабочую группу: одна или несколько страниц, выполненные, невыполненные или всё, с заданиями или без, исполнители (на iPhone — подсказки имён из контактов или Contact Picker API в настройках Safari). Окно на весь экран, «Отправить» всегда внизу. Двойное касание по тексту — правка на весь экран, курсор там, где коснулись; «Готово» возвращает к настройкам. Правки сохраняются при смене выбора.")}
${hLi(hS("search"),"<b>Поиск</b> — по тегу или номеру установки.")}
${hLi(hS("install"),"<b>Установить</b> — на главный экран. Кнопка видна, когда браузер это разрешает.")}
</ul>
<h3>Страницы</h3>
<p>Отдельные списки — например, по установкам или сменам. Нажми — открыть, <b>+</b> — новая. Удержи страницу — «Изменить» (название), «Выбрать» (все) и «Удалить».</p>
<h3>Фильтры и прогресс</h3>
<p>Все, Задания, Выполненные, Невыполненные и по установке — по номеру установки в теге (цифры перед буквами: <span class="nw">2131-PT-102</span> → «2131»). В скобках — сколько тегов. «Общий прогресс» считает всю страницу.</p>
<h3>Карточка тега</h3>
<ul>
${hLi(hS("check"),"<b>Квадрат слева</b> — выполнено / не выполнено.")}
${hLi(hT("▾"),"<b>Задание</b> — открыть поле. Нажми в текст, чтобы писать, «Сохранить» — закончить. «есть» — задание записано.")}
${hLi(hT("✎"),"<b>Изменить</b> — тег, задание, статус или удалить прибор.")}
</ul>
<h3>Выбор нескольких</h3>
<p>Удержи карточку тега. Справа: <b>×</b> — выйти из выбора, пустая кнопка — выбрать (появится ✓), <b>⧉</b> — копировать выбранные теги с заданиями. Внизу: «Удалить» — сразу удаляет выбранные, «Все» — выбрать всё в текущем фильтре или снять выбор, «Выполнено» — отметить выбранные или снять отметку.</p>
<h3>Добавить — кнопка «+»</h3>
<p>Вручную, с камеры, из фото или из файла. Подробнее — «!» в окне добавления.</p>
<h3>Где данные</h3>
<p>Теги, задания и настройки хранятся в памяти телефона и работают без интернета. Сеть с VPN нужна только для распознавания тегов с фото — сервис OCR.space (Engine 3, при сбое Engine 2); в браузере — ещё для обновления самого приложения. Перенести список на другой телефон: «Сохранить / отправить» → файл .json → «Открыть» на другом телефоне.</p>`},
  gas:{title:"Газоанализ — справка",html:`
<p class="helpLead">Пересчёт показаний газоанализатора: ppm, мг/м³, % об., % НКПР, ppb, г/м³ и ток 4–20 мА. Считается на телефоне, без интернета.</p>
<h3>Вещество</h3>
<p>Газ — из списка или кнопкой. «Параметры» — молярная масса, НКПР и ПДК: если в паспорте прибора НКПР другой, впиши его; «Справочные» вернут значения. «Свой газ» (в конце списка) — для смесей.</p>
<h3>Концентрация</h3>
<p>Введи показание и выбери его единицу. Серые единицы недоступны: для % НКПР газ должен быть горючим, для мг/м³ нужна молярная масса.</p>
<h3>Условия пересчёта</h3>
<p>Температура и абсолютное давление. Влияют только на мг/м³ и г/м³. Кнопки — типовые условия: 20 °C — для ПДК рабочей зоны.</p>
<h3>Результат</h3>
<p>Все единицы сразу; нажми строку — значение скопируется. Ниже — доля ПДК и ток по шкале из блока «Сигнал». «Тэг для задания» и «В задание» — дописать результат в задание тега (если тега нет, он создаётся). Копировать и «Отправить» — текст результата.</p>
<h3>Сигнал 4–20 мА</h3>
<p>Шкала прибора: начало, конец и единица. Ток и значение пересчитываются в обе стороны, состояние сигнала — по NAMUR NE 43. «Из расчёта» и «В расчёт» — обмен с блоком «Концентрация».</p>
<p class="helpNote">Формулы и нормативы — кнопка «Источники и формулы» внизу страницы.</p>`},
  loop:{title:"4–20 мА — справка",html:`
<p class="helpLead">Пересчёт «величина ⇄ ток ⇄ % шкалы» для TT, PT, FT и LT и точки поверки. Считается на телефоне, без интернета.</p>
<h3>Прибор</h3>
<p>Тип: TT — температура, PT — давление, FT — расход, LT — уровень. Введи тег — тип определится по буквам (<span class="nw">2131-TT-434</span> → TT). «Сохранить» запоминает шкалу для тега; сохранённые теги — кнопками ниже, × — удалить.</p>
<h3>Значение</h3>
<p>Введи любое поле — величину, сопротивление или перепад, ток или % шкалы, — остальные пересчитаются. Полоса показывает ток в петле, состояние — по NAMUR NE 43. Копировать, «В задание» и «Отправить» — как в «Газе».</p>
<h3>Шкала</h3>
<p>НПИ (4 мА), ВПИ (20 мА) и настройки типа: НСХ и R₀ термосопротивления, °C или °F, единицы давления, расход по перепаду (где извлекается корень), уровень прямой или гидростатикой (плотность и смещение). Кнопки — типовые шкалы.</p>
<h3>Точки поверки</h3>
<p>0, 25, 50, 75 и 100 % шкалы с ожидаемым током. Нажми строку — значения перейдут в «Значение».</p>
<p class="helpNote">Формулы и нормативы — кнопка «Источники и формулы» внизу страницы.</p>`},
  elec:{title:"Электроэнергетика — справка",html:`
<p class="helpLead">Электрические расчёты: в каждой вкладке введите любые значения, кроме одного, — оно посчитается. Поле с меткой «расчёт» — то, которое вы трогали давнее всех. Считается на телефоне, без интернета.</p>
<div class="hpTabs" role="tablist" aria-label="Страницы справки"><span class="hpThumb" aria-hidden="true"></span><button type="button" class="hpTab active" data-page="0" role="tab" aria-selected="true">P·I · M — мощность</button><button type="button" class="hpTab" data-page="1" role="tab" aria-selected="false">ΔU · ТТ — кабель</button></div>
<div class="hpPager">
<section class="hpPage" aria-label="Страница 1 из 2">
<h3>Сеть</h3>
<p>3 фазы — напряжение линейное (между фазами), 1 фаза — фазное. Кнопки 400 В, 690 В, 6 кВ, 10 кВ подставляют типовые значения.</p>
<h3><span class="hpKind">P·I</span>Мощность и ток</h3>
<p>Четыре поля: U, I, P, cosφ — любые три, четвёртое считается. Под ними S (кВА), Q (квар) и ток на 1 кВт. Единицы (В/кВ, А/кА, Вт/кВт/МВт) — касанием по подписи справа в поле.</p>
<div class="hpEx"><span class="k">Пример: ток двигателя насоса</span>3 фазы, <b>400 В</b>, P <b>75 кВт</b>, cosφ <b>0,86</b> → I <b>125,9 А</b>, S 87,2 кВА, Q 44,5 квар.</div>
<div class="hpEx"><span class="k">Пример: нагрузка по клещам</span>3 фазы, <b>10 кВ</b>, клещи <b>40 А</b>, cosφ <b>0,9</b> → P <b>623,5 кВт</b>.</div>
<h3><span class="hpKind">M</span>Двигатель</h3>
<p>P₂ на валу (как на шильдике), номинальный ток, cosφ и КПД η — любые три. Ниже — пусковой ток по кратности, пуск звезда → треугольник и скольжение по оборотам.</p>
<div class="hpEx"><span class="k">Пример: проверить автомат</span><b>75 кВт</b>, 400 В, cosφ <b>0,86</b>, η <b>0,94</b> → Iн <b>133,9 А</b>. Кратность 7 → пуск ≈ <b>937 А</b>, через звезду ≈ 312 А. Обороты 1480 → синхронные 1500, скольжение 1,33 %.</div>
<p class="hpSwipe">Листайте влево — кабель и учёт →</p>
</section>
<section class="hpPage" aria-label="Страница 2 из 2">
<h3><span class="hpKind">ΔU</span>Кабель</h3>
<p>Сечение, длина, ток и потеря напряжения ΔU % — любые три. Материал — медь или алюминий, cosφ нагрузки — в «Параметрах». Если сечение посчиталось нестандартным, ниже — ближайшее большее.</p>
<div class="hpEx"><span class="k">Пример: хватит ли кабеля</span>Медь <b>35 мм²</b>, <b>120 м</b>, <b>136 А</b>, 400 В, cosφ 0,86 → ΔU <b>3,93 %</b> (15,7 В).</div>
<div class="hpEx"><span class="k">Пример: сколько можно протянуть</span>Введите сечение, ток и ΔU <b>5 %</b> — посчитается длина: ≈ <b>152 м</b>.</div>
<p class="mini">AWG → мм²: AWG 10 = 5,26 мм² → ближайшее 6 мм². Допустимый ток по нагреву (ПУЭ, гл. 1.3) не проверяется. Предел ΔU задаёт проект, частый ориентир — 5 %.</p>
<h3><span class="hpKind">ТТ</span>Учёт</h3>
<p>Начальное и конечное показание, расход — любые два. Множитель K = Kтт × Kтн. Если в счётчик при наладке занесли коэффициенты, выберите «первичку» — множитель не нужен.</p>
<div class="hpEx"><span class="k">Пример: расход за месяц</span>ТТ <b>600/5</b>, без ТН → K <b>120</b>. 12 345,6 → 12 512,3: разность 166,7 → <b>20 004 кВт·ч</b>. За 30 дней средняя мощность 27,8 кВт.</div>
<div class="hpEx"><span class="k">С трансформатором напряжения</span>ТТ 600/5 и ТН <b>10000/100</b> → K = 120 × 100 = <b>12 000</b>.</div>
<h3>Таблица, тэг и кнопки</h3>
<p>Нажмите строку таблицы — подставится мощность, сечение или трансформатор тока. «Тэг» — куда «В задание» допишет результат (нет такого тега — он будет создан). Копировать и «Отправить» — как в «Газе» и «4–20».</p>
<p class="helpNote">Формулы и нормативы — кнопка «Источники и формулы» внизу страницы.</p>
</section>
</div>
<div class="hpDots" aria-hidden="true"><i class="on"></i><i></i></div>`},
  export:{title:"Отправка — справка",html:`
<h3>Состояние — все страницы целиком</h3>
<ul>
${hLi(hS("send"),"<b>Отправить • актуал</b> — файл .json в мессенджер. Из Chrome на Android уходит как «….json.txt» — открывается так же.")}
${hLi(hS("open"),"<b>Открыть</b> — загрузить состояние из файла .json. Текущее перед этим сохраняется резервной копией в памяти телефона.")}
${hLi(hS("save"),"<b>Сохранить</b> — файл .json в «Загрузки» или выбранную папку.")}
${hLi(hS("text"),"<b>Актуал • текст</b> — все страницы текстом: выполненные, невыполненные, задания.")}
</ul>
<h3>Отчёт по открытой странице</h3>
<ul>
${hLi(hS("all"),"<b>Весь список</b> — выполненные и невыполненные.")}
${hLi(hS("done"),"<b>Выполненные</b> — только выполненные.")}
${hLi(hS("todo"),"<b>Невыполненные</b> — только оставшиеся.")}
${hLi(hS("task"),"<b>Задания</b> — теги с заданиями, задание в одну строку.")}
</ul>
<p class="helpNote">Текст уходит через «Поделиться»; если его нет — копируется в буфер обмена.</p>`},
  add:{title:"Добавление — справка",html:`
<ul>
${hLi(hS("camera"),"<b>Камера</b> и "+hS("photo")+" <b>Фото</b> — снимок списка или бирок. Фото распознаётся прямо на телефоне, без интернета; значком в углу фото можно выделить нужный участок. Для сложных снимков есть тумблер <b>OCR.space</b> — рядом с заголовком и в окне фото: онлайн-распознавание (Engine 3, при сбое Engine 2), нужны интернет и VPN. Окно с найденными тегами тянется за ручку сверху — на весь экран или на половину. Найденные теги появятся списком: отметь «Добавить», при необходимости «Выполнено» и задание.")}
${hLi(hS("text"),"<b>Файл</b> — сразу открывает выбор файла: XLSX, XLS, CSV, TSV, TXT. Читается на телефоне, без интернета.")}
${hLi(hS("paste"),"<b>Вставить</b> — сразу вставляет текст из буфера обмена: из письма, таблицы или мессенджера.")}
${hLi(hT("ISA"),"<b>Формат тегов</b> — кнопка рядом с OCR. По нему приложение находит теги в тексте, файлах и на фото и проверяет ручной ввод. По умолчанию — ISA-5.1; есть KKS и свой образец. Выбор хранится на телефоне; подробности — в справке меню формата.")}
</ul>
<h3>Вручную</h3>
<p>Тег, задание и статус. Под полем сразу видно, подходит ли тег под формат и в какую вкладку он попадёт: вкладки строятся по номеру установки — <span class="nw">21-PT-1001</span> → «21».</p>
<p class="helpNote">Тег, который уже есть на этой странице, не добавляется второй раз. Если это другой прибор с тем же номером (резерв, пара A/B), допишите букву вплотную к номеру — <span class="nw">2131-PT-414A</span>: это уже новый тег. Приложение подскажет свободную букву под полем, в окне повтора и в списке найденного — коснитесь её. На другой странице тот же тег можно добавлять без изменений.</p>`},
  fmt:{title:"Формат тегов — справка",html:`
<p class="helpLead">Формат — правило, по которому приложение находит теги во вставленном тексте, в файлах и на фото и проверяет ручной ввод. Выбор хранится на этом телефоне.</p>
<h3>ISA-5.1</h3>
<p>Международное обозначение приборов; у нас те же буквы по ГОСТ 21.208.</p>
<div class="isaTag" aria-label="Пример: 21-PT-1001A"><span><b>21</b><small>установка</small></span><span><b>P</b><small>величина</small></span><span><b>T</b><small>функция</small></span><span><b>1001</b><small>контур</small></span><span><b>A</b><small>дубль</small></span></div>
<ul>
${hLi(hT("1-я"),"<b>Измеряемая величина:</b> P давление, T температура, F расход, L уровень, A анализ, V вибрация, Z положение, H ручное.")}
${hLi(hT("далее"),"<b>Функция:</b> T датчик, I показание, C регулятор, V клапан, S сигнализатор, E первичный элемент, Y преобразователь; H/L — верх/низ: <code>LSHH</code> — уровень, сигнал верхний аварийный.")}
</ul>
<p><b>Установка</b> — цифры перед буквами, любой длины: <code>2131-PT-102</code>, <code>21-PT-1001</code>, <code>100-FT-0012</code>. По ней строятся вкладки. Переключатель <b>Установка</b>: «Любая» — берутся теги с установкой и без; «Есть» — только с установкой; «Нет» — только <code>PT-101</code>.</p>
<h3>KKS</h3>
<p>Электростанции: <code>10LBA10CP001</code> — блок 10, система LBA, датчик CP001. Вкладка — блок и система: «10LBA».</p>
<h3>Свой образец</h3>
<p>Впишите тег из своего списка — правило построится само: первая группа цифр становится установкой, буквы — типом прибора. Можно 2–3 образца через запятую.</p>
<h3>Что не считается тегом</h3>
<ul>
${hLi(hT("1 буква"),"Оборудование и крепёж: <code>P-101</code> насос, <code>V-201</code> ёмкость, <code>M-20</code> болт.")}
${hLi(hT("DN PN"),"Размер и давление трубы. Маркировки и стандарты: IP65, RS485, Pt100.")}
${hLi(hT("DWG"),"Номера документов: DWG, REV, ITP. Слова вроде AREA 21, SKID 100.")}
</ul>
<h3>Исправляется само</h3>
<p>Кириллица в теге → латиница: <code>РТ</code> → <code>PT</code>. На фото в номере буква O → 0, I и L → 1.</p>
<p class="helpNote"><b>Проверить на тексте</b> — вставьте кусок перечня: зелёным — тег, жёлтым — исправлен, зачёркнуто — не взят; коснитесь, чтобы увидеть причину.</p>`}
};
// v107: справка на английском — та же разметка и значки, что у HELP.
const HELP_EN={
  list:{title:"Tags — help",html:`
<p class="helpLead">Instrument checklist: what is done, what is left and a task for every tag. Data is stored only on this phone.</p>
<h3>Buttons under the header</h3>
<ul>
${hLi(hS("eye"),"<b>Plain list</b> — full-screen list: all, done, pending, tasks.")}
${hLi(hT("Aa"),"<b>Font</b> — cycles through. Only fonts available on this phone are listed.")}
${hLi(hS("send"),"<b>Save / send</b> — text report to a messenger or a .json state file.")}
${hLi(hT("A±"),"<b>Text size</b> — smaller / larger.")}
${hLi(hS("report"),"<b>Report</b> — for the work group: one or several pages, done, pending or all, with or without tasks, crew (on iPhone — name suggestions from contacts, or Contact Picker API in Safari settings). Full-screen window, “Send” is always at the bottom. Double-tap the text to edit full screen, the cursor goes where you tapped; “Done” returns to the settings. Edits are kept when you change the selection.")}
${hLi(hS("search"),"<b>Search</b> — by tag or unit number.")}
${hLi(hS("install"),"<b>Install</b> — to the home screen. Visible when the browser allows it.")}
</ul>
<h3>Pages</h3>
<p>Separate lists — e.g. per unit or per shift. Tap to open, <b>+</b> for a new one. Hold a page for “Edit” (name), “Select” (all) and “Delete”.</p>
<h3>Filters and progress</h3>
<p>All, Tasks, Done, Pending and per unit — by the unit number in the tag (digits before the letters: <span class="nw">2131-PT-102</span> → “2131”). Brackets show the tag count. “Overall progress” counts the whole page.</p>
<h3>Tag card</h3>
<ul>
${hLi(hS("check"),"<b>Square on the left</b> — done / not done.")}
${hLi(hT("▾"),"<b>Task</b> — open the field. Tap the text to write, “Save” to finish. “✓” — a task is written.")}
${hLi(hT("✎"),"<b>Edit</b> — tag, task, status, or delete the instrument.")}
</ul>
<h3>Multiple selection</h3>
<p>Hold a tag card. On the right: <b>×</b> — leave selection, empty button — select (a ✓ appears), <b>⧉</b> — copy selected tags with tasks. At the bottom: “Delete” removes the selected at once, “All” selects everything in the current filter or clears it, “Done” marks the selected or clears the mark.</p>
<h3>Add — the “+” button</h3>
<p>Manually, from the camera, a photo or a file. Details — the “!” in the add window.</p>
<h3>Where the data is</h3>
<p>Tags, tasks and settings are stored in the phone memory and work offline. A network with VPN is needed only for photo recognition with the OCR.space service (Engine 3, Engine 2 as fallback); in the browser — also for updating the app itself. To move the list to another phone: “Save / send” → .json file → “Open” on the other phone.</p>`},
  gas:{title:"Gas detection — help",html:`
<p class="helpLead">Gas detector reading conversion: ppm, mg/m³, % vol, % LEL, ppb, g/m³ and 4–20 mA current. Calculated on the phone, offline.</p>
<h3>Substance</h3>
<p>Pick a gas from the list or with a button. “Parameters” — molar mass, LEL and OEL: if the detector datasheet gives a different LEL, enter it; “Reference” restores the values. “Custom gas” (end of the list) — for mixtures.</p>
<h3>Concentration</h3>
<p>Enter the reading and choose its unit. Grey units are unavailable: % LEL needs a flammable gas, mg/m³ needs the molar mass.</p>
<h3>Conversion conditions</h3>
<p>Temperature and absolute pressure. They affect only mg/m³ and g/m³. Buttons — typical conditions: 20 °C is used for workplace exposure limits.</p>
<h3>Result</h3>
<p>All units at once; tap a row to copy the value. Below — the OEL fraction and the current from the scale in the “Signal” block. “Tag for task” and “To task” append the result to the tag’s task (the tag is created if missing). Copy and “Send” — the result as text.</p>
<h3>4–20 mA signal</h3>
<p>Instrument scale: start, end and unit. Current and value are converted both ways, signal status per NAMUR NE 43. “From result” and “To input” exchange values with the “Concentration” block.</p>
<p class="helpNote">Formulas and standards — the “Sources and formulas” button at the bottom of the page.</p>`},
  loop:{title:"4–20 mA — help",html:`
<p class="helpLead">“Value ⇄ current ⇄ % of span” conversion for TT, PT, FT and LT plus calibration points. Calculated on the phone, offline.</p>
<h3>Instrument</h3>
<p>Type: TT — temperature, PT — pressure, FT — flow, LT — level. Enter a tag — the type is detected from the letters (<span class="nw">2131-TT-434</span> → TT). “Save” stores the scale for the tag; saved tags are the buttons below, × deletes.</p>
<h3>Value</h3>
<p>Enter any field — process value, resistance or differential pressure, current or % of span — the rest is recalculated. The bar shows the loop current, the status follows NAMUR NE 43. Copy, “To task” and “Send” — as in “Gas”.</p>
<h3>Scale</h3>
<p>LRV (4 mA), URV (20 mA) and the type settings: RTD curve and R₀, °C or °F, pressure units, DP flow (where the square root is taken), level direct or hydrostatic (density and offset). Buttons — typical ranges.</p>
<h3>Calibration points</h3>
<p>0, 25, 50, 75 and 100 % of span with the expected current. Tap a row to move the values to “Value”.</p>
<p class="helpNote">Formulas and standards — the “Sources and formulas” button at the bottom of the page.</p>`},
  elec:{title:"Electrical — help",html:`
<p class="helpLead">Electrical calculations: in each tab enter all values but one — it is calculated. The field marked “calc” is the one you touched least recently. Calculated on the phone, offline.</p>
<div class="hpTabs" role="tablist" aria-label="Help pages"><span class="hpThumb" aria-hidden="true"></span><button type="button" class="hpTab active" data-page="0" role="tab" aria-selected="true">P·I · M — power</button><button type="button" class="hpTab" data-page="1" role="tab" aria-selected="false">ΔU · CT — cable</button></div>
<div class="hpPager">
<section class="hpPage" aria-label="Page 1 of 2">
<h3>Network</h3>
<p>3 phases — line-to-line voltage, 1 phase — line-to-neutral. Buttons 400 V, 690 V, 6 kV, 10 kV set typical values.</p>
<h3><span class="hpKind">P·I</span>Power and current</h3>
<p>Four fields: U, I, P, cosφ — any three, the fourth is calculated. Below them S (kVA), Q (kvar) and current per 1 kW. Units (V/kV, A/kA, W/kW/MW) — tap the label on the right of the field.</p>
<div class="hpEx"><span class="k">Example: pump motor current</span>3 phases, <b>400 V</b>, P <b>75 kW</b>, cosφ <b>0.86</b> → I <b>125.9 A</b>, S 87.2 kVA, Q 44.5 kvar.</div>
<div class="hpEx"><span class="k">Example: load from a clamp meter</span>3 phases, <b>10 kV</b>, clamp <b>40 A</b>, cosφ <b>0.9</b> → P <b>623.5 kW</b>.</div>
<h3><span class="hpKind">M</span>Motor</h3>
<p>P₂ on the shaft (as on the nameplate), rated current, cosφ and efficiency η — any three. Below — starting current from the ratio, star-delta start and slip from the speed.</p>
<div class="hpEx"><span class="k">Example: check the breaker</span><b>75 kW</b>, 400 V, cosφ <b>0.86</b>, η <b>0.94</b> → In <b>133.9 A</b>. Ratio 7 → start ≈ <b>937 A</b>, via star ≈ 312 A. Speed 1480 → synchronous 1500, slip 1.33 %.</div>
<p class="hpSwipe">Swipe left — cable and metering →</p>
</section>
<section class="hpPage" aria-label="Page 2 of 2">
<h3><span class="hpKind">ΔU</span>Cable</h3>
<p>Cross-section, length, current and voltage drop ΔU % — any three. Material — copper or aluminium, load cosφ — in “Parameters”. If the calculated cross-section is non-standard, the next larger one is shown below.</p>
<div class="hpEx"><span class="k">Example: is the cable enough</span>Copper <b>35 mm²</b>, <b>120 m</b>, <b>136 A</b>, 400 V, cosφ 0.86 → ΔU <b>3.93 %</b> (15.7 V).</div>
<div class="hpEx"><span class="k">Example: how far can it run</span>Enter the cross-section, current and ΔU <b>5 %</b> — the length is calculated: ≈ <b>152 m</b>.</div>
<p class="mini">AWG → mm²: AWG 10 = 5.26 mm² → nearest 6 mm². Current-carrying capacity (PUE ch. 1.3 / IEC 60364-5-52) is not checked. The ΔU limit comes from the design; a common guide is 5 %.</p>
<h3><span class="hpKind">CT</span>Metering</h3>
<p>Start and end readings, consumption — any two. Multiplier K = Kct × Kvt. If the CT/VT ratios were entered into the meter at commissioning, choose “primary” — no multiplier needed.</p>
<div class="hpEx"><span class="k">Example: monthly consumption</span>CT <b>600/5</b>, no VT → K <b>120</b>. 12 345.6 → 12 512.3: difference 166.7 → <b>20 004 kWh</b>. Over 30 days the average power is 27.8 kW.</div>
<div class="hpEx"><span class="k">With a voltage transformer</span>CT 600/5 and VT <b>10000/100</b> → K = 120 × 100 = <b>12 000</b>.</div>
<h3>Table, tag and buttons</h3>
<p>Tap a table row to fill in the power, cross-section or current transformer. “Tag” — where “To task” appends the result (a missing tag is created). Copy and “Send” — as in “Gas” and “4–20”.</p>
<p class="helpNote">Formulas and standards — the “Sources and formulas” button at the bottom of the page.</p>
</section>
</div>
<div class="hpDots" aria-hidden="true"><i class="on"></i><i></i></div>`},
  export:{title:"Sending — help",html:`
<h3>State — all pages at once</h3>
<ul>
${hLi(hS("send"),"<b>Send • current state</b> — .json file to a messenger. From Chrome on Android it goes as “….json.txt” — it opens the same way.")}
${hLi(hS("open"),"<b>Open</b> — load the state from a .json file. The current state is first backed up in the phone memory.")}
${hLi(hS("save"),"<b>Save</b> — .json file to Downloads or a chosen folder.")}
${hLi(hS("text"),"<b>Current state • text</b> — all pages as text: done, pending, tasks.")}
</ul>
<h3>Report for the open page</h3>
<ul>
${hLi(hS("all"),"<b>Whole list</b> — done and pending.")}
${hLi(hS("done"),"<b>Done</b> — done only.")}
${hLi(hS("todo"),"<b>Pending</b> — what is left only.")}
${hLi(hS("task"),"<b>Tasks</b> — tags with tasks, one line per task.")}
</ul>
<p class="helpNote">The text goes through “Share”; if it is unavailable, it is copied to the clipboard.</p>`},
  add:{title:"Adding — help",html:`
<ul>
${hLi(hS("camera"),"<b>Camera</b> and "+hS("photo")+" <b>Photo</b> — a shot of a list or tag plates. The photo is recognized right on the phone, offline; the icon in the photo corner lets you select the needed area. For difficult shots there is the <b>OCR.space</b> switch — next to the title and in the photo window: online recognition (Engine 3, Engine 2 as fallback), needs internet and VPN. The window with the found tags can be dragged by the handle at the top — full screen or half. Found tags appear as a list: tick “Add”, if needed “Done” and a task.")}
${hLi(hS("text"),"<b>File</b> — opens the file picker right away: XLSX, XLS, CSV, TSV, TXT. Read on the phone, offline.")}
${hLi(hS("paste"),"<b>Paste</b> — pastes text from the clipboard right away: from an email, a spreadsheet or a messenger.")}
${hLi(hT("ISA"),"<b>Tag format</b> — the button next to OCR. The app uses it to find tags in text, files and photos and to check manual input. Default — ISA-5.1; KKS and an own sample are available. The choice is stored on the phone; details — in the format menu help.")}
</ul>
<h3>Manually</h3>
<p>Tag, task and status. Under the field you see at once whether the tag matches the format and which tab it goes to: tabs are built from the unit number — <span class="nw">21-PT-1001</span> → “21”.</p>
<p class="helpNote">A tag that already exists on this page is not added twice. If it is another instrument with the same number (standby, A/B pair), add a letter right after the number — <span class="nw">2131-PT-414A</span>: that is a new tag. The app suggests a free letter under the field, in the duplicate window and in the found list — tap it. On another page the same tag can be added as is.</p>`},
  fmt:{title:"Tag format — help",html:`
<p class="helpLead">The format is the rule the app uses to find tags in pasted text, files and photos and to check manual input. The choice is stored on this phone.</p>
<h3>ISA-5.1</h3>
<p>International instrument identification; the same letters are used in Russian GOST 21.208.</p>
<div class="isaTag" aria-label="Example: 21-PT-1001A"><span><b>21</b><small>unit</small></span><span><b>P</b><small>variable</small></span><span><b>T</b><small>function</small></span><span><b>1001</b><small>loop</small></span><span><b>A</b><small>suffix</small></span></div>
<ul>
${hLi(hT("1st"),"<b>Measured variable:</b> P pressure, T temperature, F flow, L level, A analysis, V vibration, Z position, H hand.")}
${hLi(hT("next"),"<b>Function:</b> T transmitter, I indicator, C controller, V valve, S switch, E primary element, Y relay/converter; H/L — high/low: <code>LSHH</code> — level switch high-high.")}
</ul>
<p><b>Unit</b> — digits before the letters, any length: <code>2131-PT-102</code>, <code>21-PT-1001</code>, <code>100-FT-0012</code>. Tabs are built from it. The <b>Unit</b> switch: “Any” — tags with and without a unit; “With” — only with a unit; “Without” — only <code>PT-101</code>.</p>
<h3>KKS</h3>
<p>Power plants: <code>10LBA10CP001</code> — unit 10, system LBA, sensor CP001. Tab — unit and system: “10LBA”.</p>
<h3>Own sample</h3>
<p>Enter a tag from your list — the rule is built automatically: the first digit group becomes the unit, the letters the instrument type. 2–3 samples separated by commas are fine.</p>
<h3>What is not a tag</h3>
<ul>
${hLi(hT("1 letter"),"Equipment and fasteners: <code>P-101</code> pump, <code>V-201</code> vessel, <code>M-20</code> bolt.")}
${hLi(hT("DN PN"),"Pipe size and pressure. Markings and standards: IP65, RS485, Pt100.")}
${hLi(hT("DWG"),"Document numbers: DWG, REV, ITP. Words like AREA 21, SKID 100.")}
</ul>
<h3>Fixed automatically</h3>
<p>Cyrillic in a tag → Latin: <code>РТ</code> → <code>PT</code>. In photos, in the number the letter O → 0, I and L → 1.</p>
<p class="helpNote"><b>Test on text</b> — paste a piece of a list: green — a tag, yellow — fixed, struck through — skipped; tap to see the reason.</p>`}
};
// Проверки на null: при обновлении браузер может на минуту взять старый index.html из кэша.
function openInfo(title,html){
  const ov=$("helpOverlay"),body=$("helpBody"),head=$("helpTitle");
  if(!ov||!body)return;
  if(head)head.textContent=title;
  body.innerHTML=html;
  body.scrollTop=0;
  ov.classList.add("show");
  initHelpPager(body);
}
// v106: справка в несколько страниц — листается свайпом в сторону (scroll-snap) или
// вкладками сверху; высота листалки — по текущей странице.
function initHelpPager(body){
  const pager=body.querySelector(".hpPager");
  if(!pager)return;
  const pages=[...pager.querySelectorAll(".hpPage")],tabs=[...body.querySelectorAll(".hpTab")],dots=[...body.querySelectorAll(".hpDots i")];
  const tabsBox=body.querySelector(".hpTabs");
  let cur=-1;
  const fit=()=>{const p=pages[Math.max(0,cur)];if(p)pager.style.height=p.offsetHeight+"px";};
  const setPage=i=>{
    if(i===cur)return;
    cur=i;
    tabs.forEach((t,k)=>{t.classList.toggle("active",k===i);t.setAttribute("aria-selected",String(k===i));});
    dots.forEach((d,k)=>d.classList.toggle("on",k===i));
    fit();
  };
  pager.addEventListener("scroll",()=>{
    const x=pager.scrollLeft/Math.max(1,pager.clientWidth);
    tabsBox?.style.setProperty("--hp",String(Math.min(pages.length-1,Math.max(0,x))));
    setPage(Math.round(x));
  },{passive:true});
  tabs.forEach(t=>t.addEventListener("click",()=>{
    const smooth=!matchMedia("(prefers-reduced-motion: reduce)").matches;
    pager.scrollTo({left:Number(t.dataset.page)*pager.clientWidth,behavior:smooth?"smooth":"auto"});
    body.scrollTo({top:0,behavior:smooth?"smooth":"auto"});
  }));
  setPage(0);
  requestAnimationFrame(fit);
}
function closeInfo(){$("helpOverlay")?.classList.remove("show");}
function openHelp(key){const h=(window.I18N?.en&&HELP_EN[key])||HELP[key];if(h)openInfo(h.title,h.html);}
document.addEventListener("click",e=>{
  const b=e.target.closest?.(".helpBtn[data-help]");
  if(!b)return;
  e.preventDefault();e.stopPropagation();
  openHelp(b.dataset.help);
});
if($("helpClose"))$("helpClose").onclick=closeInfo;
$("helpOverlay")?.addEventListener("click",e=>{if(e.target===$("helpOverlay"))closeInfo();});
// Esc закрывает только справку, окно под ней остаётся открытым.
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&$("helpOverlay")?.classList.contains("show")){closeInfo();e.stopImmediatePropagation();}
},true);

// ===== v105: формат тегов — кнопка у тумблера OCR, строка проверки под полем «Тег», меню «Формат тегов» =====
// Сам разбор — js/tag-format.js (TagFormat). Здесь — интерфейс и повторный разбор уже открытого текста.
let lastImport=null,lastOcrText="";
const FMT_SEEN_KEY="kip-tag-format-seen-v1";
function fmtModeName(){return TagFormat.name();}
function updateFmtButton(){
  const [l,s]=TagFormat.button(),btn=$("fmtBtn");if(!btn)return;
  $("fmtBtnLong").textContent=l;$("fmtBtnShort").textContent=s;
  btn.setAttribute("aria-label",TX("Формат тегов: {0}",fmtModeName()));btn.title=TX("Формат тегов: {0}",fmtModeName());
  btn.classList.toggle("isNew",!safeGetStorage(FMT_SEEN_KEY,""));
  tagInput.placeholder=TagFormat.placeholder();
  layoutAddHead();
}
// Шапка «Добавить»: заголовок, кнопка формата и OCR — в одну строку. Не помещается — короткие подписи,
// затем без слова «OCR»; совсем не помещается (крупный шрифт) — кнопки строкой ниже.
function layoutAddHead(){
  const tools=$("headTools"),t=$("modalTitleText");
  if(!tools||!t||!overlay.classList.contains("show"))return;
  if(!overlay.classList.contains("addMenu")){tools.classList.remove("compact","tight","stack");modalTitle.style.paddingRight="";return;}
  const padL=parseFloat(getComputedStyle(modalTitle).paddingLeft)||0;
  for(const step of [[],["compact"],["compact","tight"],["stack"]]){
    tools.classList.remove("compact","tight","stack");tools.classList.add(...step);
    if(step[0]==="stack"){modalTitle.style.paddingRight="84px";break;}
    const pr=91+tools.offsetWidth+12;modalTitle.style.paddingRight=pr+"px";
    if(t.offsetWidth<=modalTitle.clientWidth-pr-padL+.5)break;
  }
}
window.addEventListener("resize",()=>layoutAddHead(),{passive:true});
if(typeof ResizeObserver==="function"){try{new ResizeObserver(()=>layoutAddHead()).observe($("modalTitleText"));}catch(_){}}
(document.fonts?.ready||Promise.resolve()).then(()=>layoutAddHead());

// Строка под полем «Тег»: подходит ли тег и в какую вкладку попадёт.
function checkTagLine(){
  const el=$("tagCheck");if(!el)return;
  const v=tagInput.value;
  if(!v.trim()){el.className="tagCheck";el.textContent="";return;}
  const r=manualTagCheck(v);
  if(r&&r.ok){
    if(r.same){el.className="tagCheck";el.textContent="";return;}
    // v109: такой тег уже есть на странице — сразу сказать и предложить букву.
    const dup=findDuplicateTag(r.tag,editId);
    if(dup){
      const sug=dupSuffixSuggest(r.tag,new Set(data.map(x=>tagKey(x.tag))));
      el.className="tagCheck no";
      el.innerHTML=TX("Уже есть на этой странице (№{0}).",itemNo(dup))+" "+(sug?TX("Другой прибор с тем же номером — допишите букву: {0}",`<button class="dupFix" data-dup-fix="${escapeHtml(sug)}" type="button">${escapeHtml(sug)}</button>`):TX("Измените тег."));
      return;
    }
    el.className="tagCheck ok";
    el.innerHTML=`✓ <code>${escapeHtml(r.tag)}</code> → ${r.unit?TX("вкладка «{0}»",escapeHtml(r.unit)):TX("без установки")}${r.fixes&&r.fixes.length?TX(" · исправлено: {0}",escapeHtml(r.fixes.join(", "))):""}`;
  }else{el.className="tagCheck no";el.textContent=TX("Не подходит под формат «{0}»: {1}",fmtModeName(),TX(r?r.reason:"не похоже на тег"));}
}
tagInput.addEventListener("input",checkTagLine);

// Подпись формата в строке «найдено тегов…» и пустой результат с подсказкой.
function addFormatNote(el){
  if(!el)return;
  el.querySelector(".fmtNote")?.remove();
  el.insertAdjacentHTML("beforeend",` <span class="fmtNote">${TX("· формат <b>«{0}»</b>",escapeHtml(fmtModeName()))} <button class="fmtLink" data-fmt-open type="button">${TX("Изменить")}</button></span>`);
}
function emptyFormatHtml(text){
  const h=TagFormat.hint(TagFormat.scanNow(text||""),TagFormat.mode);
  return `<div class="mini">${TX("Тегов в формате «{0}» не найдено.",escapeHtml(fmtModeName()))} ${h?`${escapeHtml(h.text)} — <button class="fmtLink" data-fmt-set="${h.to}" type="button">${escapeHtml(h.btn)}</button>`:`<button class="fmtLink" data-fmt-open type="button">${TX("Сменить формат")}</button>`}</div>`;
}
// Заголовки «Вкладка «21»» в списке найденного — когда установок больше одной.
function importUnitHeaders(box,tags){
  const units=tags.map(t=>unitFromTag(t));
  if(new Set(units).size<2)return;
  const items=[...box.querySelectorAll(".importItem")];let last=null;
  items.forEach((row,i)=>{const u=units[i];if(u===last)return;last=u;
    const h=document.createElement("div");h.className="importUnit";h.textContent=u?TX("Вкладка «{0}»",u):TX("Без установки");row.before(h);});
}
document.addEventListener("click",e=>{
  const open=e.target.closest?.("[data-fmt-open]");if(open){e.preventDefault();openFmtMenu();return;}
  const set=e.target.closest?.("[data-fmt-set]");if(set){e.preventDefault();TagFormat.setMode(set.dataset.fmtSet);showToast(TX("Формат тегов: {0}",fmtModeName()));}
});
// Формат сменился — открытый текст (вставка, файл, фото) разбирается заново, без повторного распознавания.
function refreshImportsForFormat(){
  if(!overlay.classList.contains("show"))return;
  if(addMode==="file"&&lastImport&&$("fileForm").style.display!=="none"){processTextImport(lastImport.text,lastImport.label,72);return;}
  if((addMode==="camera"||addMode==="photo")&&lastOcrText){
    const records=extractTagRecordsFromText(lastOcrText);
    ocrCandidates=records.length?records.map(x=>x.tag):extractTagsSmart(lastOcrText);
    ocrCandidateMeta=new Map(records.map(x=>[tagKey(x.tag),{completed:!!x.done,task:x.task||"",score:0.65}]));
    $("ocrStatus").textContent=TX("Найдено кандидатов {0}. Проверь отметки и задания перед добавлением.",ocrCandidates.length);
    renderImportCandidates();
  }
}
TagFormat.onChange(()=>{updateFmtButton();checkTagLine();if($("fmtOverlay").classList.contains("show"))renderFmtMenu(false);refreshImportsForFormat();});

// ---- меню «Формат тегов» ----
function openFmtMenu(){
  safeSetStorage(FMT_SEEN_KEY,"1");$("fmtBtn")?.classList.remove("isNew");
  renderFmtMenu(true);$("fmtOverlay").classList.add("show");$("fmtSheet").scrollTop=0;
}
function closeFmtMenu(){$("fmtOverlay").classList.remove("show");}
const fmtFamily=()=>TagFormat.mode==="kks"?"kks":TagFormat.mode==="custom"?"custom":"isa";
function renderFmtMenu(full){
  const st=TagFormat.state,fam=fmtFamily(),isaMode=fam==="isa"?TagFormat.mode:st.isaLast;
  $("fmtIsa").checked=fam==="isa";$("fmtKks").checked=fam==="kks";$("fmtCustom").checked=fam==="custom";
  $("unitSeg").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.u===isaMode)));
  $("fmtIsaEx").textContent=TagFormat.FORMATS[isaMode].ex;
  const c=TagFormat.custom;
  $("fmtCustomEx").textContent=c.ok?c.rules.map(r=>r.src).join(", "):"";
  if(full){$("fmtExample").value=st.example||"";$("fmtCheck").open=!!st.check;renderFmtSamples();}
  renderRuleLine();renderFmtCheck();
}
function renderRuleLine(){
  const el=$("ruleLine"),st=TagFormat.state,c=TagFormat.custom;
  if(!String(st.example||"").trim()){el.className="ruleLine";el.textContent=TX("Например, 21-PT-1001 или 100-FT-0012A. Можно 2–3 через запятую.");return;}
  if(!c.ok){el.className="ruleLine err";el.textContent=c.error;return;}
  el.className="ruleLine";
  el.innerHTML=escapeHtml(TagFormat.describe(c)).replace(/(\d+ цифр[аы]? — установка|\d+ digits? — unit)/g,"<b>$1</b>");
}
$("fmtBtn").addEventListener("click",openFmtMenu);
$("fmtClose").addEventListener("click",closeFmtMenu);
$("fmtOverlay").addEventListener("click",e=>{if(e.target===$("fmtOverlay"))closeFmtMenu();});
$("fmtIsa").addEventListener("change",()=>TagFormat.setMode(TagFormat.state.isaLast||"auto"));
$("fmtKks").addEventListener("change",()=>TagFormat.setMode("kks"));
$("fmtCustom").addEventListener("change",()=>{TagFormat.setMode("custom");if(!String(TagFormat.state.example||"").trim())setTimeout(()=>$("fmtExample").focus(),30);});
$("unitSeg").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;e.preventDefault();TagFormat.setMode(b.dataset.u);});
$("fmtExample").addEventListener("focus",()=>{if(TagFormat.mode!=="custom")TagFormat.setMode("custom");});
$("fmtExample").addEventListener("input",()=>TagFormat.setExample($("fmtExample").value));
$("fmtCheck").addEventListener("toggle",()=>TagFormat.setPref("check",$("fmtCheck").open));
// Проверка на тексте: примеры и свой текст, подсветка найденного.
function renderFmtSamples(){
  const st=TagFormat.state,box=$("fmtSamples");
  const list=[...TagFormat.SAMPLES,{id:"own",name:"Свой текст"}];
  if(!list.some(x=>x.id===st.sample))st.sample="me";
  box.innerHTML=list.map(x=>`<button aria-pressed="${st.sample===x.id}" data-id="${x.id}" type="button">${escapeHtml(TX(x.name))}</button>`).join("");
}
$("fmtSamples").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;TagFormat.setPref("sample",b.dataset.id);
  $("fmtSamples").querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));renderFmtCheck();});
function fmtHighlight(text,res){
  const marks=[...res.found.map(x=>({...x,t:"ok"})),...res.skipped.map(x=>({...x,t:"no"}))].sort((a,b)=>a.start-b.start);
  let out="",p=0;
  for(const m of marks){
    if(m.start<p)continue;out+=escapeHtml(text.slice(p,m.start));const seg=escapeHtml(text.slice(m.start,m.end));
    out+=m.t==="ok"
      ?`<mark${m.fixes.length?' class="fix"':""} data-say="${escapeHtml(`${m.tag} → ${m.unit?TX("вкладка «{0}»",m.unit):TX("без установки")}${m.fixes.length?" · "+m.fixes.join(", "):""}`)}">${seg}</mark>`
      :`<s data-say="${escapeHtml(`${m.text.replace(/\s+/g," ")}: ${TX(m.reason)}`)}">${seg}</s>`;
    p=m.end;
  }
  return out+escapeHtml(text.slice(p));
}
function renderFmtCheck(){
  const st=TagFormat.state,wrap=$("fmtCheckWrap"),own=st.sample==="own";
  const text=own?String(st.own||""):(TagFormat.SAMPLES.find(x=>x.id===st.sample)||TagFormat.SAMPLES[1]).text;
  if(own){
    if(!$("fmtOwnText")){
      wrap.innerHTML=`<textarea aria-label="${escapeHtml(TX("Свой текст для проверки"))}" class="fmtOwn" id="fmtOwnText" placeholder="${escapeHtml(TX("Вставьте кусок своего перечня"))}" spellcheck="false"></textarea><div class="fmtPreview" hidden id="fmtPreview"></div>`;
      $("fmtOwnText").value=st.own||"";
      $("fmtOwnText").addEventListener("input",()=>{TagFormat.setPref("own",$("fmtOwnText").value);renderFmtCheck();});
    }
  }else wrap.innerHTML='<div class="fmtPreview" id="fmtPreview"></div>';
  const res=TagFormat.scanNow(text),pv=$("fmtPreview");
  pv.hidden=!text.trim();pv.innerHTML=fmtHighlight(text,res);
  const out=$("fmtRes");
  if(res.error){out.innerHTML=`<span class="zero">${escapeHtml(res.error)}</span>`;return;}
  if(!text.trim()){out.innerHTML='<span class="muted">'+TX('Найденные теги подсветятся зелёным.')+'</span>';return;}
  const noUnit=TX("без установки"),units=new Map();res.found.forEach(t=>units.set(t.unit||noUnit,(units.get(t.unit||noUnit)||0)+1));
  const h=TagFormat.hint(res,TagFormat.mode);
  out.innerHTML=`<b class="${res.found.length?"":"zero"}">${TX("Найдено тегов: {0}",res.found.length)}</b>${units.size?` → ${[...units].map(([u,n])=>`${escapeHtml(u)} (${n})`).join(" · ")}`:""}`
    +(res.skipped.length?`<br><span class="muted">${TX("Не взято: {0}. Коснитесь зачёркнутого — будет видна причина.",res.skipped.length)}</span>`:"")
    +(h?`<br>${escapeHtml(h.text)} — <button class="fmtLink" data-fmt-set="${h.to}" type="button">${escapeHtml(h.btn)}</button>`:"");
}
$("fmtCheckWrap").addEventListener("click",e=>{const m=e.target.closest("[data-say]");if(m)showToast(m.dataset.say);});
// Esc: справка поверх меню закрывается своим обработчиком выше; здесь — только меню формата.
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&$("fmtOverlay")?.classList.contains("show")&&!$("helpOverlay")?.classList.contains("show")){closeFmtMenu();e.stopImmediatePropagation();}
},true);
updateFmtButton();

document.querySelectorAll("[data-dry-kind]").forEach(btn=>btn.addEventListener("click",()=>openDryReport(btn.dataset.dryKind)));
$("dryListClose").onclick=()=>$("dryListOverlay").classList.remove("show");
$("dryListOverlay").addEventListener("click",e=>{if(e.target===$("dryListOverlay"))$("dryListOverlay").classList.remove("show")});
$("fullReportClose").onclick=closeDryReport;
$("fullReportOverlay").addEventListener("click",e=>{if(e.target===$("fullReportOverlay"))closeDryReport();});

let confirmResolver=null;

$("confirmOk").onclick=()=>finishConfirm(true);
$("confirmCancel").onclick=()=>finishConfirm(false);
$("confirmClose").onclick=()=>finishConfirm(false);
$("confirmOverlay").addEventListener("click",e=>{if(e.target===$("confirmOverlay"))finishConfirm(false)});

const THEME_ORDER=["light","dark","navy","green"];
const THEME_ICON={light:"☼",dark:"●",navy:"☾",green:"◒"};

$("docTitle").addEventListener("blur",()=>{
  if($("docTitle").getAttribute("contenteditable")==="true"){
    $("docTitle").setAttribute("contenteditable","false");
    $("docTitle").classList.remove("editing");
    saveDocumentTitle();
  }
});
$("docTitle").addEventListener("keydown",e=>{
  if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();}
});

document.addEventListener("input",event=>{
  if(event.target.matches(".taskBox textarea")){
    const row=event.target.closest(".row"),id=Number(row?.dataset.id),item=data.find(x=>x.id===id);
    if(item){
      item.task=event.target.value;scheduleSave();autosizeTaskTextarea(event.target);
      const toggle=row.querySelector(".taskToggle");
      if(toggle)toggle.classList.toggle("hasTask",!!String(item.task).trim());
    }
  }
});

// v81: касание текста в открытом поле переводит его в режим записи без сброса
// прокрутки и без изменения размеров при потере фокуса — поле больше не «прыгает».
document.addEventListener("focusin",event=>{
  if(event.target.matches(".taskBox textarea")){
    const ta=event.target,row=ta.closest(".row"),editor=ta.closest(".taskEditorWrap");
    document.body.classList.add("task-editing");
    if(row&&editor&&editor.classList.contains("open")&&!editor.classList.contains("editing")){
      const item=data.find(x=>x.id===Number(row.dataset.id));
      if(item)setTaskEditor(row,item,true,false,{editing:true,scrollTop:ta.scrollTop});
    }
    editor?.classList.add("focused");
    scheduleTaskEditorReveal(ta);
  }
});
document.addEventListener("focusout",event=>{
  if(event.target.matches(".taskBox textarea")){
    const ta=event.target,row=ta.closest(".row"),editor=ta.closest(".taskEditorWrap");
    document.body.classList.remove("task-editing");
    flushSave();
    if(row&&row.isConnected)renderTabs(false); // счётчик «Задания» после записи
    // v97: запись закончилась — «Сохранить» прячется, поле остаётся открытым для чтения.
    if(row&&row.isConnected&&editor?.classList.contains("open")&&editor.classList.contains("editing")){
      const item=data.find(x=>x.id===Number(row.dataset.id));
      if(item)setTaskEditor(row,item,true,false,{editing:false,scrollTop:ta.scrollTop});
    }
  }
});
// Кнопки «Сохранить»/«Задание» не забирают фокус у поля: клавиатура не прячется
// до нажатия, и касание не «уезжает» из-за сдвига экрана.
list.addEventListener("mousedown",e=>{if(e.target.closest(".taskSave")||(e.target.closest(".taskToggle")&&e.target.closest(".row")?.querySelector(".taskEditorWrap.editing")))e.preventDefault();});
list.addEventListener("pointerdown",e=>{if(e.pointerType!=="mouse"&&(e.target.closest(".taskSave")||(e.target.closest(".taskToggle")&&e.target.closest(".row")?.querySelector(".taskEditorWrap.editing"))))e.preventDefault();});

let searchRenderFrame=0;
$("search").addEventListener("input",e=>{
  query=e.target.value;
  renderSummary();
  if(searchRenderFrame)cancelAnimationFrame(searchRenderFrame);
  searchRenderFrame=requestAnimationFrame(()=>{searchRenderFrame=0;renderList();});
});
// v81: Enter в поиске прячет клавиатуру (результаты уже отфильтрованы).
$("search").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();}});
$("searchBtn").onclick=()=>{$("searchPanel").classList.add("show");try{$("search").focus({preventScroll:true});}catch(_){$("search").focus();}};
$("searchClose").onclick=()=>{query="";$("search").value="";$("searchPanel").classList.remove("show");renderSummary();renderList();};
$("fontMinus").onclick=()=>{
  let s=parseFloat(document.documentElement.style.getPropertyValue("--fontScale"))||1;
  s=Math.max(.65,Math.round((s-.1)*10)/10);document.documentElement.style.setProperty("--fontScale",s);safeSetStorage(FONT_KEY,s);
  requestAnimationFrame(refreshOpenTaskFields);
};
$("fontPlus").onclick=()=>{
  let s=parseFloat(document.documentElement.style.getPropertyValue("--fontScale"))||1;
  s=Math.min(1.35,Math.round((s+.1)*10)/10);document.documentElement.style.setProperty("--fontScale",s);safeSetStorage(FONT_KEY,s);
  requestAnimationFrame(refreshOpenTaskFields);
};
$("addBtn").onclick=openAdd;
$("exportAction").onclick=openExportMenu;
$("dryListBtn").onclick=()=>$("dryListOverlay").classList.add("show");
$("exportCloseBtn").onclick=closeExportMenu;
$("exportStateJsonShareBtn").onclick=shareCurrentStateJson;
$("exportStateJsonOpenBtn").onclick=openJsonStatePicker;
$("exportStateJsonSaveBtn").onclick=saveCurrentStateJson;
$("exportStateTextBtn").onclick=shareFullStateText;
// v102: окно «Отчёт».
if(!safeGetStorage(REPORT_SEEN_KEY,""))$("reportBtn").classList.add("isNew");
$("reportBtn").onclick=openReport;
$("reportCloseBtn").onclick=closeReport;
$("reportOverlay").addEventListener("click",e=>{if(e.target===$("reportOverlay"))closeReport();});
$("reportPages").addEventListener("click",e=>{
  const b=e.target.closest(".rpPage");if(!b)return;
  const id=b.dataset.pageId;
  reportState.pages=reportState.pages.includes(id)?reportState.pages.filter(x=>x!==id):[...reportState.pages,id];
  reportChanged();
});
$("reportAllPages").onclick=()=>{
  reportState.pages=reportState.pages.length===pages.length?[]:pages.map(p=>String(p.id));
  reportChanged();
};
document.querySelectorAll(".rpTile").forEach(t=>t.addEventListener("click",()=>{reportState.kind=t.dataset.reportKind;reportChanged();}));
$("reportWithTasks").addEventListener("change",e=>{reportState.withTasks=e.target.checked;reportChanged();});
$("reportPeople").addEventListener("click",e=>{
  if(e.target.closest("#reportAddPeople")){openReportPick();return;}
  const b=e.target.closest(".rpPerson");if(!b)return;
  const name=b.dataset.person;
  reportState.on=reportState.on.includes(name)?reportState.on.filter(x=>x!==name):[...reportState.on,name];
  reportChanged();
});
// v103/v104: двойное касание по тексту — правка на весь экран.
// iPhone открывает клавиатуру только от настоящего касания редактируемого поля — программный
// фокус (как было в v103) он игнорирует. Поэтому: одиночное касание гасится (поле только для чтения,
// без курсора и клавиатуры), а на втором касании поле становится редактируемым ещё до отпускания
// пальца — и это касание браузер обрабатывает сам: ставит курсор и открывает клавиатуру.
(()=>{
  const ta=$("reportText");
  let touch=null,last={t:0,x:0,y:0},armed=null,armTimer=0;
  const disarm=()=>{clearTimeout(armTimer);if(armed&&!reportEditing&&document.activeElement!==ta)ta.readOnly=true;armed=null;};
  ta.addEventListener("touchstart",e=>{
    if(reportEditing)return;
    if(e.touches.length!==1){touch=null;disarm();return;}
    const t=e.touches[0],now=Date.now();
    touch={x:t.clientX,y:t.clientY,t:now,moved:false};
    if(now-last.t<400&&Math.abs(t.clientX-last.x)<36&&Math.abs(t.clientY-last.y)<36){
      clearTimeout(armTimer);
      armed={pos:reportOffsetAtPoint(ta,t.clientX,t.clientY)};
      ta.readOnly=false;
    }
  },{passive:true});
  ta.addEventListener("touchmove",e=>{
    if(!touch)return;
    const t=e.touches[0];
    if(Math.abs(t.clientX-touch.x)>10||Math.abs(t.clientY-touch.y)>10){touch.moved=true;disarm();}
  },{passive:true});
  ta.addEventListener("touchend",e=>{
    if(reportEditing||!touch)return;
    const tt=touch;touch=null;
    // Прокрутка или долгое нажатие — не касание.
    if(tt.moved||Date.now()-tt.t>450){disarm();last={t:0,x:0,y:0};return;}
    if(armed){
      last={t:0,x:0,y:0};
      // Подстраховка: если браузер не поставил фокус сам — правка вручную.
      armTimer=setTimeout(()=>{if(armed&&!reportEditing){const pos=armed.pos;armed=null;enterReportEdit(pos);}},450);
      return;
    }
    e.preventDefault();
    last={t:Date.now(),x:tt.x,y:tt.y};
  },{passive:false});
  ta.addEventListener("touchcancel",()=>{touch=null;disarm();});
  // Фокус от касания редактируемого поля — правка. Окно перестраивается после того,
  // как браузер поставил курсор (на месте касания по прежней раскладке).
  ta.addEventListener("focus",()=>{
    if(reportEditing||ta.readOnly)return;
    clearTimeout(armTimer);
    const pos=armed?armed.pos:null;armed=null;
    setTimeout(()=>{if(document.activeElement===ta&&!reportEditing)enterReportEdit(pos,true);},0);
  });
  // Двойной щелчок мышью. После двойного касания браузер тоже присылает dblclick — к этому
  // моменту поле уже в фокусе от касания, и второй, программный фокус не нужен.
  ta.addEventListener("dblclick",e=>{
    if(reportEditing||(document.activeElement===ta&&!ta.readOnly))return;
    enterReportEdit(reportOffsetAtPoint(ta,e.clientX,e.clientY));
  });
  ta.addEventListener("keydown",e=>{if(!reportEditing&&e.key==="Enter"){e.preventDefault();enterReportEdit();}});
  ta.addEventListener("blur",()=>{if(reportEditing)exitReportEdit();else if(!armed)ta.readOnly=true;});
  // Кнопки не забирают фокус у поля во время правки: иначе окно перестраивается
  // (клавиатура уходит) до того, как сработает нажатие.
  const keepFocus=e=>{if(reportEditing&&(e.type==="mousedown"||e.pointerType!=="mouse"))e.preventDefault();};
  ["#reportSend","#reportEditDone","#reportEditState"].forEach(sel=>{
    const el=document.querySelector(sel);
    el.addEventListener("pointerdown",keepFocus);
    el.addEventListener("mousedown",keepFocus);
  });
  $("reportEditDone").onclick=()=>exitReportEdit();
})();
$("reportText").addEventListener("input",()=>{
  const fresh=diffReportOps(reportAutoLines,$("reportText").value);
  const keys=new Set(reportAutoLines.map(l=>l.k));keys.add("^");
  ["rep","del","ins"].forEach(kind=>{
    Object.keys(reportOps[kind]).forEach(k=>{if(keys.has(k))delete reportOps[kind][k];});
    Object.assign(reportOps[kind],fresh[kind]);
  });
  paintReportEditState();
});
$("reportEditState").addEventListener("click",e=>{
  if(!e.target.closest("#reportResetEdit"))return;
  reportOps={rep:{},del:{},ins:{}};
  regenerateReport();
});
$("reportSend").onclick=sendReport;
$("reportPickDone").onclick=()=>closeReportPick(true);
$("reportPickOverlay").addEventListener("click",e=>{if(e.target===$("reportPickOverlay"))closeReportPick(true);});
$("reportManualForm").addEventListener("submit",e=>{e.preventDefault();reportManualAdd();});
$("reportContactsBtn").onclick=reportPickFromContacts;
$("reportPickList").addEventListener("click",e=>{
  const f=e.target.closest(".rpForget");if(!f)return;
  e.preventDefault();
  reportPickCommitChecks();
  const name=f.dataset.forget;
  reportState.people=reportState.people.filter(x=>x!==name);
  reportState.on=reportState.on.filter(x=>x!==name);
  saveReportState();renderReportPickList();
});
// Случайное выделение вне полей ввода в окне отчёта снимается сразу (иначе iOS «заливает» плитку).
document.addEventListener("selectionchange",()=>{
  if(!$("reportOverlay").classList.contains("show"))return;
  try{
    const sel=getSelection();
    if(!sel||sel.isCollapsed||!sel.rangeCount)return;
    const n=sel.anchorNode,el=n&&(n.nodeType===1?n:n.parentElement);
    if(el&&el.closest("textarea,input"))return;
    const a=document.activeElement;
    if(a&&a.matches?.("textarea,input"))return;
    sel.removeAllRanges();
  }catch(_){}
});
$("exportAllBtn").onclick=()=>shareTextReport("all");
$("exportDoneBtn").onclick=()=>shareTextReport("done");
$("exportTodoBtn").onclick=()=>shareTextReport("todo");
$("exportTaskBtn").onclick=()=>shareTextReport("task");
$("exportOverlay").addEventListener("click",e=>{if(e.target===$("exportOverlay"))closeExportMenu();});
$("themeBtn").onclick=cycleTheme;
$("fontBtn").onclick=cycleFont;
$("addPageBtn").onclick=createPage;
$("pageManageEdit").onclick=()=>{
  if(selectedPageIds.size!==1){showToast(TX("Выбери одну страницу"));return;}
  editSelectedPage();
};
$("pageManageSelect").onclick=()=>selectAllPages();
$("pageManageDelete").onclick=()=>{if(selectedPageIds.size)deleteSelectedPages();};
$("pageManageClose").onclick=exitPageManage;
document.addEventListener("pointerdown",e=>{
  const menu=$("pageContextMenu");
  if(menu?.classList.contains("show")&&!menu.contains(e.target)&&!e.target.closest(".pageChip"))closePageContextMenu();
});
document.addEventListener("scroll",closePageContextMenu,{passive:true});
$("closeBtn").onclick=closeModal;

// v101: онлайн-распознавание (api.ocr.space, обычно — через VPN) включается тумблером OCR.space.
// Сам VPN страница увидеть не может, поэтому проверяем, отвечает ли сервис распознавания:
// отвечает — «Распознать» сразу отправляет фото; нет или ещё неизвестно — сначала окно
// «Включите сеть и VPN», отправка по «OK».
const OCR_PROBE_URL="https://api.ocr.space/parse/image";
const OCR_PROBE_TTL=120000;
let ocrNet={up:false,at:0,promise:null},pendingOcrPick=null;
function probeOcrNetwork(force=false){
  if(navigator.onLine===false){ocrNet={up:false,at:Date.now(),promise:null};return Promise.resolve(false);}
  if(ocrNet.promise)return ocrNet.promise;
  if(!force&&ocrNet.up&&Date.now()-ocrNet.at<OCR_PROBE_TTL)return Promise.resolve(true);
  const ctl=typeof AbortController==="function"?new AbortController():null;
  const timer=setTimeout(()=>ctl?.abort(),4000);
  // no-cors: любой ответ сервера = сервис доступен; сбой сети, блокировка, таймаут = недоступен.
  const p=fetch(OCR_PROBE_URL,{method:"GET",mode:"no-cors",cache:"no-store",credentials:"omit",signal:ctl?.signal})
    .then(()=>true,()=>false)
    .then(up=>{clearTimeout(timer);ocrNet={up,at:Date.now(),promise:null};return up;});
  ocrNet.promise=p;
  return p;
}
function ocrNetworkKnownUp(){return navigator.onLine!==false&&ocrNet.up&&Date.now()-ocrNet.at<OCR_PROBE_TTL;}
function closeNetWarning(){pendingOcrPick=null;$("netOverlay").classList.remove("show");}
function openPhotoPicker(mode){
  pendingPhotoMode=mode;
  $(mode==="camera"?"cameraInput":"photoInput").click();
}
$("netOk").onclick=()=>{const go=pendingOcrPick;closeNetWarning();if(go)go();};
$("netCancel").onclick=closeNetWarning;
$("netClose").onclick=closeNetWarning;
$("netOverlay").addEventListener("click",e=>{if(e.target===$("netOverlay"))closeNetWarning();});
// Esc закрывает только это окно, окно «Добавить прибор» под ним остаётся.
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&$("netOverlay").classList.contains("show")){closeNetWarning();e.stopImmediatePropagation();}
},true);
window.addEventListener("online",()=>{if(overlay.classList.contains("show"))probeOcrNetwork(true);});
let pendingPhotoMode="photo";
$("cameraChoice").onclick=()=>openPhotoPicker("camera");
$("photoChoice").onclick=()=>openPhotoPicker("photo");
// v101: «Файл» сразу открывает выбор файла, «Вставить» сразу вставляет из буфера обмена.
$("fileChoice").onclick=()=>$("importFileInput").click();
$("pasteChoice").onclick=pasteTextImport;
$("headOcrToggle").addEventListener("change",e=>setOcrEngine(e.target.checked));
$("ocrPickBtn").onclick=()=>openPhotoPicker(addMode==="camera"?"camera":"photo");
$("ocrRunBtn").onclick=runSelectedOcr;
$("ocrCropBtn").onclick=startOcrCrop;
$("ocrCropDone").onclick=applyOcrCrop;
$("ocrCropCancel").onclick=cancelOcrCrop;
$("ocrCropReset").onclick=()=>{if(!ocrPhoto)return;ocrCropEdit=ocrFullRect();drawOcrPhoto();};
wireOcrCrop();
$("ocrOnlineToggle").addEventListener("change",e=>setOcrEngine(e.target.checked));

$("ocrBackBtn").onclick=()=>{
  $("importList").innerHTML=""; $("importActions").style.display="none"; ocrCandidateMeta=new Map();
  $("ocrStatus").textContent=""; $("ocrProgressWrap").style.display="none";
  resetOcrPhoto();
  setAddMode("manual");
};
$("fileBackBtn").onclick=()=>{
  $("fileImportList").innerHTML="";$("fileImportActions").style.display="none";$("fileImportStatus").textContent="";
  $("fileProgressWrap").style.display="none";setFileProgress(0);
  setAddMode("manual");
};
updateOcrConfigStatus();
$("cameraInput").addEventListener("change",async e=>{
  const file=e.target.files && e.target.files[0]; e.target.value="";
  if(file){setAddMode("camera");showOcrPhoto(file);}
});
$("photoInput").addEventListener("change",async e=>{
  const file=e.target.files && e.target.files[0]; e.target.value="";
  if(file){setAddMode("photo");showOcrPhoto(file);}
});
$("importFileInput").addEventListener("change",event=>{
  const file=event.target.files&&event.target.files[0];event.target.value="";
  if(file){openFileReview();runFileImport(file);}
});
wireSheetGrip();
$("stateJsonInput").addEventListener("change",backupAndOpenJsonState);
// Android Chromium PWAs can receive .json files opened from the Files app.
// iOS Safari does not currently expose the same File Handling API; use the
// in-app "Открыть JSON" action there.
if("launchQueue" in window && typeof window.launchQueue.setConsumer==="function"){
  window.launchQueue.setConsumer(async launchParams=>{
    const handle=launchParams?.files?.[0];if(!handle)return;
    try{
      const file=await handle.getFile();
      await importJsonStateFile(file);
    }catch(e){showToast(TX.msg(e?.message)||TX("Не удалось открыть переданный JSON"));}
  });
}
$("importBtn").onclick=async()=>{try{await ensureOcrLoaded();importCandidates();}catch(err){showToast(TX.msg(err.message)||TX("Не удалось загрузить OCR"));}};
$("cancelImportBtn").onclick=()=>setAddMode("manual");
$("fileImportBtn").onclick=importFileCandidates;
$("cancelFileImportBtn").onclick=()=>setAddMode("manual");
$("duplicateEditBtn").onclick=()=>{
  const pending=pendingDuplicate?.pending;closeDuplicateDialog();
  if(pending){tagInput.value=pending.tag;manualTaskInput.value=pending.task||"";statusInput.value=pending.done?"done":"todo";setAddMode("manual");setTimeout(()=>tagInput.focus(),50);}
};
$("duplicateDeleteBtn").onclick=()=>{
  if(!pendingDuplicate)return;
  const pending=pendingDuplicate.pending,duplicateId=pendingDuplicate.duplicateId;
  data=data.filter(item=>item.id!==duplicateId);save();closeDuplicateDialog();
  editId=pending.editId;tagInput.value=pending.tag;manualTaskInput.value=pending.task||"";statusInput.value=pending.done?"done":"todo";
  if(editId!==null){
    const item=data.find(x=>x.id===editId);
    if(item){item.unit=pending.unit;item.tag=pending.tag;item.done=pending.done;item.task=pending.task||"";save();closeModal();render();showToast(TX("Дубликат удалён, запись обновлена"));return;}
  }
  const max=data.reduce((m,x)=>Math.max(m,Number(x.id)||0),0);data.push({id:max+1,unit:pending.unit,tag:pending.tag,done:pending.done,task:pending.task||""});save();closeModal();render();showToast(TX("Дубликат удалён, новый прибор добавлен"));
};
// v109: «Добавить как …A» — сохранить с первой свободной буквой.
$("duplicateSuffixBtn").onclick=()=>{
  const pd=pendingDuplicate;if(!pd||!pd.suggest)return;
  const pending=pd.pending,sug=pd.suggest;closeDuplicateDialog();
  const r=TagFormat.anyValid(sug);const tag=r&&r.ok?r.tag:sug,unit=(r&&r.unit)||pending.unit||"";
  editId=pending.editId;
  if(editId!==null){
    const item=data.find(x=>x.id===editId);
    if(item){item.unit=unit;item.tag=tag;item.done=pending.done;item.task=pending.task||"";}
  }else{
    const max=data.reduce((m,x)=>Math.max(m,Number(x.id)||0),0);
    data.push({id:max+1,unit,tag,done:pending.done,task:pending.task||""});
  }
  const wasEdit=editId!==null;
  save();closeModal();render();showToast(wasEdit?TX("Сохранено как {0}",tag):TX("Прибор добавлен как {0}",tag));
};
$("duplicateCloseBtn").onclick=closeDuplicateDialog;
$("duplicateOverlay").addEventListener("click",e=>{if(e.target===$("duplicateOverlay"))closeDuplicateDialog();});

$("saveBtn").onclick=saveModal;
deleteBtn.onclick=deleteCurrent;
overlay.addEventListener("click",e=>{if(e.target===overlay)closeModal();});
$("deleteAll").onclick=()=>{
  if(selectionMode){
    const visibleIds=new Set(getSelectionScope().map(item=>item.id));
    const ids=[...selectedTagIds].filter(id=>visibleIds.has(id));
    if(!ids.length){showToast(TX("Выбери теги в текущей вкладке"));return;}
    const set=new Set(ids);
    data=data.filter(item=>!set.has(item.id));
    selectedTagIds.clear();
    selectionMode=false;
    document.body.classList.remove("selection-mode-active");
    save();
    updateSelectionFooter();
    render();
    showToast(TX("Удалено тегов: {0}",ids.length));
    return;
  }
  const count=data.length;
  if(!count){showToast(TX("Список уже пуст"));return;}
  data=[];
  save();
  filter="all";
  render();
  showToast(TX("Удалено тегов: {0}",count));
};
$("markAllDone").onclick=()=>{
  if(!selectionMode)return;
  const scope=getSelectionScope();
  if(!scope.length){showToast(TX("В текущей вкладке нет тегов"));return;}
  const allSelected=scope.every(item=>selectedTagIds.has(item.id));
  if(allSelected){
    scope.forEach(item=>selectedTagIds.delete(item.id));
    showToast(TX("Выбор снят в текущей вкладке"));
  }else{
    scope.forEach(item=>selectedTagIds.add(item.id));
    showToast(TX("Выбраны все теги текущей вкладки: {0}",scope.length));
  }
  updateSelectionFooter();renderList();
};

$("clearChecks").onclick=()=>{
  if(!selectionMode)return;
  const selected=getSelectionScope().filter(item=>selectedTagIds.has(item.id));
  if(!selected.length){showToast(TX("Выбери теги в текущей вкладке"));return;}
  const allDone=selected.every(item=>item.done);
  selected.forEach(item=>item.done=!allDone);
  save();
  selectedTagIds.clear();
  setSelectionMode(false);
  render();
  showToast(allDone?TX("Снят статус «Выполнено»: {0}",selected.length):TX("Отмечено выполненными: {0}",selected.length));
};
document.addEventListener("selectstart",e=>{
  // selectstart может прийти на текстовый узел — у него нет closest().
  const el=e.target?.nodeType===1?e.target:e.target?.parentElement;
  if(!el)return;
  if(el.closest("input,textarea,select,[contenteditable=true]")) return;
  if(el.closest("button,.pageChip,.tab,.row,.utilityRow,.footer,.fab,.searchClose")) e.preventDefault();
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if($("reportPickOverlay")?.classList.contains("show")){closeReportPick(true);return;}if(reportEditing){exitReportEdit();return;}closeReport();closeModal();closeDuplicateDialog();closeExportMenu();if(selectionMode){setSelectionMode(false);}$("dryListOverlay").classList.remove("show");closeDryReport();if(confirmResolver)finishConfirm(false);}});

// Enter в поле тега сохраняет запись и закрывает клавиатуру;
// в многострочном задании сохранение выполняется по Ctrl/Cmd+Enter.
tagInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();tagInput.blur();saveModal();}});
manualTaskInput.addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();manualTaskInput.blur();saveModal();}});

// v58: браузеры Android иногда оставляют старые размеры viewport после поворота.
// Даём движку один кадр на перерасчёт, не меняя данные и не трогая активное поле ввода.
let viewportRefreshTimer=0;
let lastViewportWidth=Math.round(window.innerWidth||0);

window.addEventListener("orientationchange",()=>requestAnimationFrame(refreshAfterViewportChange),{passive:true});
window.addEventListener("resize",()=>{ if(Math.abs((window.innerWidth||0)-((window.visualViewport&&window.visualViewport.width)||window.innerWidth))>2) return; refreshAfterViewportChange(); },{passive:true});
if(window.visualViewport) window.visualViewport.addEventListener("resize",refreshAfterViewportChange,{passive:true});

// OCR is loaded only when the user opens the camera/photo OCR path.
let ocrLoadPromise=null;
function ensureOcrLoaded(){
  if(window.runOCR && window.importCandidates) return Promise.resolve();
  if(ocrLoadPromise) return ocrLoadPromise;
  ocrLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    const src=new URL("./js/ocr.js",document.baseURI).href;
    let settled=false;
    const done=()=>{if(settled)return;settled=true;resolve();};
    const fail=()=>{
      if(settled)return;
      settled=true;
      script.remove();
      reject(new Error(TX("Не удалось загрузить OCR-модуль. Проверьте, что файл js/ocr.js опубликован на GitHub Pages.")));
    };
    script.async=true;
    script.src=src;
    script.onload=done;
    script.onerror=fail;
    document.head.appendChild(script);
  }).catch(err=>{ocrLoadPromise=null;throw err;});
  return ocrLoadPromise;
}

// PWA installation.
// Chromium-based browsers can provide the native install prompt via beforeinstallprompt.
// iOS does not expose that event: the button gives the native Safari/Chrome installation path.
let deferredInstallPrompt=null;
const installAppBtn=$("installApp");

if(installAppBtn && isStandaloneApp()){
  hideInstallButton();
}

window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  if(installAppBtn && !isStandaloneApp()) installAppBtn.hidden=false;
});

if(installAppBtn){
  installAppBtn.onclick=async()=>{
    if(isStandaloneApp()){
      hideInstallButton();
      return;
    }
    if(!deferredInstallPrompt){
      showInstallFallback();
      return;
    }

    const promptEvent=deferredInstallPrompt;
    deferredInstallPrompt=null;
    try{
      const choice=await promptEvent.prompt();
      if(choice?.outcome==="accepted"){
        installAppBtn.hidden=true;
      }
      await promptEvent.userChoice.catch(()=>null);
    }catch(_){
      // Не меняем остальной интерфейс приложения при сбое системного prompt.
    }
  };
}

window.addEventListener("appinstalled",hideInstallButton);

const savedFont=parseFloat(safeGetStorage(FONT_KEY,null));
if(savedFont) document.documentElement.style.setProperty("--fontScale",savedFont);
const savedFontFamily=safeGetStorage(FONT_FAMILY_KEY,"system")||"system";
applyFontFamily(savedFontFamily,false);
applyTheme(safeGetStorage(THEME_KEY,"dark")||"dark");
applyDocumentTitle();
refreshAfterViewportChange();
if($("search")) $("search").value=query;
render();

// v96: разделы «Теги · Газ · 4–20» (v106: + «Электроэнергетика»). Переключатель в шапке,
// у конверторов — свои модули, они загружаются по требованию (и заранее, когда устройство свободно).
const VIEW_ORDER=["list","gas","loop","elec"];
const VIEW_MODULES={
  gas:{file:"./js/gas.js",global:"TagListGas",el:"gasView",title:"Газоанализ",name:"конвертор газоанализа"},
  loop:{file:"./js/loop.js",global:"TagListLoop",el:"loopView",title:"Токовая петля",name:"конвертор 4–20 мА"},
  elec:{file:"./js/elec.js",global:"TagListElec",el:"elecView",title:"Электроэнергетика",name:"конвертор электроэнергетики"}
};
const viewLoads={};
let currentView="list",viewHistoryPushed=false;
// v100: надёжность переключателя разделов.
// • Побеждает последнее касание: пока грузится модуль одного раздела, другие разделы
//   открываются сразу, а запоздавшая загрузка уже ничего не переключает.
//   (Раньше переключатель на время загрузки глох, а если файл не приходил — навсегда.)
// • Загрузка модуля ограничена по времени — после неё можно повторить попытку.
// • В APK системное «Назад» обрабатывает приложение (__tagListBack) — записи в истории
//   браузера там не нужны и не создаются.
let viewRequestSeq=0;
const VIEW_LOAD_TIMEOUT_MS=12000;
const VIEW_NATIVE_BACK=!!window.AndroidApp;
function ensureViewModule(view){
  const mod=VIEW_MODULES[view];
  if(window[mod.global])return Promise.resolve(window[mod.global]);
  if(viewLoads[view])return viewLoads[view];
  viewLoads[view]=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    let timer=0;
    const fail=msg=>{clearTimeout(timer);script.onload=script.onerror=null;script.remove();reject(new Error(msg));};
    script.src=new URL(mod.file,document.baseURI).href;
    script.async=true;
    script.onload=()=>{clearTimeout(timer);window[mod.global]?resolve(window[mod.global]):reject(new Error(TX("Не удалось запустить {0}",TX(mod.name))));};
    script.onerror=()=>fail(TX("Не удалось загрузить {0} ({1}). Проверь, что файл опубликован вместе с приложением.",TX(mod.name),mod.file.slice(2)));
    timer=setTimeout(()=>{
      if(window[mod.global]){resolve(window[mod.global]);return;}
      fail(TX("Не удалось загрузить {0}: нет ответа. Попробуй ещё раз.",TX(mod.name)));
    },VIEW_LOAD_TIMEOUT_MS);
    document.head.appendChild(script);
  }).catch(err=>{delete viewLoads[view];throw err;});
  return viewLoads[view];
}
// Совместимость с прежним названием.
function ensureGasLoaded(){return ensureViewModule("gas");}
function allTagNames(){
  const out=[];
  try{pages.forEach(page=>(page.id===activePageId?data:page.data||[]).forEach(x=>{if(x&&x.tag)out.push(String(x.tag));}));}catch(_){}
  return out;
}
// v106: переключатель разделов — одна кнопка текущего раздела («Т», «Газ», «4–20», молния).
// Касание раскрывает выбор влево в той же строке; после выбора он сворачивается сам через
// 3 с без касаний. Касание текущего раздела, касание мимо, Esc и «Назад» сворачивают сразу.
const VIEW_SWITCH_DELAY_MS=3000;
let viewSwitchOpen=false,viewSwitchTimer=0;
function setViewSwitchOpen(on){
  on=!!on;
  clearTimeout(viewSwitchTimer);
  const nav=$("viewSwitch");
  if(!nav)return;
  if(on!==viewSwitchOpen){
    viewSwitchOpen=on;
    nav.classList.toggle("open",on);
    nav.closest(".titleRow")?.classList.toggle("swOpen",on);
    nav.querySelectorAll(".viewSwitchBtn").forEach(b=>{
      b.setAttribute("aria-expanded",String(on));
      b.tabIndex=on||b.dataset.view===currentView?0:-1;
    });
  }
  if(on)armViewSwitch();
}
function armViewSwitch(){
  clearTimeout(viewSwitchTimer);
  const bar=$("viewSwitchTimer");
  if(bar){bar.classList.remove("run");void bar.offsetWidth;bar.classList.add("run");}
  viewSwitchTimer=setTimeout(()=>setViewSwitchOpen(false),VIEW_SWITCH_DELAY_MS);
}
// v100: въезд раздела — та же анимация (сдвиг 18 px + прозрачность, время и кривая из
// --ui-motion / --ui-ease), но через Web Animations: без принудительного пересчёта
// раскладки (void el.offsetWidth) на каждый элемент и без «залипания» после окончания.
const viewAnims=new WeakMap();
let viewMotion=null;
function viewMotionParams(){
  if(viewMotion)return viewMotion;
  let ms=340,ease="cubic-bezier(.16,1,.3,1)",reduce=false;
  try{
    const cs=getComputedStyle(document.documentElement);
    const raw=String(cs.getPropertyValue("--ui-motion")||"").trim();
    const n=parseFloat(raw);
    if(Number.isFinite(n))ms=/ms$/.test(raw)?n:n*1000;
    ease=String(cs.getPropertyValue("--ui-ease")||"").trim()||ease;
    reduce=!!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }catch(_){}
  viewMotion={ms,ease,reduce};
  return viewMotion;
}
try{window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change",()=>{viewMotion=null;});}catch(_){}
function playViewIn(el,from){
  if(!el)return;
  const prev=viewAnims.get(el);
  if(prev){try{prev.cancel();}catch(_){}viewAnims.delete(el);}
  const m=viewMotionParams();
  if(m.reduce||m.ms<20||typeof el.animate!=="function")return;
  try{
    const a=el.animate([{opacity:0,transform:from},{opacity:1,transform:"none"}],{duration:m.ms,easing:m.ease,fill:"backwards"});
    viewAnims.set(el,a);
    a.onfinish=()=>{if(viewAnims.get(el)===a)viewAnims.delete(el);};
  }catch(_){}
}
function updateViewChrome(prev){
  document.querySelectorAll(".viewSwitchBtn").forEach(b=>{
    const on=b.dataset.view===currentView;
    b.classList.toggle("active",on);
    if(on)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");
    b.tabIndex=on||viewSwitchOpen?0:-1;
  });
  const titleEl=$("viewTitle"),docEl=$("docTitle");
  const mod=VIEW_MODULES[currentView];
  if(titleEl){titleEl.textContent=mod?TX(mod.title):"";titleEl.hidden=!mod;}
  if(docEl)docEl.hidden=!!mod;
  document.body.classList.toggle("conv-mode",!!mod);
  for(const key of Object.keys(VIEW_MODULES))document.body.classList.toggle(`${key}-mode`,currentView===key);
  document.body.dataset.view=currentView;
  if(currentView==="list")requestAnimationFrame(updateTabsFade);
  // Направление анимации: вправо по порядку разделов — новый раздел въезжает справа.
  const dx=VIEW_ORDER.indexOf(currentView)>VIEW_ORDER.indexOf(prev)?18:-18;
  const shift=`translate3d(${dx}px,0,0)`;
  const targets=mod?[$(mod.el)]:[document.querySelector(".summaryCard"),...listAnimTargets()];
  targets.push(document.querySelector(currentView==="list"?"#lastSaved":`#${currentView}Sub`));
  targets.forEach(el=>playViewIn(el,shift));
  playViewIn($("appTitle"),"translate3d(0,6px,0)");
}
// v100: длинный список въезжает так же, но анимируются только строки на экране
// (после переключения список всегда открыт сверху). Анимация всего списка из тысяч
// строк заставляла браузер дважды перестраивать слои всей страницы — до 1–2 с «зависания»
// при возврате к «Тэгам» на телефоне. Короткий список анимируется целиком, как раньше.
const LIST_ANIM_WHOLE_MAX=60;
function listAnimTargets(){
  const el=$("list");
  if(!el)return [];
  if(el.childElementCount<=LIST_ANIM_WHOLE_MAX)return [el];
  const onScreen=Math.ceil((window.innerHeight||800)/28)+4;
  return Array.prototype.slice.call(el.children,0,onScreen);
}
// Ровно один раздел на экране — даже если прошлое переключение прервалось ошибкой.
function applyViewSections(){
  for(const [key,mod] of Object.entries(VIEW_MODULES)){
    const el=$(mod.el);
    if(el&&el.hidden!==(key!==currentView))el.hidden=key!==currentView;
  }
}
async function setView(view,{fromHistory=false}={}){
  if(!VIEW_ORDER.includes(view))return;
  const seq=++viewRequestSeq;
  if(view===currentView)return;
  const mod=VIEW_MODULES[view];
  let api=mod?window[mod.global]||null:null;
  if(mod&&!api){
    try{api=await ensureViewModule(view);}
    catch(e){if(seq===viewRequestSeq)showToast(e?.message||TX("Не удалось открыть раздел"));return;}
    // Пока модуль грузился, пользователь выбрал другой раздел — его выбор важнее.
    if(seq!==viewRequestSeq||view===currentView)return;
  }
  // Модуль уже загружен — переключение выполняется сразу, в том же касании.
  switchViewNow(view,api,fromHistory);
}
function switchViewNow(view,api,fromHistory){
  const prev=currentView;
  if(prev==="list"){
    try{
      if(selectionMode)setSelectionMode(false);
      if(pageManageMode)exitPageManage();
      cancelLongPress();cancelPageLongPress();
    }catch(e){console.warn("Tag list: list cleanup",e);}
    if(savePending)flushSave();
  }
  const active=document.activeElement;
  if(active&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))active.blur();
  if(VIEW_MODULES[prev]){
    try{window[VIEW_MODULES[prev].global]?.onHide?.();}catch(e){console.warn("Tag list: onHide",e);}
  }
  currentView=view;
  let mounted=true;
  if(api){
    try{api.mount($(VIEW_MODULES[view].el),{getTags:allTagNames});}
    catch(e){mounted=false;console.warn("Tag list: mount",e);}
  }
  applyViewSections();
  updateViewChrome(prev);
  window.scrollTo(0,0);
  syncViewHistory(view,fromHistory);
  if(api&&mounted){
    try{api.onShow?.();}catch(e){console.warn("Tag list: onShow",e);}
  }else if(api){
    showToast(TX("Не удалось открыть {0}",TX(VIEW_MODULES[view].name)));
  }
}
// История (только браузер/PWA): из списка в конвертор — одна новая запись (системное
// «Назад» вернёт к списку), между конверторами — та же запись, к списку — шаг назад.
// v100: шаг назад асинхронный. Если пока он идёт открыть конвертор, новая запись
// создаётся только после возврата (popstate) — иначе браузер «откатывал» только что
// открытый раздел обратно в список.
let viewPopPending=false,viewPopTimer=0;
function syncViewHistory(view,fromHistory){
  if(VIEW_NATIVE_BACK)return;
  try{
    if(fromHistory){viewHistoryPushed=view!=="list"&&history.state?.tagListView===view;return;}
    if(viewPopPending)return; // запись поправит finishViewPop()
    if(view==="list"){
      if(viewHistoryPushed&&history.state?.tagListView){
        viewHistoryPushed=false;viewPopPending=true;
        clearTimeout(viewPopTimer);viewPopTimer=setTimeout(finishViewPop,1500);
        history.back();
      }
    }else if(viewHistoryPushed&&history.state?.tagListView){
      // Между конверторами запись не переписываем: «Назад» всё равно ведёт к «Тэгам»,
      // а replaceState на телефоне стоит десятки миллисекунд на каждое переключение.
    }else{
      history.pushState({...(history.state||{}),tagListView:view},"");viewHistoryPushed=true;
    }
  }catch(_){viewHistoryPushed=false;}
}
function finishViewPop(){
  clearTimeout(viewPopTimer);
  if(!viewPopPending)return;
  viewPopPending=false;
  // Пока шёл возврат, пользователь мог снова открыть конвертор — восстанавливаем запись.
  if(currentView!=="list")syncViewHistory(currentView,false);
}
// v96: результат конвертора записывается в задание тега. Тег ищется на всех страницах
// (сначала на текущей); если его нет — создаётся на последней открытой странице.
function resultTagKey(t){return tagKey(t).replace(/[ТРЕАСКМНОХВ]/g,ch=>({"Т":"T","Р":"P","Е":"E","А":"A","С":"C","К":"K","М":"M","Н":"H","О":"O","Х":"X","В":"B"})[ch]);}
function addResultToTag(tag,text){
  const name=String(tag||"").replace(/\s+/g," ").trim();
  if(!name)return {ok:false,message:TX("Укажите тег")};
  const key=resultTagKey(name);
  let page=null,item=null;
  for(const pg of [getActivePage(),...pages.filter(p=>p.id!==activePageId)]){
    if(!pg)continue;
    const arr=pg.id===activePageId?data:(pg.data||[]);
    const found=arr.find(x=>resultTagKey(x.tag)===key);
    if(found){page=pg;item=found;break;}
  }
  const stamp=new Date().toLocaleString(LOC(),{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).replace(",","");
  const entry=`${stamp} — ${String(text||"").trim()}`;
  let created=false;
  if(item){
    const prev=String(item.task||"").replace(/\s+$/,"");
    item.task=prev?`${prev}\n${entry}`:entry;
    if(page&&page.id!==activePageId)page.updatedAt=new Date().toISOString();
  }else{
    const max=data.reduce((m,x)=>Math.max(m,Number(x.id)||0),0);
    const tagName=plainTagName(name)||name;
    item={id:max+1,unit:unitFromTag(tagName),tag:tagName,done:false,task:entry};
    data.push(item);page=getActivePage();created=true;
  }
  save();render();
  return {ok:true,created,tag:item.tag,page:page?.name||""};
}

// v97: выбор тега в конверторах — подсказки под полем вместо <datalist>.
// Системный выпадающий список в Android WebView рисовался поверх шапки и результатов
// полупрозрачным слоем. Теперь: ввод/вставка → совпадения прямо под полем → касание
// подтверждает. Нет такого тега — он будет создан на последней открытой странице.
function tagSearchKey(t){return resultTagKey(t).replace(/[^A-Z0-9]/g,"");}
// Новый тег из конвертора: верхний регистр и обычные дефисы, без «исправлений» OCR.
// Похожий на позиционное обозначение тег (2131-PT-450) пишется латиницей,
// даже если набран кириллицей с той же раскладкой букв (Р, Т, Е, А…).
const FULL_TAG_RE=/^\d{3,5}-[A-Z]{1,8}-?\d{3,5}[A-Z]{0,2}$/;
function plainTagName(t){
  const up=String(t||"").trim().toUpperCase().replace(/[–—−_]/g,"-").replace(/\s+/g,"");
  // v105: тег в любом известном формате — в канонический вид (латиница, дефисы).
  const r=window.TagFormat?TagFormat.anyValid(up):null;
  if(r&&r.ok)return r.tag;
  const latin=resultTagKey(up);
  return FULL_TAG_RE.test(latin)?latin:up;
}
// v100: перечень тегов всех страниц строится один раз на версию данных, а не на каждое
// открытие конвертора и каждый введённый символ (на тысячах тегов это заметные паузы).
let tagEntriesCache=null;
function tagEntriesSignature(){
  let n=0;for(const pg of pages)n+=(pg.id===activePageId?data:(pg.data||[])).length;
  return `${tagIndexVersion|0}|${activePageId}|${pages.length}|${n}`;
}
function tagEntries(){
  const sig=tagEntriesSignature();
  if(tagEntriesCache&&tagEntriesCache.sig===sig)return tagEntriesCache.list;
  const out=[],byKey=new Map();
  const order=[getActivePage(),...pages.filter(p=>p.id!==activePageId)];
  for(const pg of order){
    if(!pg)continue;
    for(const x of (pg.id===activePageId?data:(pg.data||[]))){
      const tag=String(x?.tag||"").trim();
      if(!tag)continue;
      const key=resultTagKey(tag);
      if(byKey.has(key))continue;
      const e={tag,key,search:tagSearchKey(tag),page:pg.name,active:pg.id===activePageId};
      byKey.set(key,e);
      out.push(e);
    }
  }
  tagEntriesCache={sig,list:out,byKey};
  return out;
}
function findTagEntry(value){
  const key=resultTagKey(String(value||"").replace(/\s+/g," ").trim());
  if(!key)return null;
  tagEntries();
  return tagEntriesCache.byKey.get(key)||null;
}
function activePageName(){return getActivePage()?.name||"";}
function highlightMatch(tag,q){
  // Подсвечиваем введённую часть (без учёта дефисов, регистра и кириллицы-двойников).
  if(!q)return escapeHtml(tag);
  const chars=[...tag],map=[];let norm="";
  chars.forEach((ch,i)=>{const k=tagSearchKey(ch);if(k){norm+=k;map.push(i);}});
  const at=norm.indexOf(q);
  if(at<0)return escapeHtml(tag);
  const from=map[at],to=map[at+q.length-1];
  return escapeHtml(chars.slice(0,from).join(""))+"<mark>"+escapeHtml(chars.slice(from,to+1).join(""))+"</mark>"+escapeHtml(chars.slice(to+1).join(""));
}
function attachTagPicker(input,opts={}){
  if(!input||input.__tagPicker)return input?.__tagPicker;
  input.removeAttribute("list");
  input.setAttribute("autocomplete","off");
  input.setAttribute("aria-autocomplete","list");
  const anchor=opts.anchor||input;
  const box=document.createElement("div");
  box.className="tagSuggest";box.hidden=true;box.setAttribute("role","listbox");
  box.id=(input.id||"tag")+"Suggest";
  input.setAttribute("aria-controls",box.id);
  const info=document.createElement("div");
  info.className="tagPickInfo";info.hidden=true;info.setAttribute("aria-live","polite");
  anchor.after(box,info);
  const limit=opts.limit||5;
  let items=[],kbd=-1,hideTimer=0,silent=false;

  function rank(entries,q){
    const res=[];
    for(const e of entries){
      const i=e.search.indexOf(q);
      if(i<0)continue;
      // Точное совпадение → начало номера после установки → начало → вхождение.
      const tail=e.search.replace(/^\d{3,5}/,"");
      const r=e.search===q?0:(tail.startsWith(q)||e.search.startsWith(q))?1:2;
      res.push({e,r,boost:typeof opts.boost==="function"?opts.boost(e.tag):0});
    }
    res.sort((a,b)=>a.r-b.r||b.boost-a.boost||(b.e.active-a.e.active)||a.e.tag.localeCompare(b.e.tag,"ru",{numeric:true}));
    return res.slice(0,limit).map(x=>x.e);
  }
  function renderInfo(){
    const v=String(input.value||"").trim();
    if(!v){info.hidden=true;info.className="tagPickInfo";info.innerHTML="";return;}
    const hit=findTagEntry(v);
    if(hit){
      info.className="tagPickInfo";
      info.innerHTML=`<span class="tpMark" aria-hidden="true">✓</span><span>${TX("В списке · {0}",escapeHtml(hit.page))}</span>`;
    }else{
      info.className="tagPickInfo isNew";
      info.innerHTML=`<span class="tpMark" aria-hidden="true">+</span><span>${TX("Новый тег — появится на странице «<b>{0}</b>» при записи в задание",escapeHtml(activePageName()))}</span>`;
    }
    info.hidden=false;
  }
  function close(){clearTimeout(hideTimer);box.hidden=true;box.innerHTML="";items=[];kbd=-1;input.setAttribute("aria-expanded","false");}
  function open(){
    const raw=String(input.value||"").replace(/\s+/g," ").trim();
    const q=tagSearchKey(raw);
    if(!q||document.activeElement!==input){close();renderInfo();return;}
    const entries=tagEntries();
    const exact=entries.find(e=>e.key===resultTagKey(raw));
    const found=rank(entries,q);
    items=found.map(e=>({tag:e.tag,page:e.page,isNew:false}));
    // «Новый тег» предлагается, когда совпадений нет или введён полный тег.
    const fresh=plainTagName(raw);
    if(!exact&&(!found.length||FULL_TAG_RE.test(fresh)))items.push({tag:fresh,page:activePageName(),isNew:true});
    if(!items.length){close();renderInfo();return;}
    // Единственное точное совпадение уже введено — список не нужен.
    if(exact&&items.length===1&&items[0].tag===raw){close();renderInfo();return;}
    kbd=-1;
    box.innerHTML=items.map((it,i)=>it.isNew
      ?`<button type="button" class="tagSuggestItem isNew" role="option" data-i="${i}"><span class="tsPlus" aria-hidden="true">+</span><span class="tsTag">${escapeHtml(it.tag)}</span><span class="tsPage">${TX("новый · {0}",escapeHtml(it.page))}</span></button>`
      :`<button type="button" class="tagSuggestItem" role="option" data-i="${i}"><span class="tsTag">${highlightMatch(it.tag,q)}</span><span class="tsPage">${escapeHtml(it.page)}</span></button>`).join("");
    box.hidden=false;input.setAttribute("aria-expanded","true");
    info.hidden=true; // пока открыт список, строка-подсказка не нужна
    keepVisible();
  }
  function keepVisible(){
    // Список под полем должен оставаться над клавиатурой, а поле — под шапкой.
    requestAnimationFrame(()=>{
      if(box.hidden)return;
      const vv=window.visualViewport;
      const top=vv?vv.offsetTop:0,height=vv?vv.height:window.innerHeight;
      const head=document.querySelector(".top");
      const headBottom=head&&getComputedStyle(head).position==="sticky"?Math.max(0,head.getBoundingClientRect().bottom-top):0;
      const ir=input.getBoundingClientRect(),br=box.getBoundingClientRect();
      const over=br.bottom-(top+height-10);
      if(over<=0)return;
      const room=ir.top-(top+headBottom+10);
      const dy=Math.min(over,Math.max(0,room));
      if(dy>2)window.scrollBy(0,dy);
    });
  }
  function pick(i){
    const it=items[i];if(!it)return;
    silent=true;
    input.value=it.tag;
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
    silent=false;
    close();renderInfo();
    try{input.blur();}catch(_){}
    if(typeof opts.onPick==="function")opts.onPick(it.tag,{isNew:it.isNew,page:it.page});
  }
  function setKbd(i){
    const btns=box.querySelectorAll(".tagSuggestItem");
    if(!btns.length)return;
    kbd=(i+btns.length)%btns.length;
    btns.forEach((b,j)=>{b.classList.toggle("kbd",j===kbd);b.setAttribute("aria-selected",String(j===kbd));});
  }
  input.addEventListener("input",()=>{if(!silent)open();});
  input.addEventListener("focus",()=>{clearTimeout(hideTimer);open();});
  input.addEventListener("blur",()=>{hideTimer=setTimeout(()=>{close();renderInfo();},180);});
  input.addEventListener("keydown",e=>{
    if(e.key==="ArrowDown"&&!box.hidden){e.preventDefault();setKbd(kbd+1);return;}
    if(e.key==="ArrowUp"&&!box.hidden){e.preventDefault();setKbd(kbd-1);return;}
    if(e.key==="Escape"&&!box.hidden){e.preventDefault();e.stopPropagation();close();return;}
    if(e.key==="Enter"&&!box.hidden&&items.length){
      // Enter подтверждает выделенную или первую подсказку (точное совпадение — первое).
      e.preventDefault();
      pick(kbd>=0?kbd:0);
    }
  });
  // Касание подсказки не уводит фокус раньше времени — список не исчезает из-под пальца.
  box.addEventListener("pointerdown",e=>{if(e.target.closest(".tagSuggestItem"))e.preventDefault();});
  box.addEventListener("mousedown",e=>{if(e.target.closest(".tagSuggestItem"))e.preventDefault();});
  box.addEventListener("click",e=>{
    const b=e.target.closest(".tagSuggestItem");
    if(b)pick(Number(b.dataset.i));
  });
  const api={refresh(){if(document.activeElement===input)open();else{close();renderInfo();}},close,element:box,info};
  input.__tagPicker=api;
  renderInfo();
  return api;
}
window.TagListApp={addResultToTag,tagNames:allTagNames,tagEntries,findTagEntry,activePageName,attachTagPicker,openInfo};
// v107: смена языка (кнопка RU/EN в шапке) — всё, что приложение рисует само, перерисовывается
// на новом языке. Данные (теги, задания, названия страниц) не меняются. Конверторы
// перерисовываются сами (свой обработчик того же события).
// Названия страниц, которые приложение дало само («Основная страница», «Страница 2»),
// переводятся вместе с интерфейсом; названия, данные пользователем, не трогаются.
const DEFAULT_PAGE_NAMES={ru:{main:"Основная страница",re:/^Страница (\d+)$/,n:"Страница "},en:{main:"Main page",re:/^Page (\d+)$/,n:"Page "}};
function relocalizePageNames(){
  const to=window.I18N?.en?"en":"ru",from=to==="en"?"ru":"en",A=DEFAULT_PAGE_NAMES[from],B=DEFAULT_PAGE_NAMES[to];
  const names=new Set(pages.map(p=>String(p.name)));
  let changed=false;
  pages.forEach(p=>{
    const name=String(p.name||""),m=A.re.exec(name);
    const next=name===A.main?B.main:m?B.n+m[1]:null;
    if(!next||names.has(next))return;
    names.delete(name);names.add(next);p.name=next;changed=true;
  });
  if(changed)persistPages();
}
function relocalizeApp(){
  try{
    relocalizePageNames();
    rowCache=new WeakMap(); // карточки тегов — заново, с новыми подписями
    render();
    const mod=VIEW_MODULES[currentView],titleEl=$("viewTitle");
    if(titleEl&&mod)titleEl.textContent=TX(mod.title);
    applyFontFamily(currentFontId,false);
    applyTheme(document.documentElement.dataset.theme||"light");
    updateOcrConfigStatus();updateFmtButton();checkTagLine();applyReviewSnap();
  }catch(e){console.warn("Tag list: relocalize",e);}
}
window.addEventListener("tl-langchange",relocalizeApp);
// Совместимость: прежние вызовы закрытия конвертора.
function closeGasView(fromHistory=false){return setView("list",{fromHistory});}
$("viewSwitch").addEventListener("click",e=>{
  const b=e.target.closest(".viewSwitchBtn");
  if(!b)return;
  if(!viewSwitchOpen){setViewSwitchOpen(true);return;}                 // свёрнут — раскрыть
  if(b.dataset.view===currentView){setViewSwitchOpen(false);return;}    // тот же раздел — свернуть
  armViewSwitch();setView(b.dataset.view);                              // другой — перейти, свернуть через 3 с
});
// Касание мимо раскрытого выбора сворачивает его (само касание срабатывает как обычно).
document.addEventListener("pointerdown",e=>{
  if(viewSwitchOpen&&!e.target.closest?.("#viewSwitch"))setViewSwitchOpen(false);
},true);
// Стрелки влево/вправо на переключателе — как у обычных вкладок.
$("viewSwitch").addEventListener("keydown",e=>{
  if(e.key!=="ArrowRight"&&e.key!=="ArrowLeft")return;
  const i=VIEW_ORDER.indexOf(currentView)+(e.key==="ArrowRight"?1:-1);
  const next=VIEW_ORDER[(i+VIEW_ORDER.length)%VIEW_ORDER.length];
  e.preventDefault();setViewSwitchOpen(true);
  setView(next).then(()=>document.querySelector(`.viewSwitchBtn[data-view="${next}"]`)?.focus());
});
window.addEventListener("popstate",()=>{
  // Свой шаг назад (переход к «Тэгам» кнопкой) — раздел уже переключён, только сверяем историю.
  if(viewPopPending){finishViewPop();return;}
  const target=VIEW_ORDER.includes(history.state?.tagListView)?history.state.tagListView:"list";
  if(target!==currentView)setView(target,{fromHistory:true});
  else viewHistoryPushed=target!=="list"&&history.state?.tagListView===target;
});
// v100: страница перезагрузилась, когда был открыт конвертор (история браузера это помнит,
// а приложение открывается на «Тэгах») — снимаем пометку, иначе «Тэги» отскакивали бы в конвертор.
if(!VIEW_NATIVE_BACK){
  try{
    if(history.state&&history.state.tagListView){
      const {tagListView,...rest}=history.state;
      history.replaceState(Object.keys(rest).length?rest:null,"");
    }
  }catch(_){}
}
// Esc: сначала закрываются окна, затем раздел-конвертор (обработчик в фазе захвата,
// чтобы увидеть окна до того, как их закроет общий обработчик).
window.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&viewSwitchOpen&&!document.querySelector(".overlay.show")){setViewSwitchOpen(false);e.stopPropagation();return;}
  if(e.key==="Escape"&&currentView!=="list"&&!document.querySelector(".overlay.show")&&!e.target.closest?.("input,textarea,select"))setView("list");
},true);
// Прогрев модулей, пока пользователь ничего не делает: первое открытие — мгновенное.
(window.requestIdleCallback||((fn)=>setTimeout(fn,2500)))(()=>{ensureViewModule("gas").catch(()=>{});ensureViewModule("loop").catch(()=>{});ensureViewModule("elec").catch(()=>{});},{timeout:6000});

// v81: интеграция с Android-приложением (APK). В браузере этот блок не выполняется.
if(window.AndroidApp){
  const bridge=window.AndroidApp;
  const blobToBase64=blob=>new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result).replace(/^data:[^,]*,/,""));
    r.onerror=()=>reject(r.error||new Error("read"));
    r.readAsDataURL(blob);
  });
  // WebView не умеет navigator.share — передаём в системное окно «Поделиться».
  const nativeShare=async(payload={})=>{
    const files=Array.isArray(payload.files)?payload.files:[];
    const title=String(payload.title||""),text=[payload.text,payload.url].filter(Boolean).join("\n");
    if(files.length){
      const f=files[0];
      const b64=await blobToBase64(f);
      if(!bridge.shareBase64(String(f.name||"file"),String(f.type||"application/octet-stream"),b64,title,text))throw new DOMException("share failed","AbortError");
      return;
    }
    if(!bridge.shareText(title,text))throw new DOMException("share failed","AbortError");
  };
  try{
    Object.defineProperty(navigator,"share",{configurable:true,value:nativeShare});
    Object.defineProperty(navigator,"canShare",{configurable:true,value:()=>true});
  }catch(_){}
  // Чтение буфера обмена («Вставить список»).
  try{
    if(navigator.clipboard && typeof bridge.readClipboard==="function"){
      const clip=navigator.clipboard;
      const nativeRead=async()=>String(bridge.readClipboard()||"");
      try{Object.defineProperty(clip,"readText",{configurable:true,value:nativeRead});}catch(_){clip.readText=nativeRead;}
    }
  }catch(_){}
  // Ссылки «скачать» (blob:) → системный диалог сохранения файла.
  document.addEventListener("click",async e=>{
    const a=e.target.closest?.("a[download]");
    if(!a||!a.href)return;
    e.preventDefault();
    try{
      const blob=await (await fetch(a.href)).blob();
      bridge.saveBase64(a.getAttribute("download")||"file",blob.type||"application/octet-stream",await blobToBase64(blob));
    }catch(_){showToast(TX("Не удалось сохранить файл"));}
  },true);
  const anchorClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    if(this.hasAttribute("download")&&this.href){
      const ev=new MouseEvent("click",{bubbles:true,cancelable:true});
      if(!this.isConnected){document.body.appendChild(this);this.dispatchEvent(ev);this.remove();return;}
      this.dispatchEvent(ev);return;
    }
    return anchorClick.call(this);
  };
  // Системная кнопка «Назад»: сначала закрывает окна/режимы, затем сворачивает приложение.
  window.__tagListBack=()=>{
    try{
      const confirmOpen=$("confirmOverlay")?.classList.contains("show");
      const overlayOpen=document.querySelector(".overlay.show");
      const searchOpen=$("searchPanel")?.classList.contains("show");
      const menuOpen=$("pageContextMenu")?.classList.contains("show");
      const editorOpen=list.querySelector(".taskEditorWrap.open");
      if(confirmOpen){finishConfirm(false);return true;}
      if($("helpOverlay")?.classList.contains("show")){closeInfo();return true;}
      if($("fmtOverlay")?.classList.contains("show")){closeFmtMenu();return true;}
      if($("reportPickOverlay")?.classList.contains("show")){closeReportPick(true);return true;}
      if(reportEditing){exitReportEdit();return true;}
      if($("netOverlay")?.classList.contains("show")){closeNetWarning();return true;}
      if(ocrCropMode){cancelOcrCrop();return true;}
      if(overlayOpen||selectionMode){
        if(overlayOpen&&overlayOpen.id==="exportOverlay"){closeExportMenu();return true;}
        document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
        const still=document.querySelector(".overlay.show");
        if(still&&still===overlayOpen)still.classList.remove("show");
        return true;
      }
      if(viewSwitchOpen){setViewSwitchOpen(false);return true;}
      if(currentView!=="list"){setView("list");return true;}
      if(menuOpen&&typeof closePageContextMenu==="function"){closePageContextMenu();return true;}
      if(pageManageMode){exitPageManage();return true;}
      if(searchOpen){$("searchClose")?.click();return true;}
      if(editorOpen){
        const row=editorOpen.closest(".row"),item=data.find(x=>x.id===Number(row?.dataset.id));
        if(row&&item){closeTaskEditor(row,item);return true;}
      }
    }catch(_){}
    return false;
  };
  // Файл состояния, открытый из мессенджера/файлового менеджера («Открыть с помощью Tag list»).
  window.__tagListOpenState=async(text,name)=>{
    try{
      if(currentView!=="list")await setView("list");
      await importJsonStateFile(new File([String(text||"")],name||"state.json",{type:"application/json"}));
    }catch(e){showToast(TX.msg(e?.message)||TX("Не удалось открыть JSON"));}
  };
  try{bridge.ready?.();}catch(_){}
}

// v81: офлайн-режим веб-версии (service worker). В APK файлы и так локальные.
const IS_NATIVE_APP=!!window.AndroidApp || /\bTagListAndroid\//.test(navigator.userAgent||"");
if(IS_NATIVE_APP){
  document.documentElement.classList.add("native-app");
  hideInstallButton();
}else if("serviceWorker" in navigator && (location.protocol==="https:" || location.hostname==="localhost" || location.hostname==="127.0.0.1")){
  window.addEventListener("load",()=>{navigator.serviceWorker.register("./sw.js").catch(()=>{});},{once:true});
}
// Просим браузер не удалять локальные данные при нехватке места (Android/Chrome, Safari 17+).
try{navigator.storage?.persist?.().catch(()=>{});}catch(_){}

