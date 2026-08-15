/* ====================== MAP ANNOTATIONS (векторный слой рисования) ======================
   Подписи и фигуры хранятся в мировых координатах — той же системе, что и mapX/mapY
   островов (пиксели внутри #mapCanvas 1669×1256). SVG-слой #annotLayer — прямой child
   #mapCanvas, поэтому наследует тот же CSS-transform панорамы/зума, что и метки островов:
   ничего не нужно пересчитывать вручную при движении карты, всё двигается синхронно.
   Текст — настоящий SVG <text>, а не растровая картинка, поэтому остаётся чётким на
   любом масштабе, а не «плывёт»/не размывается. */

state.annotations = [];
state.decorations = [];
state.drawTool = null;   // null | 'text' | 'line' | 'rect' | 'circle' | 'icon' | 'erase'
state.drawColor = '#e8c874';
state.selectedDecoration = null; // url выбранного украшения для инструмента 'icon'

const annotLayer = document.getElementById('annotLayer');
const decoPicker = document.getElementById('decoPicker');
const decoPickerGrid = document.getElementById('decoPickerGrid');

async function loadDecorations(){
  try{ state.decorations = await api('/decorations'); }
  catch(e){ state.decorations = []; }
}

function renderDecoPicker(){
  decoPickerGrid.innerHTML = state.decorations.map(d=>`
    <button class="deco-picker-item ${state.selectedDecoration===d.url?'active':''}" data-url="${escapeHtml(d.url)}" title="${escapeHtml(d.name)}">
      <img src="${escapeHtml(d.url)}" alt="${escapeHtml(d.name)}">
    </button>
  `).join('') || '<div class="deco-picker-empty">Украшений пока нет — добавьте в «⚙ Настройки»</div>';
}

decoPickerGrid.addEventListener('click', ev=>{
  const btn = ev.target.closest('.deco-picker-item');
  if(!btn) return;
  state.selectedDecoration = btn.dataset.url;
  renderDecoPicker();
});

async function loadAnnotations(){
  try{
    state.annotations = await api('/annotations?project=' + encodeURIComponent(state.project));
  }catch(e){
    state.annotations = [];
  }
  renderAnnotations();
}

function renderAnnotations(){
  annotLayer.innerHTML = '';
  state.annotations.forEach(a=>{
    const el = annotationToSvgEl(a);
    if(!el) return;
    el.dataset.id = a.id;
    annotLayer.appendChild(el);
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function annotationToSvgEl(a){
  if(a.type==='text'){
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', a.x1); t.setAttribute('y', a.y1);
    t.setAttribute('fill', a.color);
    t.setAttribute('font-size', a.fontSize);
    t.setAttribute('class', 'annot-el annot-text');
    t.textContent = a.text || '';
    return t;
  }
  if(a.type==='line'){
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', a.x1); l.setAttribute('y1', a.y1);
    l.setAttribute('x2', a.x2); l.setAttribute('y2', a.y2);
    l.setAttribute('stroke', a.color); l.setAttribute('stroke-width', a.strokeWidth);
    l.setAttribute('stroke-linecap', 'round');
    l.setAttribute('class', 'annot-el');
    return l;
  }
  if(a.type==='rect'){
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', Math.min(a.x1,a.x2)); r.setAttribute('y', Math.min(a.y1,a.y2));
    r.setAttribute('width', Math.abs(a.x2-a.x1)); r.setAttribute('height', Math.abs(a.y2-a.y1));
    r.setAttribute('stroke', a.color); r.setAttribute('stroke-width', a.strokeWidth);
    r.setAttribute('fill', 'none');
    r.setAttribute('class', 'annot-el');
    return r;
  }
  if(a.type==='circle'){
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', a.x1); c.setAttribute('cy', a.y1); c.setAttribute('r', a.r);
    c.setAttribute('stroke', a.color); c.setAttribute('stroke-width', a.strokeWidth);
    c.setAttribute('fill', 'none');
    c.setAttribute('class', 'annot-el');
    return c;
  }
  if(a.type==='icon'){
    const img = document.createElementNS(SVG_NS, 'image');
    const size = (a.r || 32) * 2;
    img.setAttribute('x', a.x1 - size/2); img.setAttribute('y', a.y1 - size/2);
    img.setAttribute('width', size); img.setAttribute('height', size);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', a.iconUrl);
    img.setAttribute('href', a.iconUrl);
    img.setAttribute('class', 'annot-el annot-icon');
    return img;
  }
  return null;
}

async function createAnnotation(body){
  try{
    const created = await api('/annotations', { method:'POST', body: { ...body, project: state.project, color: state.drawColor } });
    state.annotations.push(created);
    renderAnnotations();
  }catch(e){ toast('Ошибка: '+e.message); }
}

/* ---------------- панель инструментов ---------------- */
document.querySelectorAll('.draw-tool').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const tool = btn.dataset.tool;
    state.drawTool = (state.drawTool===tool) ? null : tool; // повторный клик выключает
    document.querySelectorAll('.draw-tool').forEach(b=> b.classList.toggle('active', b.dataset.tool===state.drawTool));
    mapView.classList.toggle('drawing', !!state.drawTool);
    if(state.drawTool==='icon'){
      renderDecoPicker();
      decoPicker.classList.remove('hidden');
    }else{
      decoPicker.classList.add('hidden');
    }
  });
});
document.querySelectorAll('.draw-color').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    state.drawColor = btn.dataset.color;
    document.querySelectorAll('.draw-color').forEach(b=> b.classList.toggle('active', b===btn));
  });
});

