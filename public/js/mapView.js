/* ====================== FILTERS ====================== */
function uniqueVals(key){
  return [...new Set(projectFilteredData().map(d=>d[key]).filter(Boolean))].sort();
}
function initFilterSelects(){
  const catSel = document.getElementById('catFilter');
  const facSel = document.getElementById('facFilter');
  catSel.innerHTML = '<option value="">Все категории</option>';
  facSel.innerHTML = '<option value="">Все фракции</option>';
  uniqueVals('category').forEach(v=>{
    const o=document.createElement('option'); o.value=v; o.textContent=v; catSel.appendChild(o);
  });
  uniqueVals('faction').forEach(v=>{
    const o=document.createElement('option'); o.value=v; o.textContent=v; facSel.appendChild(o);
  });
  catSel.onchange = e=>{ state.filters.category=e.target.value; renderMarkers(); renderTray(); updateActiveFilterBar(); };
  facSel.onchange = e=>{ state.filters.faction=e.target.value; renderMarkers(); renderTray(); updateActiveFilterBar(); };
}
document.getElementById('searchbox').addEventListener('input', e=>{
  state.filters.q = e.target.value.trim().toLowerCase();
  renderMarkers(); renderTray();
  renderSearchResults(state.filters.q);
});
document.getElementById('searchbox').addEventListener('focus', e=>{
  if(e.target.value.trim()) renderSearchResults(state.filters.q);
});
document.addEventListener('click', e=>{
  if(!e.target.closest('#searchWrap')) hideSearchResults();
});
document.getElementById('searchbox').addEventListener('keydown', e=>{
  if(e.key==='Escape'){ hideSearchResults(); e.target.blur(); }
});

function hideSearchResults(){
  document.getElementById('searchResults').classList.remove('show');
}

// Выпадающий список результатов поиска — открывает страницу острова напрямую,
// даже если он не расставлен на карте (например, сюжетно уничтоженные аллоды,
// которые намеренно не показываются как метка на глобальной карте).
//
// Два слоя: имя (мгновенно, из уже загруженных state.data — то же самое,
// что фильтрует метки на карте) и полнотекстовый (по /api/search — c
// небольшой задержкой, ищет и внутри description/history/plot, не только
// в названии). Полнотекстовые совпадения, чьё название уже показано в первом
// слое, не дублируются.
let searchRequestSeq = 0;
function renderSearchResults(q){
  const box = document.getElementById('searchResults');
  if(!q){ box.classList.remove('show'); box.innerHTML=''; clearTimeout(searchDebounceTimer); return; }

  const nameMatches = state.data
    .filter(d=> d.name.toLowerCase().includes(q))
    .slice(0, 30);

  box.innerHTML = searchResultsHtml(nameMatches, null, true);
  wireSearchResultClicks(box);
  box.classList.add('show');

  clearTimeout(searchDebounceTimer);
  const mySeq = ++searchRequestSeq;
  searchDebounceTimer = setTimeout(async ()=>{
    let ftsMatches = [];
    try{ ftsMatches = await api('/search?q=' + encodeURIComponent(q)); }
    catch(e){ /* поиск по тексту недоступен — остаёмся с тем, что нашли по имени */ }
    if(mySeq !== searchRequestSeq) return; // пользователь успел напечатать ещё что-то, этот ответ уже устарел
    const nameIds = new Set(nameMatches.map(m=>m.id));
    const extra = ftsMatches.filter(m=> !nameIds.has(m.id));
    box.innerHTML = searchResultsHtml(nameMatches, extra, false);
    wireSearchResultClicks(box);
  }, 250);
}
let searchDebounceTimer = null;

// markToMark — сниппет с сервера приходит с временными маркерами \u0001/\u0002
// вокруг совпадений (НЕ HTML) — экранируем как обычный текст, а <mark> уже
// после escapeHtml, чтобы сам текст статьи не мог заинжектить разметку
function markToMark(snippet){
  if(!snippet) return '';
  return escapeHtml(snippet).replaceAll('\u0001', '<mark>').replaceAll('\u0002', '</mark>');
}

