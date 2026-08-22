/* ====================== MAP ANNOTATIONS (векторный слой рисования) ======================
   Подписи и фигуры хранятся в мировых координатах — той же системе, что и mapX/mapY
   островов (пиксели внутри #mapCanvas 1669×1256). SVG-слой #annotLayer — прямой child
   #mapCanvas, поэтому наследует тот же CSS-transform панорамы/зума, что и метки островов:
   ничего не нужно пересчитывать вручную при движении карты, всё двигается синхронно.
   Текст — настоящий SVG <text>, а не растровая картинка, поэтому остаётся чётким на
   любом масштабе, а не «плывёт»/не размывается. */

state.annotations = [];
state.decorations = [];
state.drawTool = null;   // null | 'text' | 'line' | 'arrow' | 'rect' | 'circle' | 'polygon' | 'freehand' | 'icon' | 'erase'
state.drawColor = '#e8c874';
state.drawStrokeWidth = 2;
state.drawOpacity = 1;
state.annotationsVisible = true; // общий переключатель слоя — скрыть все пометки разом
state.annotationUndoStack = []; // { type:'create'|'delete'|'move', ... } — см. undoLastAnnotationAction()
state.selectedDecoration = null; // url выбранного украшения для инструмента 'icon'

const ANNOTATION_UNDO_LIMIT = 50;

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

// Наконечник стрелки — треугольник, посчитанный из угла линии, а не
// маркер-дефиниция: маркеры в SVG плохо работают с произвольным цветом
// на каждую фигуру отдельно (пришлось бы плодить <marker> под каждый цвет),
// проще посчитать три точки треугольника руками.
// half-angle — половина угла раствора наконечника от направления линии,
// НЕ от обратного направления: маленький угол (~25-30°) даёт крылья,
// уходящие назад к линии, что и нужно. Раньше здесь стоял Math.PI*0.82
// (≈147.6°) — почти развёрнутый угол — из-за чего оба крыла оказывались
// геометрически впереди конечной точки, и наконечник визуально "убегал"
// за пределы стрелки вместо того, чтобы указывать на неё.
function arrowHeadPoints(x1,y1,x2,y2,size){
  const angle = Math.atan2(y2-y1, x2-x1);
  const halfAngle = Math.PI*0.15;
  const p1x = x2 - size*Math.cos(angle-halfAngle), p1y = y2 - size*Math.sin(angle-halfAngle);
  const p2x = x2 - size*Math.cos(angle+halfAngle), p2y = y2 - size*Math.sin(angle+halfAngle);
  return `${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`;
}

function pointsAttr(points){
  return points.map(p=>`${p.x},${p.y}`).join(' ');
}

function annotationToSvgEl(a){
  const opacity = a.opacity != null ? a.opacity : 1;

  if(a.type==='text'){
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', a.x1); t.setAttribute('y', a.y1);
    t.setAttribute('fill', a.color);
    t.setAttribute('font-size', a.fontSize);
    t.setAttribute('opacity', opacity);
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
    l.setAttribute('opacity', opacity);
    l.setAttribute('class', 'annot-el');
    return l;
  }
  if(a.type==='arrow'){
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'annot-el');
    g.setAttribute('opacity', opacity);
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', a.x1); l.setAttribute('y1', a.y1);
    l.setAttribute('x2', a.x2); l.setAttribute('y2', a.y2);
    l.setAttribute('stroke', a.color); l.setAttribute('stroke-width', a.strokeWidth);
    l.setAttribute('stroke-linecap', 'round');
    const head = document.createElementNS(SVG_NS, 'polygon');
    head.setAttribute('points', arrowHeadPoints(a.x1,a.y1,a.x2,a.y2, 8+a.strokeWidth*2));
    head.setAttribute('fill', a.color);
    g.appendChild(l); g.appendChild(head);
    return g;
  }
  if(a.type==='rect'){
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', Math.min(a.x1,a.x2)); r.setAttribute('y', Math.min(a.y1,a.y2));
    r.setAttribute('width', Math.abs(a.x2-a.x1)); r.setAttribute('height', Math.abs(a.y2-a.y1));
    r.setAttribute('stroke', a.color); r.setAttribute('stroke-width', a.strokeWidth);
    r.setAttribute('fill', 'none');
    r.setAttribute('opacity', opacity);
    r.setAttribute('class', 'annot-el');
    return r;
  }
  if(a.type==='circle'){
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', a.x1); c.setAttribute('cy', a.y1); c.setAttribute('r', a.r);
    c.setAttribute('stroke', a.color); c.setAttribute('stroke-width', a.strokeWidth);
    c.setAttribute('fill', 'none');
    c.setAttribute('opacity', opacity);
    c.setAttribute('class', 'annot-el');
    return c;
  }
  if(a.type==='polygon'){
    const p = document.createElementNS(SVG_NS, 'polygon');
    p.setAttribute('points', pointsAttr(a.points || []));
    p.setAttribute('stroke', a.color); p.setAttribute('stroke-width', a.strokeWidth);
    p.setAttribute('fill', 'none');
    p.setAttribute('opacity', opacity);
    p.setAttribute('class', 'annot-el');
    return p;
  }
  if(a.type==='freehand'){
    const p = document.createElementNS(SVG_NS, 'polyline');
    p.setAttribute('points', pointsAttr(a.points || []));
    p.setAttribute('stroke', a.color); p.setAttribute('stroke-width', a.strokeWidth);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('opacity', opacity);
    p.setAttribute('class', 'annot-el');
    return p;
  }
  if(a.type==='icon'){
    const img = document.createElementNS(SVG_NS, 'image');
    const size = (a.r || 32) * 2;
    img.setAttribute('x', a.x1 - size/2); img.setAttribute('y', a.y1 - size/2);
    img.setAttribute('width', size); img.setAttribute('height', size);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', a.iconUrl);
    img.setAttribute('href', a.iconUrl);
    img.setAttribute('opacity', opacity);
    img.setAttribute('class', 'annot-el annot-icon');
    return img;
  }
  return null;
}