// стереть пометку: активируем инструмент "erase" и кликаем по фигуре/подписи
annotLayer.addEventListener('click', async ev=>{
  if(state.drawTool !== 'erase') return;
  const el = ev.target.closest('.annot-el');
  if(!el || !el.dataset.id) return;
  if(!confirm('Удалить эту пометку с карты?')) return;
  try{
    await api('/annotations/'+el.dataset.id, { method:'DELETE' });
    state.annotations = state.annotations.filter(a=>a.id!==el.dataset.id);
    renderAnnotations();
  }catch(e){ toast('Ошибка: '+e.message); }
});

/* ---------------- перетаскивание уже размещённых фигур (режим без инструмента) ---------------- */
let dragging = null; // { id, startWorld, origAttrs }

function annotationById(id){
  return state.annotations.find(a=>a.id===id);
}

function applyOffsetToEl(el, a, dx, dy){
  if(a.type==='text' || a.type==='circle' || a.type==='icon'){
    const x = a.x1+dx, y = a.y1+dy;
    if(a.type==='text'){ el.setAttribute('x', x); el.setAttribute('y', y); }
    else if(a.type==='circle'){ el.setAttribute('cx', x); el.setAttribute('cy', y); }
    else{ // icon
      const size = (a.r||32)*2;
      el.setAttribute('x', x - size/2); el.setAttribute('y', y - size/2);
    }
  }else if(a.type==='line'){
    el.setAttribute('x1', a.x1+dx); el.setAttribute('y1', a.y1+dy);
    el.setAttribute('x2', a.x2+dx); el.setAttribute('y2', a.y2+dy);
  }else if(a.type==='rect'){
    el.setAttribute('x', Math.min(a.x1,a.x2)+dx); el.setAttribute('y', Math.min(a.y1,a.y2)+dy);
  }
}

annotLayer.addEventListener('mousedown', ev=>{
  if(!state.editorOn || state.drawTool) return; // инструмент рисования/стирания активен — не двигаем
  const el = ev.target.closest('.annot-el');
  if(!el || !el.dataset.id) return;
  const a = annotationById(el.dataset.id);
  if(!a) return;
  ev.preventDefault();
  ev.stopPropagation();
  const startWorld = worldPoint(ev.clientX, ev.clientY);
  el.classList.add('dragging');
  dragging = { id: a.id, el, a, startWorld, moved:false };
});

window.addEventListener('mousemove', ev=>{
  if(!dragging) return;
  const p = worldPoint(ev.clientX, ev.clientY);
  const dx = p.x - dragging.startWorld.x, dy = p.y - dragging.startWorld.y;
  if(Math.abs(dx)>2 || Math.abs(dy)>2) dragging.moved = true;
  applyOffsetToEl(dragging.el, dragging.a, dx, dy);
  dragging.lastDx = dx; dragging.lastDy = dy;
});

window.addEventListener('mouseup', async ev=>{
  if(!dragging) return;
  const d = dragging; dragging = null;
  d.el.classList.remove('dragging');
  if(!d.moved) return; // просто клик — ничего не двигали

  const dx = d.lastDx||0, dy = d.lastDy||0;
  const patch = { x1: d.a.x1+dx, y1: d.a.y1+dy };
  if(d.a.type==='line' || d.a.type==='rect'){ patch.x2 = d.a.x2+dx; patch.y2 = d.a.y2+dy; }

  try{
    const updated = await api('/annotations/'+d.id, { method:'PATCH', body: patch });
    const idx = state.annotations.findIndex(a=>a.id===d.id);
    if(idx>=0) state.annotations[idx] = updated;
    renderAnnotations();
  }catch(e){
    toast('Не удалось переместить: '+e.message);
    renderAnnotations(); // откатываем визуально к последним сохранённым координатам
  }
});