function searchResultsHtml(nameMatches, ftsExtra, ftsPending){
  if(!nameMatches.length && ftsExtra && !ftsExtra.length){
    return `<div class="sr-empty">Ничего не найдено${ftsPending ? '' : ' — ни по названию, ни в тексте статей'}</div>`;
  }
  const nameHtml = nameMatches.map(item=>{
    const placed = item.mapX!=null && item.mapY!=null;
    const meta = [item.faction, item.category].filter(Boolean).join(' · ');
    return `<div class="sr-item" data-id="${escapeHtml(item.id)}">
      <div class="sr-name">${escapeHtml(item.name)}</div>
      <div class="sr-meta">${meta?`<span>${escapeHtml(meta)}</span>`:''}${placed?'':'<span class="sr-badge unplaced">не на карте</span>'}</div>
    </div>`;
  }).join('');

  let ftsHtml = '';
  if(ftsPending){
    ftsHtml = `<div class="sr-fts-status">Ищу в тексте статей…</div>`;
  }else if(ftsExtra && ftsExtra.length){
    ftsHtml = `<div class="sr-fts-divider">Найдено в тексте статей</div>` + ftsExtra.map(item=>`
      <div class="sr-item sr-item-fts" data-id="${escapeHtml(item.id)}">
        <div class="sr-name">${escapeHtml(item.name)}</div>
        ${item.snippet ? `<div class="sr-snippet">${markToMark(item.snippet)}</div>` : ''}
        ${!item.placed ? '<span class="sr-badge unplaced">не на карте</span>' : ''}
      </div>
    `).join('');
  }
  return nameHtml + ftsHtml;
}

function wireSearchResultClicks(box){
  box.querySelectorAll('.sr-item').forEach(el=>{
    el.addEventListener('click', ()=>{
      hideSearchResults();
      document.getElementById('searchbox').value='';
      state.filters.q='';
      openDetail(el.dataset.id);
    });
  });
}

/* ====================== ACTIVE FILTER BAR ====================== */
function updateActiveFilterBar(){
  const bar = document.getElementById('activeFilterBar');
  const label = activeFilterLabel();
  if(label){
    document.getElementById('activeFilterLabel').textContent = label;
    bar.classList.remove('hidden');
  }else{
    bar.classList.add('hidden');
  }
}
document.getElementById('clearFilterBtn').addEventListener('click', ()=>{
  state.filters = { category:'', faction:'', q:'', archipelago:'', climate:'', size:'' };
  document.getElementById('catFilter').value='';
  document.getElementById('facFilter').value='';
  document.getElementById('searchbox').value='';
  if(state.view==='wiki') renderWiki();
  else{ renderMarkers(); renderTray(); }
  updateActiveFilterBar();
});

/* ====================== MAP RENDER ====================== */
function applyCamera(){
  mapCanvas.style.transform = `translate(${state.cam.x}px, ${state.cam.y}px) scale(${state.cam.scale})`;
}
// центрирует подложку карты (1669×1256) в реальном видимом окне #mapView —
// раньше тут были захардкожены x:-300,y:-150, что центрировало только на
// одном конкретном размере окна и на других съезжало влево
function centeredCamera(scale=0.72){
  const rect = mapView.getBoundingClientRect();
  const w = rect.width || window.innerWidth;
  const h = rect.height || (window.innerHeight - 64);
  const canvasW = mapCanvas.offsetWidth || 1669;
  const canvasH = mapCanvas.offsetHeight || 1256;
  return {
    scale,
    x: Math.round((w - canvasW*scale) / 2),
    y: Math.round((h - canvasH*scale) / 2),
  };
}
function renderMarkers(){
  mapCanvas.querySelectorAll('.marker').forEach(m=>m.remove());
  let placedCount = 0;
  state.data.forEach(item=>{
    if(item.mapX==null || item.mapY==null) return;
    if(!passesFilter(item)) return;
    placedCount++;
    const m = document.createElement('div');
    const destroyed = item.year_disappeared != null;
    const fc = facClass(item.faction);
    m.className = 'marker' + (state.editorOn ? ' editable' : '') + (fc ? ' fac-'+fc : '') + (destroyed ? ' destroyed' : '');
    m.dataset.fac = item.faction;
    m.dataset.id = item.id;
    m.style.left = item.mapX + 'px';
    m.style.top = item.mapY + 'px';
    const icon = dotIcon(item);
    const badge = categoryBadge(item);
    const raceIconUrl = factionIconFor(item.faction);
    const raceBadge = raceIconUrl ? `<span class="race-badge" title="${escapeHtml(item.faction)}"><img src="${escapeHtml(raceIconUrl)}" alt=""></span>` : '';
    const destroyedBadge = destroyed ? `<span class="destroyed-badge" title="Уничтожен${item.year_disappeared!=null ? ' в '+escapeHtml(String(item.year_disappeared))+' году' : ''}">⚰</span>` : '';
    m.innerHTML = `<div class="dot" style="width:${icon.px}px;height:${icon.px}px">${icon.html}${badge}${raceBadge}${destroyedBadge}</div><div class="lbl">${escapeHtml(item.name)}</div>`;
    m.addEventListener('click', (ev)=>{
      if(m.classList.contains('was-dragged')){ m.classList.remove('was-dragged'); return; }
      if(state.editorOn && (ev.ctrlKey || ev.metaKey)){ toggleMarkerSelection(item.id, m); return; }
      openDetail(item.id);
    });
    if(state.editorOn){ makeMarkerDraggable(m, item); }
    if(state.selectedAllodIds && state.selectedAllodIds.has(item.id)) m.classList.add('selected');
    mapCanvas.appendChild(m);
  });
  emptyHint.style.display = placedCount===0 ? 'block' : 'none';
}
// Возвращает { html, px } — либо кастомная иконка острова (item.icon_url), либо
// шаблонный "блоб" по размеру и климату (см. js/islandIcons.js), пока нет своей.
function dotIcon(item){
  if(item.icon_url){
    const px = ISLAND_SIZE_PX[item.size] || ISLAND_SIZE_PX['?'];
    return { px, html: `<img src="${escapeHtml(item.icon_url)}" alt="" draggable="false">` };
  }
  const tpl = templateIslandIcon(item.size, item.climate);
  return { px: tpl.px, html: tpl.svg };
}