/* ---------------- отмена последнего действия (Ctrl+Z) ----------------
   Стек живёт только в памяти вкладки (не переживает перезагрузку страницы) —
   как и в большинстве графических редакторов, история рисования локальна
   для текущей сессии, а не часть постоянных данных. */
function pushUndo(action){
  state.annotationUndoStack.push(action);
  if(state.annotationUndoStack.length > ANNOTATION_UNDO_LIMIT) state.annotationUndoStack.shift();
  updateUndoButtonState();
}

function updateUndoButtonState(){
  const btn = document.getElementById('drawUndoBtn');
  if(btn) btn.disabled = state.annotationUndoStack.length === 0;
}

async function undoLastAnnotationAction(){
  const action = state.annotationUndoStack.pop();
  updateUndoButtonState();
  if(!action){ toast('Нечего отменять'); return; }
  try{
    if(action.type==='create'){
      await api('/annotations/'+action.id, { method:'DELETE' });
      state.annotations = state.annotations.filter(a=>a.id!==action.id);
    }else if(action.type==='delete'){
      const restored = await api('/annotations', { method:'POST', body: { ...action.data, project: state.project } });
      state.annotations.push(restored);
    }else if(action.type==='move'){
      const patch = { x1: action.from.x1, y1: action.from.y1 };
      if(action.from.x2!=null){ patch.x2 = action.from.x2; patch.y2 = action.from.y2; }
      if(action.from.points){ patch.points = action.from.points; }
      const updated = await api('/annotations/'+action.id, { method:'PATCH', body: patch });
      const idx = state.annotations.findIndex(a=>a.id===action.id);
      if(idx>=0) state.annotations[idx] = updated;
    }
    renderAnnotations();
    toast('Отменено');
  }catch(e){ toast('Не удалось отменить: '+e.message); }
}

document.getElementById('drawUndoBtn').addEventListener('click', undoLastAnnotationAction);