/* ---------------- рисование мышью/пальцем ---------------- */
function worldPoint(clientX, clientY){
  const rect = mapView.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.cam.x) / state.cam.scale,
    y: (clientY - rect.top - state.cam.y) / state.cam.scale,
  };
}

let drawing = null; // { tool, startX, startY, el }

mapView.addEventListener('mousedown', ev=>{
  if(!state.editorOn || !state.drawTool || state.drawTool==='erase') return;
  if(ev.target.closest('.marker')) return;
  const p = worldPoint(ev.clientX, ev.clientY);

  if(state.drawTool==='text'){
    const text = prompt('Текст подписи на карте:');
    if(text && text.trim()) createAnnotation({ type:'text', x1:p.x, y1:p.y, text: text.trim() });
    return;
  }
  if(state.drawTool==='icon'){
    if(!state.selectedDecoration){ toast('Сначала выберите украшение в панели слева'); return; }
    createAnnotation({ type:'icon', x1:p.x, y1:p.y, iconUrl: state.selectedDecoration, r: 32 });
    return;
  }

  ev.preventDefault();
  drawing = { tool: state.drawTool, startX: p.x, startY: p.y };
  let el;
  if(drawing.tool==='line'){
    el = document.createElementNS(SVG_NS,'line');
    el.setAttribute('x1',p.x); el.setAttribute('y1',p.y);
    el.setAttribute('x2',p.x); el.setAttribute('y2',p.y);
  }else if(drawing.tool==='rect'){
    el = document.createElementNS(SVG_NS,'rect');
    el.setAttribute('x',p.x); el.setAttribute('y',p.y);
    el.setAttribute('width',0); el.setAttribute('height',0);
    el.setAttribute('fill','none');
  }else if(drawing.tool==='circle'){
    el = document.createElementNS(SVG_NS,'circle');
    el.setAttribute('cx',p.x); el.setAttribute('cy',p.y); el.setAttribute('r',0);
    el.setAttribute('fill','none');
  }
  el.setAttribute('stroke', state.drawColor);
  el.setAttribute('stroke-width', 2);
  el.setAttribute('class', 'annot-preview');
  annotLayer.appendChild(el);
  drawing.el = el;
});

window.addEventListener('mousemove', ev=>{
  if(!drawing) return;
  const p = worldPoint(ev.clientX, ev.clientY);
  if(drawing.tool==='line'){
    drawing.el.setAttribute('x2', p.x); drawing.el.setAttribute('y2', p.y);
  }else if(drawing.tool==='rect'){
    drawing.el.setAttribute('x', Math.min(drawing.startX,p.x));
    drawing.el.setAttribute('y', Math.min(drawing.startY,p.y));
    drawing.el.setAttribute('width', Math.abs(p.x-drawing.startX));
    drawing.el.setAttribute('height', Math.abs(p.y-drawing.startY));
  }else if(drawing.tool==='circle'){
    drawing.el.setAttribute('r', Math.hypot(p.x-drawing.startX, p.y-drawing.startY));
  }
});

window.addEventListener('mouseup', async ev=>{
  if(!drawing) return;
  const d = drawing; drawing = null;
  d.el.remove(); // превью убираем — финальную фигуру перерисуем из ответа сервера
  const p = worldPoint(ev.clientX, ev.clientY);

  if(d.tool==='line'){
    if(Math.hypot(p.x-d.startX, p.y-d.startY) < 3) return; // случайный клик, не тянули
    await createAnnotation({ type:'line', x1:d.startX, y1:d.startY, x2:p.x, y2:p.y });
  }else if(d.tool==='rect'){
    if(Math.abs(p.x-d.startX)<3 || Math.abs(p.y-d.startY)<3) return;
    await createAnnotation({ type:'rect', x1:d.startX, y1:d.startY, x2:p.x, y2:p.y });
  }else if(d.tool==='circle'){
    const r = Math.hypot(p.x-d.startX, p.y-d.startY);
    if(r < 3) return;
    await createAnnotation({ type:'circle', x1:d.startX, y1:d.startY, r });
  }
});

// выход из режима редактора — выключаем активный инструмент рисования
document.getElementById('editorToggle').addEventListener('click', ()=>{
  if(!state.editorOn && state.drawTool){
    state.drawTool = null;
    document.querySelectorAll('.draw-tool').forEach(b=> b.classList.remove('active'));
    mapView.classList.remove('drawing');
    decoPicker.classList.add('hidden');
  }
});