function categoryBadge(item){
  const t = (item.category||'');
  if(t.includes('Противостояний')) return `<span class="badge badge-clash" title="Остров Противостояний">⚔</span>`;
  if(t.includes('Сюжет')) return `<span class="badge badge-plot" title="Сюжетный аллод">★</span>`;
  if(t.includes('Нестабильный')) return `<span class="badge badge-unstable" title="Нестабильный остров">◌</span>`;
  return '';
}

/* ====================== TRAY (unplaced) ====================== */
function renderTray(){
  trayList.innerHTML = '';
  const unplaced = state.data.filter(d=> (d.mapX==null||d.mapY==null) && passesFilter(d));
  document.getElementById('trayCount').textContent = unplaced.length;
  unplaced.forEach(item=>{
    const el = document.createElement('div');
    el.className='tray-item';
    el.textContent = item.name;
    const small = document.createElement('small');
    small.textContent = [item.faction, item.category].filter(Boolean).join(' · ');
    el.appendChild(small);
    startPointerDrag(el, {
      onStart: ()=> makeDragGhost(escapeHtml(item.name)),
      onEnd: async (x, y)=>{
        const rect = mapView.getBoundingClientRect();
        // палец/курсор должен быть отпущен именно над картой
        if(x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
        const mapX = Math.round((x - rect.left - state.cam.x) / state.cam.scale);
        const mapY = Math.round((y - rect.top - state.cam.y) / state.cam.scale);
        item.mapX = mapX; item.mapY = mapY;
        renderMarkers(); renderTray();
        try{ await api(`/allods/${item.id}`, { method:'PATCH', body:{ mapX, mapY } }); toast('Сохранено'); }
        catch(e){ toast('Ошибка сохранения: '+e.message); }
      }
    });
    trayList.appendChild(el);
  });
  // панель нужна только поверх карты — на странице острова/локации она бы перекрывала контент
  trayEl.classList.toggle('show', state.editorOn && state.view==='map');
  updateDrawToolbarVisibility();
}

// Единая точка правды для видимости панели рисования: кнопка-переключатель
// показывается в режиме редактора на карте, сама панель — только если ещё и
// явно открыта через неё (state.drawPanelOpen), это отдельный переключатель,
// не завязанный жёстко на editorOn — чтобы не мешать украшать карту, если
// сейчас просто расставляешь острова.
function updateDrawToolbarVisibility(){
  const onMapInEditor = state.editorOn && state.view==='map';
  const toggleBtn = document.getElementById('drawToggleBtn');
  const toolbar = document.getElementById('drawToolbar');
  toggleBtn.classList.toggle('show', onMapInEditor);
  toggleBtn.classList.toggle('active', onMapInEditor && state.drawPanelOpen);
  toolbar.classList.toggle('show', onMapInEditor && state.drawPanelOpen);
}

document.getElementById('drawToggleBtn').addEventListener('click', ()=>{
  state.drawPanelOpen = !state.drawPanelOpen;
  updateDrawToolbarVisibility();
});

document.getElementById('addAllodBtn').addEventListener('click', async ()=>{
  const name = prompt('Название нового острова:');
  if(!name || !name.trim()) return;
  try{
    const created = await api('/allods', { method:'POST', body:{ name: name.trim(), project: state.project } });
    state.data.push(created);
    renderMarkers(); renderTray();
    if(state.view==='wiki') renderWiki();
    openDetail(created.id);
  }catch(e){ toast('Ошибка: '+e.message); }
});

/* ====================== MARKER DRAG (reposition) ====================== */
function makeMarkerDraggable(el, item){
  let startX, startY, origLeft, origTop, moved=false;

  function begin(clientX, clientY){
    moved=false;
    startX=clientX; startY=clientY;
    origLeft = parseFloat(el.style.left); origTop = parseFloat(el.style.top);
    el.classList.add('dragging');
  }
  function move(clientX, clientY){
    const dx = (clientX-startX)/state.cam.scale;
    const dy = (clientY-startY)/state.cam.scale;
    if(Math.abs(dx)>2||Math.abs(dy)>2) moved=true;
    el.style.left = (origLeft+dx)+'px';
    el.style.top = (origTop+dy)+'px';
  }
  async function end(){
    el.classList.remove('dragging');
    if(moved){
      item.mapX = Math.round(parseFloat(el.style.left));
      item.mapY = Math.round(parseFloat(el.style.top));
      el.classList.add('was-dragged');
      try{ await api(`/allods/${item.id}`, { method:'PATCH', body:{ mapX:item.mapX, mapY:item.mapY } }); toast('Сохранено'); }
      catch(e){ toast('Ошибка сохранения: '+e.message); }
    }
  }

  el.addEventListener('mousedown', ev=>{
    ev.stopPropagation();
    begin(ev.clientX, ev.clientY);
    const onMove = mev=> move(mev.clientX, mev.clientY);
    const onUp = ()=>{
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      end();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  el.addEventListener('touchstart', ev=>{
    ev.stopPropagation();
    const t = ev.touches[0];
    begin(t.clientX, t.clientY);
    const onMove = tev=>{ tev.preventDefault(); move(tev.touches[0].clientX, tev.touches[0].clientY); };
    const onEnd = ()=>{
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      end();
    };
    document.addEventListener('touchmove', onMove, {passive:false});
    document.addEventListener('touchend', onEnd);
  }, {passive:true});
}

/* ====================== PAN / ZOOM ====================== */
let panning=false, panStartX, panStartY, camStartX, camStartY;
mapView.addEventListener('mousedown', ev=>{
  if(ev.target.closest('.marker')) return;
  if(state.drawTool) return; // рисование фигуры перетаскиванием — не панорама (см. annotations.js)
  panning=true;
  mapView.classList.add('dragging');
  panStartX=ev.clientX; panStartY=ev.clientY;
  camStartX=state.cam.x; camStartY=state.cam.y;
});
window.addEventListener('mousemove', ev=>{
  if(!panning) return;
  state.cam.x = camStartX + (ev.clientX-panStartX);
  state.cam.y = camStartY + (ev.clientY-panStartY);
  applyCamera();
});
window.addEventListener('mouseup', ()=>{ panning=false; mapView.classList.remove('dragging'); });
mapView.addEventListener('wheel', ev=>{
  ev.preventDefault();
  const delta = ev.deltaY>0 ? -0.08 : 0.08;
  zoomAt(ev.clientX, ev.clientY, delta);
}, {passive:false});
function zoomAt(clientX, clientY, delta){
  const rect = mapView.getBoundingClientRect();
  const mx = clientX-rect.left, my = clientY-rect.top;
  const worldX = (mx-state.cam.x)/state.cam.scale;
  const worldY = (my-state.cam.y)/state.cam.scale;
  let newScale = Math.min(2.2, Math.max(0.25, state.cam.scale+delta));
  state.cam.scale = newScale;
  state.cam.x = mx - worldX*newScale;
  state.cam.y = my - worldY*newScale;
  applyCamera();
}
document.getElementById('zoomIn').addEventListener('click', ()=>zoomAt(window.innerWidth/2, window.innerHeight/2, 0.15));
document.getElementById('zoomOut').addEventListener('click', ()=>zoomAt(window.innerWidth/2, window.innerHeight/2, -0.15));
document.getElementById('zoomReset').addEventListener('click', ()=>{ state.cam=centeredCamera(0.72); applyCamera(); });

/* ---------- сенсорное управление: один палец — панорама, два — pinch-zoom ---------- */
let touchMode = null; // 'pan' | 'pinch' | null
let touchStartX, touchStartY;
let pinchStartDist = 0, pinchStartScale = 1, pinchMidX = 0, pinchMidY = 0;

function touchDist(t1, t2){
  return Math.hypot(t1.clientX-t2.clientX, t1.clientY-t2.clientY);
}
function touchMid(t1, t2){
  return { x:(t1.clientX+t2.clientX)/2, y:(t1.clientY+t2.clientY)/2 };
}

mapView.addEventListener('touchstart', ev=>{
  if(ev.target.closest('.marker')) return; // маркеры сами обрабатывают свой touch (см. makeMarkerDraggable)
  if(ev.touches.length === 1){
    touchMode = 'pan';
    touchStartX = ev.touches[0].clientX; touchStartY = ev.touches[0].clientY;
    camStartX = state.cam.x; camStartY = state.cam.y;
  }else if(ev.touches.length === 2){
    touchMode = 'pinch';
    pinchStartDist = touchDist(ev.touches[0], ev.touches[1]);
    pinchStartScale = state.cam.scale;
    const mid = touchMid(ev.touches[0], ev.touches[1]);
    pinchMidX = mid.x; pinchMidY = mid.y;
  }
}, {passive:true});

mapView.addEventListener('touchmove', ev=>{
  if(touchMode === 'pan' && ev.touches.length === 1){
    ev.preventDefault();
    const dx = ev.touches[0].clientX - touchStartX;
    const dy = ev.touches[0].clientY - touchStartY;
    state.cam.x = camStartX + dx;
    state.cam.y = camStartY + dy;
    applyCamera();
  }else if(touchMode === 'pinch' && ev.touches.length === 2){
    ev.preventDefault();
    const dist = touchDist(ev.touches[0], ev.touches[1]);
    const ratio = dist / (pinchStartDist || 1);
    const newScale = Math.min(2.2, Math.max(0.25, pinchStartScale * ratio));
    const rect = mapView.getBoundingClientRect();
    const mx = pinchMidX - rect.left, my = pinchMidY - rect.top;
    const worldX = (mx-state.cam.x)/state.cam.scale;
    const worldY = (my-state.cam.y)/state.cam.scale;
    state.cam.scale = newScale;
    state.cam.x = mx - worldX*newScale;
    state.cam.y = my - worldY*newScale;
    applyCamera();
  }
}, {passive:false});

mapView.addEventListener('touchend', ev=>{
  if(ev.touches.length === 0) touchMode = null;
  else if(ev.touches.length === 1){
    // отпустили один из двух пальцев — переходим в режим панорамы оставшимся
    touchMode = 'pan';
    touchStartX = ev.touches[0].clientX; touchStartY = ev.touches[0].clientY;
    camStartX = state.cam.x; camStartY = state.cam.y;
  }
});

/* ====================== VIEW SWITCHING ====================== */
function showMap(){
  // если уходим со страницы конкретного острова — запомним, кого поймать
  // пингом на карте (маркеры не пересоздаются при переключении вида, так что
  // можно смело искать элемент сразу после рендера, без ожидания)
  const pingId = (state.view==='detail' || state.view==='location') ? state.currentId : null;
  state.view='map'; state.currentId=null; state.currentLocId=null;
  detailView.classList.remove('show');
  document.getElementById('wikiView').classList.remove('show');
  document.getElementById('configView').classList.remove('show');
  document.getElementById('aboutView').classList.remove('show');
  document.getElementById('sourcesView').classList.remove('show');
  document.getElementById('timelineView').classList.remove('show');
  document.getElementById('archipelagosView').classList.remove('show');
  mapView.style.display='block';
  document.getElementById('zoomCtrl').style.display='flex';
  document.querySelectorAll('.view-toggle-btn').forEach(b=> b.classList.toggle('active', b.dataset.view==='map'));
  renderTray();
  if(pingId) setTimeout(()=> pingMarker(pingId), 0);
}

// «Пинг» — острову, со страницы которого только что ушли, на карте моргает
// иконка и расходятся кольца волнами, чтобы сразу было видно, где он.
function pingMarker(id){
  const el = document.querySelector(`.marker[data-id="${cssEscape(id)}"]`);
  if(!el) return; // остров мог быть не размещён на карте вообще
  const dot = el.querySelector('.dot');
  if(!dot) return;
  el.classList.add('pinging');
  const ringCount = 3;
  for(let i=0;i<ringCount;i++){
    const ring = document.createElement('div');
    ring.className = 'marker-ping-ring';
    ring.style.animationDelay = (i*0.28)+'s';
    dot.appendChild(ring);
    setTimeout(()=> ring.remove(), 1700 + i*280);
  }
  setTimeout(()=> el.classList.remove('pinging'), 2000);
}
function cssEscape(s){
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}
document.getElementById('brand').addEventListener('click', showMap);
document.querySelectorAll('.view-toggle-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(btn.dataset.view==='map') showMap();
    else if(btn.dataset.view==='sources') showSources();
    else if(btn.dataset.view==='timeline') showTimeline();
    else if(btn.dataset.view==='archipelagos') showArchipelagos();
    else showWiki();
  });
});