window.addEventListener('keydown', ev=>{
  if(!state.editorOn || state.view!=='map') return;
  const activeTag = (document.activeElement && document.activeElement.tagName) || '';
  if(activeTag==='INPUT' || activeTag==='TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable)) return;
  if((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase()==='z'){
    ev.preventDefault();
    undoLastAnnotationAction();
  }
});

async function createAnnotation(body){
  try{
    const created = await api('/annotations', {
      method:'POST',
      body: { ...body, project: state.project, color: state.drawColor, strokeWidth: state.drawStrokeWidth, opacity: state.drawOpacity },
    });
    state.annotations.push(created);
    renderAnnotations();
    pushUndo({ type:'create', id: created.id });
  }catch(e){ toast('Ошибка: '+e.message); }
}

/* ---------------- панель инструментов ---------------- */
document.querySelectorAll('.draw-tool').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    cancelPolygonDraft(); // смена инструмента посреди рисования полигона — бросаем черновик
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

const strokeWidthInput = document.getElementById('drawStrokeWidth');
const strokeWidthVal = document.getElementById('drawStrokeWidthVal');
strokeWidthInput.addEventListener('input', ()=>{
  state.drawStrokeWidth = Number(strokeWidthInput.value);
  strokeWidthVal.textContent = strokeWidthInput.value;
});

const opacityInput = document.getElementById('drawOpacity');
const opacityVal = document.getElementById('drawOpacityVal');
opacityInput.addEventListener('input', ()=>{
  state.drawOpacity = Number(opacityInput.value) / 100;
  opacityVal.textContent = opacityInput.value + '%';
});

document.getElementById('drawLayerToggleBtn').addEventListener('click', ()=>{
  state.annotationsVisible = !state.annotationsVisible;
  const btn = document.getElementById('drawLayerToggleBtn');
  annotLayer.style.display = state.annotationsVisible ? '' : 'none';
  btn.classList.toggle('active', state.annotationsVisible);
  btn.classList.toggle('layer-hidden', !state.annotationsVisible);
  btn.textContent = state.annotationsVisible ? '👁 Пометки' : '🚫 Пометки скрыты';
});

// стереть пометку: активируем инструмент "erase" и кликаем по фигуре/подписи
annotLayer.addEventListener('click', async ev=>{
  if(state.drawTool !== 'erase') return;
  const el = ev.target.closest('.annot-el');
  if(!el || !el.dataset.id) return;
  if(!confirm('Удалить эту пометку с карты?')) return;
  const a = annotationById(el.dataset.id);
  try{
    await api('/annotations/'+el.dataset.id, { method:'DELETE' });
    state.annotations = state.annotations.filter(a=>a.id!==el.dataset.id);
    renderAnnotations();
    if(a) pushUndo({ type:'delete', data: annotationToCreatePayload(a) });
  }catch(e){ toast('Ошибка: '+e.message); }
});

// снимок аннотации в форме, пригодной для POST /annotations (без id/project —
// их подставит createAnnotation/undoLastAnnotationAction заново)
function annotationToCreatePayload(a){
  return {
    type: a.type, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, r: a.r,
    text: a.text, iconUrl: a.iconUrl, points: a.points,
    color: a.color, strokeWidth: a.strokeWidth, fontSize: a.fontSize, opacity: a.opacity,
  };
}

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
  }else if(a.type==='arrow'){
    const l = el.children[0], head = el.children[1];
    const nx1=a.x1+dx, ny1=a.y1+dy, nx2=a.x2+dx, ny2=a.y2+dy;
    l.setAttribute('x1', nx1); l.setAttribute('y1', ny1);
    l.setAttribute('x2', nx2); l.setAttribute('y2', ny2);
    head.setAttribute('points', arrowHeadPoints(nx1,ny1,nx2,ny2, 8+a.strokeWidth*2));
  }else if(a.type==='rect'){
    el.setAttribute('x', Math.min(a.x1,a.x2)+dx); el.setAttribute('y', Math.min(a.y1,a.y2)+dy);
  }else if(a.type==='polygon' || a.type==='freehand'){
    const shifted = (a.points||[]).map(p=>({ x:p.x+dx, y:p.y+dy }));
    el.setAttribute('points', pointsAttr(shifted));
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
  if(d.a.type==='line' || d.a.type==='arrow' || d.a.type==='rect'){ patch.x2 = d.a.x2+dx; patch.y2 = d.a.y2+dy; }
  if(d.a.type==='polygon' || d.a.type==='freehand'){ patch.points = (d.a.points||[]).map(p=>({ x:p.x+dx, y:p.y+dy })); }

  try{
    const updated = await api('/annotations/'+d.id, { method:'PATCH', body: patch });
    const idx = state.annotations.findIndex(a=>a.id===d.id);
    if(idx>=0) state.annotations[idx] = updated;
    renderAnnotations();
    pushUndo({ type:'move', id: d.id, from: { x1:d.a.x1, y1:d.a.y1, x2:d.a.x2, y2:d.a.y2, points:d.a.points } });
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

/* ---- полигон: отдельная модель взаимодействия — клик за кликом добавляет
   точку, а не одним движением мыши, как у остальных фигур ---- */
let polygonDraft = null; // { points:[{x,y},...], el }

function cancelPolygonDraft(){
  if(polygonDraft){ polygonDraft.el.remove(); polygonDraft = null; }
}

function startOrExtendPolygon(p){
  if(!polygonDraft){
    const el = document.createElementNS(SVG_NS, 'polyline');
    el.setAttribute('points', `${p.x},${p.y}`);
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', state.drawColor);
    el.setAttribute('stroke-width', state.drawStrokeWidth);
    el.setAttribute('class', 'annot-preview');
    annotLayer.appendChild(el);
    polygonDraft = { points: [p], el };
  }else{
    polygonDraft.points.push(p);
    polygonDraft.el.setAttribute('points', pointsAttr(polygonDraft.points));
  }
}

function updatePolygonRubberBand(p){
  if(!polygonDraft) return;
  polygonDraft.el.setAttribute('points', pointsAttr(polygonDraft.points.concat([p])));
}

async function finishPolygon(){
  if(!polygonDraft) return;
  const pts = polygonDraft.points;
  cancelPolygonDraft();
  if(pts.length < 3){ toast('Многоугольнику нужно хотя бы 3 точки'); return; }
  await createAnnotation({ type:'polygon', x1:pts[0].x, y1:pts[0].y, points: pts });
}

mapView.addEventListener('dblclick', ev=>{
  if(state.drawTool==='polygon' && polygonDraft){
    ev.preventDefault();
    finishPolygon();
  }
});

window.addEventListener('keydown', ev=>{
  if(!polygonDraft) return;
  if(ev.key==='Enter'){ ev.preventDefault(); finishPolygon(); }
  else if(ev.key==='Escape'){ ev.preventDefault(); cancelPolygonDraft(); }
});

/* ---- от руки: непрерывный драг, точки набираются по движению мыши,
   с минимальным расстоянием между соседними, чтобы не разбухал массив ---- */
const FREEHAND_MIN_DIST = 4;
let freehandDraft = null; // { points:[{x,y},...], el }

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
  if(state.drawTool==='polygon'){
    ev.preventDefault();
    startOrExtendPolygon(p);
    return;
  }
  if(state.drawTool==='freehand'){
    ev.preventDefault();
    const el = document.createElementNS(SVG_NS, 'polyline');
    el.setAttribute('points', `${p.x},${p.y}`);
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', state.drawColor);
    el.setAttribute('stroke-width', state.drawStrokeWidth);
    el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('class', 'annot-preview');
    annotLayer.appendChild(el);
    freehandDraft = { points: [p], el };
    return;
  }

  ev.preventDefault();
  drawing = { tool: state.drawTool, startX: p.x, startY: p.y };
  let el;
  if(drawing.tool==='line' || drawing.tool==='arrow'){
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
  el.setAttribute('stroke-width', state.drawStrokeWidth);
  el.setAttribute('class', 'annot-preview');
  annotLayer.appendChild(el);
  drawing.el = el;
});

window.addEventListener('mousemove', ev=>{
  if(polygonDraft && state.drawTool==='polygon'){
    updatePolygonRubberBand(worldPoint(ev.clientX, ev.clientY));
  }

  if(freehandDraft){
    const p = worldPoint(ev.clientX, ev.clientY);
    const last = freehandDraft.points[freehandDraft.points.length-1];
    if(Math.hypot(p.x-last.x, p.y-last.y) >= FREEHAND_MIN_DIST){
      freehandDraft.points.push(p);
      if(freehandDraft.points.length <= 500){
        freehandDraft.el.setAttribute('points', pointsAttr(freehandDraft.points));
      }
    }
    return;
  }

  if(!drawing) return;
  const p = worldPoint(ev.clientX, ev.clientY);
  if(drawing.tool==='line' || drawing.tool==='arrow'){
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
  if(freehandDraft){
    const d = freehandDraft; freehandDraft = null;
    d.el.remove();
    if(d.points.length < 2) return; // случайный клик без движения
    await createAnnotation({ type:'freehand', x1:d.points[0].x, y1:d.points[0].y, points: d.points });
    return;
  }

  if(!drawing) return;
  const d = drawing; drawing = null;
  d.el.remove(); // превью убираем — финальную фигуру перерисуем из ответа сервера
  const p = worldPoint(ev.clientX, ev.clientY);

  if(d.tool==='line'){
    if(Math.hypot(p.x-d.startX, p.y-d.startY) < 3) return; // случайный клик, не тянули
    await createAnnotation({ type:'line', x1:d.startX, y1:d.startY, x2:p.x, y2:p.y });
  }else if(d.tool==='arrow'){
    if(Math.hypot(p.x-d.startX, p.y-d.startY) < 3) return;
    await createAnnotation({ type:'arrow', x1:d.startX, y1:d.startY, x2:p.x, y2:p.y });
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
    cancelPolygonDraft();
  }
});
