/* ====================== STATE ====================== */
const state = {
  data: [],
  editorOn: false,
  drawPanelOpen: false, // отдельный вкл/выкл панели рисования, независимо от editorOn
  view: 'map',
  returnView: 'map', // map или wiki — куда возвращаться из деталей острова (клик по тегу, кнопка "назад")
  currentId: null,
  currentLocId: null,
  filters: { category:'', faction:'', q:'', archipelago:'', climate:'', size:'' },
  cam: { x: 0, y: 0, scale: 0.72 }, // реальное центрирование выставляется в main.js после того, как известен размер #mapView
  project: null, // выставляется в main.js после boot() из PROJECTS[0] или localStorage
  timelineShowAll: true, // слайдер динамики (timelineSlider.js) — по умолчанию фильтр по году выключен
  timelineYear: null,
};

const byId = id => state.data.find(d=>d.id===id);

/* ====================== DOM refs (shared across modules) ====================== */
const mapView = document.getElementById('mapView');
const mapCanvas = document.getElementById('mapCanvas');
const detailView = document.getElementById('detailView');
const trayEl = document.getElementById('tray');
const trayList = document.getElementById('trayList');
const emptyHint = document.getElementById('emptyHint');

/* ====================== SMALL SHARED HELPERS ====================== */
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function facClass(f){
  if(!f) return '';
  if(f.includes('Имперск')) return 'Имперский';
  if(f.includes('Лигийск')) return 'Лигийский';
  if(f.includes('Эльфийск')) return 'Эльфийский';
  if(f.includes('Нейтральн')) return 'Нейтральный';
  return '';
}

function passesFilter(item){
  if((item.project||'Аллоды Онлайн') !== state.project) return false;
  if(state.filters.category && item.category!==state.filters.category) return false;
  if(state.filters.faction && item.faction!==state.filters.faction) return false;
  if(state.filters.archipelago && item.archipelago!==state.filters.archipelago) return false;
  if(state.filters.climate && item.climate!==state.filters.climate) return false;
  if(state.filters.size && item.size!==state.filters.size) return false;
  if(state.filters.q && !item.name.toLowerCase().includes(state.filters.q)) return false;
  if(!islandExistsAtTimelineYear(item)) return false;
  return true;
}

// слайдер динамики (см. timelineSlider.js) — по умолчанию state.timelineShowAll=true,
// то есть фильтр по году выключен (текущее поведение "показывать всё" не
// меняется, пока человек явно не включит режим "на такой-то год"). Остров
// без year_appeared считается существовавшим всегда "с начала", без
// year_disappeared — существующим до сих пор.
function islandExistsAtTimelineYear(item){
  if(state.timelineShowAll || state.timelineYear==null) return true;
  const appeared = item.year_appeared==null ? -Infinity : item.year_appeared;
  const disappeared = item.year_disappeared==null ? Infinity : item.year_disappeared;
  return appeared <= state.timelineYear && state.timelineYear < disappeared;
}

function activeFilterLabel(){
  const f = state.filters;
  const parts = [];
  if(f.category) parts.push(f.category);
  if(f.faction) parts.push(f.faction);
  if(f.archipelago) parts.push('архипелаг «'+f.archipelago+'»');
  if(f.climate) parts.push(f.climate);
  if(f.size) parts.push(f.size);
  return parts.join(' · ');
}

function clearExtraFilters(){
  state.filters.archipelago=''; state.filters.climate=''; state.filters.size='';
}

/* ====================== UNIVERSAL POINTER DRAG ======================
   Единая замена нативному HTML5 Drag-and-Drop, которая работает и мышью,
   и пальцем на тач-экранах (native DnD тач не поддерживает вовсе).
   onStart(ev)            -> вернуть элемент-«призрак», который будет следовать
                              за курсором/пальцем, либо null, если призрак не нужен
   onMove(x, y, ev)        -> вызывается на каждое перемещение
   onEnd(x, y, ev)          -> вызывается по отпусканию — здесь обычно нужно
                              определить цель через document.elementFromPoint(x,y)
======================================================================= */
function startPointerDrag(el, { onStart, onMove, onEnd } = {}){
  el.addEventListener('pointerdown', ev=>{
    if(ev.pointerType==='mouse' && ev.button!==0) return;
    ev.preventDefault();
    try{ el.setPointerCapture(ev.pointerId); }catch(e){}
    let moved = false;
    const startX = ev.clientX, startY = ev.clientY;
    const ghost = onStart ? onStart(ev) : null;
    if(ghost){ ghost.style.left = ev.clientX+'px'; ghost.style.top = ev.clientY+'px'; }
    const onMoveHandler = mev=>{
      if(Math.abs(mev.clientX-startX)>3 || Math.abs(mev.clientY-startY)>3) moved = true;
      if(ghost){ ghost.style.left = mev.clientX+'px'; ghost.style.top = mev.clientY+'px'; }
      if(onMove) onMove(mev.clientX, mev.clientY, mev);
    };
    const onUpHandler = uev=>{
      try{ el.releasePointerCapture(ev.pointerId); }catch(e){}
      document.removeEventListener('pointermove', onMoveHandler);
      document.removeEventListener('pointerup', onUpHandler);
      document.removeEventListener('pointercancel', onUpHandler);
      if(ghost) ghost.remove();
      if(onEnd) onEnd(uev.clientX, uev.clientY, uev, moved);
    };
    document.addEventListener('pointermove', onMoveHandler);
    document.addEventListener('pointerup', onUpHandler);
    document.addEventListener('pointercancel', onUpHandler);
  });
}
function makeDragGhost(html, className){
  const g = document.createElement('div');
  g.className = 'drag-ghost' + (className? ' '+className : '');
  g.innerHTML = html;
  document.body.appendChild(g);
  return g;
}

/* ====================== TOAST ====================== */
let toastTimer;
// toast(msg) — просто уведомление.
// toast(msg, undoFn) — уведомление с кнопкой «Отменить», вызывающей undoFn().
function toast(msg, undoFn){
  const t = document.getElementById('toast');
  const undoBtn = document.getElementById('toastUndo');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  undoBtn.style.display = undoFn ? 'inline-block' : 'none';
  undoBtn.onclick = null;
  if(undoFn){
    undoBtn.onclick = async ()=>{
      t.classList.remove('show');
      clearTimeout(toastTimer);
      try{ await undoFn(); toast('Отменено'); }
      catch(e){ toast('Не удалось отменить: '+e.message); }
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), undoFn ? 4000 : 1600);
}

/* ====================== RESPONSIVE TOPBAR HEIGHT ======================
   На мобильном шапка может переноситься на 2 строки — вместо фиксированных
   top:64px у карты/детейл-вью/лотка используется CSS-переменная --topbar-h,
   которая всегда отражает реальную высоту шапки. */
(function trackTopbarHeight(){
  const topbar = document.getElementById('topbar');
  if(!topbar) return;
  const update = ()=> document.documentElement.style.setProperty('--topbar-h', topbar.offsetHeight + 'px');
  update();
  if(window.ResizeObserver){
    new ResizeObserver(update).observe(topbar);
  }else{
    window.addEventListener('resize', update);
  }
})();
