/* ====================== ARCHIPELAGOS (АРХИПЕЛАГИ) ======================
   Архипелаг — контейнер (allods.archipelago_id, FK), а не текстовый тег.
   Три точки входа для привязки острова к архипелагу:
   1) Атлас островов — кнопка "+🏝" у каждой строки (attachToArchipelagoFlow).
   2) Страница острова — выпадающий список (renderArchipelagoControl),
      как renderProjectControl.
   3) Карта в редакторе — ctrl/cmd+клик по нескольким маркерам подряд, потом
      плавающая панель "Собрать в архипелаг". */

let archipelagosCache = null;

async function loadArchipelagos(force=false){
  if(archipelagosCache && !force) return archipelagosCache;
  archipelagosCache = await api(`/archipelagos?project=${encodeURIComponent(state.project)}`);
  return archipelagosCache;
}

/* ---------------- глобальная страница ---------------- */
function showArchipelagos(){
  state.view = 'archipelagos';
  state.currentId = null; state.currentLocId = null;
  mapView.style.display='none';
  document.getElementById('zoomCtrl').style.display='none';
  document.getElementById('timelineSliderBar').classList.remove('show');
  detailView.classList.remove('show');
  document.getElementById('wikiView').classList.remove('show');
  document.getElementById('configView').classList.remove('show');
  document.getElementById('aboutView').classList.remove('show');
  document.getElementById('sourcesView').classList.remove('show');
  document.getElementById('timelineView').classList.remove('show');
  document.getElementById('recentChangesView').classList.remove('show');
  document.getElementById('archipelagosView').classList.add('show');
  document.querySelectorAll('.view-toggle-btn').forEach(b=> b.classList.toggle('active', b.dataset.view==='archipelagos'));
  trayEl.classList.remove('show');
  updateDrawToolbarVisibility();
  renderArchipelagosPage();
}

async function renderArchipelagosPage(){
  const wrap = document.getElementById('archipelagosView');
  wrap.innerHTML = `
    <div class="sources-hero">
      <h1>Архипелаги</h1>
      <p>Группы островов проекта «${escapeHtml(currentProjectLabel())}». Удаление архипелага не удаляет острова — только открепляет их.</p>
      ${state.editorOn ? `<button class="add-source-btn" id="addArchipelagoBtn">+ Новый архипелаг</button>` : ''}
    </div>
    <div class="sources-body" id="archipelagosList">Загрузка…</div>
  `;
  if(state.editorOn){
    document.getElementById('addArchipelagoBtn').addEventListener('click', async ()=>{
      const name = prompt('Название нового архипелага:');
      if(!name || !name.trim()) return;
      try{
        await api('/archipelagos', { method:'POST', body:{ name: name.trim(), project: state.project } });
        await loadArchipelagos(true);
        renderArchipelagosPage();
      }catch(e){ toast('Ошибка: '+e.message); }
    });
  }

  let archs;
  try{ archs = await loadArchipelagos(true); }
  catch(e){ document.getElementById('archipelagosList').innerHTML = `<div class="prose empty" data-empty="Не удалось загрузить архипелаги."></div>`; return; }

  const list = document.getElementById('archipelagosList');
  if(!archs.length){
    list.innerHTML = `<div class="prose empty" data-empty="Архипелагов пока нет."></div>`;
    return;
  }
  list.innerHTML = archs.map(a=>`
    <div class="source-card" data-archipelago-id="${escapeHtml(a.id)}">
      <div class="source-card-title">${escapeHtml(a.name)} <span class="wiki-count">${a.members.length}</span></div>
      ${a.members.length ? `<div class="source-card-refs">${a.members.map(m=>`
        <a class="source-ref-chip" href="#" data-action="open-detail" data-id="${escapeHtml(m.id)}">${escapeHtml(m.name)}${m.year_disappeared!=null?' ⚰':''}</a>
      `).join('')}</div>` : `<div class="source-card-note">Пока без островов.</div>`}
      ${state.editorOn ? `
        <div class="source-card-actions">
          <button data-action="rename-archipelago">Переименовать</button>
          <button data-action="delete-archipelago">Удалить (острова останутся)</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

document.getElementById('archipelagosView').addEventListener('click', async (ev)=>{
  const detailLink = ev.target.closest('[data-action="open-detail"]');
  if(detailLink){ ev.preventDefault(); openDetail(detailLink.dataset.id); return; }

  const card = ev.target.closest('.source-card');
  if(!card) return;
  const id = card.dataset.archipelagoId;
  if(ev.target.closest('[data-action="rename-archipelago"]')){
    const archs = await loadArchipelagos();
    const a = archs.find(x=>x.id===id);
    const name = prompt('Новое название архипелага:', a ? a.name : '');
    if(!name || !name.trim()) return;
    try{
      await api(`/archipelagos/${id}`, { method:'PATCH', body:{ name: name.trim() } });
      await loadArchipelagos(true);
      renderArchipelagosPage();
    }catch(e){ toast('Ошибка: '+e.message); }
  }else if(ev.target.closest('[data-action="delete-archipelago"]')){
    if(!confirm('Удалить архипелаг? Острова не удалятся, только открепятся от него.')) return;
    try{
      await api(`/archipelagos/${id}`, { method:'DELETE' });
      await loadArchipelagos(true);
      state.data = await api('/allods');
      renderArchipelagosPage();
    }catch(e){ toast('Ошибка: '+e.message); }
  }
});

/* ---------------- привязка одного острова (Атлас/страница острова) ---------------- */
async function attachToArchipelagoFlow(allodId){
  const archs = await loadArchipelagos(true);
  let body;
  if(archs.length){
    const list = archs.map((a,i)=>`${i+1}. ${a.name} (${a.members.length})`).join('\n');
    const answer = prompt(`Выберите номер существующего архипелага, либо впишите название нового:\n\n${list}`);
    if(answer === null) return false;
    const trimmed = answer.trim();
    if(!trimmed) return false;
    const asIndex = /^\d+$/.test(trimmed) ? parseInt(trimmed,10) : null;
    body = (asIndex && asIndex>=1 && asIndex<=archs.length)
      ? { allodIds: [allodId], archipelagoId: archs[asIndex-1].id }
      : { allodIds: [allodId], name: trimmed };
  }else{
    const name = prompt('Название нового архипелага:');
    if(!name || !name.trim()) return false;
    body = { allodIds: [allodId], name: name.trim() };
  }
  try{
    const res = await api('/archipelagos/assign', { method:'POST', body });
    const allod = byId(allodId);
    if(allod) allod.archipelago_id = res.archipelago.id;
    await loadArchipelagos(true);
    toast('Остров добавлен в архипелаг «'+res.archipelago.name+'»');
    return true;
  }catch(e){ toast('Ошибка: '+e.message); return false; }
}

/* ---------------- пикер на странице острова ---------------- */
async function renderArchipelagoControl(item){
  const wrap = document.getElementById('archipelagoControl');
  if(!wrap) return;
  if(!state.editorOn){
    if(!item.archipelago_id){ wrap.innerHTML = ''; return; }
    try{
      const archs = await api(`/archipelagos?project=${encodeURIComponent(item.project||state.project)}`);
      const a = archs.find(x=>x.id===item.archipelago_id);
      wrap.innerHTML = a ? `<div class="sidebar-fact"><span>Архипелаг</span><b>${escapeHtml(a.name)}</b></div>` : '';
    }catch(e){ wrap.innerHTML = ''; }
    return;
  }
  wrap.innerHTML = `<div class="section-label">Архипелаг</div><select id="archipelagoSelect" class="project-select"></select>`;
  const sel = document.getElementById('archipelagoSelect');
  let archs;
  try{ archs = await api(`/archipelagos?project=${encodeURIComponent(item.project||state.project)}`); }
  catch(e){ archs = []; }

  const noneOpt = document.createElement('option');
  noneOpt.value = ''; noneOpt.textContent = '— Нет —';
  if(!item.archipelago_id) noneOpt.selected = true;
  sel.appendChild(noneOpt);

  archs.forEach(a=>{
    const o = document.createElement('option');
    o.value = a.id; o.textContent = a.name;
    if(item.archipelago_id===a.id) o.selected = true;
    sel.appendChild(o);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__'; newOpt.textContent = '+ Новый архипелаг…';
  sel.appendChild(newOpt);

  sel.addEventListener('change', async ()=>{
    const prevValue = item.archipelago_id || '';
    if(sel.value === ''){
      try{
        await api('/archipelagos/unassign', { method:'POST', body:{ allodId: item.id } });
        item.archipelago_id = null;
        await loadArchipelagos(true);
        toast('Остров откреплён от архипелага');
      }catch(e){ toast('Ошибка: '+e.message); sel.value = prevValue; }
      return;
    }
    if(sel.value === '__new__'){
      const name = prompt('Название нового архипелага:');
      if(!name || !name.trim()){ sel.value = prevValue; return; }
      try{
        const res = await api('/archipelagos/assign', { method:'POST', body:{ allodIds:[item.id], name: name.trim() } });
        item.archipelago_id = res.archipelago.id;
        await loadArchipelagos(true);
        renderArchipelagoControl(item);
        toast('Архипелаг создан и остров привязан');
      }catch(e){ toast('Ошибка: '+e.message); sel.value = prevValue; }
      return;
    }
    try{
      const res = await api('/archipelagos/assign', { method:'POST', body:{ allodIds:[item.id], archipelagoId: sel.value } });
      item.archipelago_id = res.archipelago.id;
      await loadArchipelagos(true);
      toast('Остров привязан к архипелагу «'+res.archipelago.name+'»');
    }catch(e){ toast('Ошибка: '+e.message); sel.value = prevValue; }
  });
}

/* ---------------- ctrl+клик выделение на карте ---------------- */
function toggleMarkerSelection(id, el){
  if(!state.selectedAllodIds) state.selectedAllodIds = new Set();
  if(state.selectedAllodIds.has(id)){
    state.selectedAllodIds.delete(id);
    el.classList.remove('selected');
  }else{
    state.selectedAllodIds.add(id);
    el.classList.add('selected');
  }
  renderMapSelectionPanel();
}

function clearMapSelection(){
  if(state.selectedAllodIds) state.selectedAllodIds.clear();
  document.querySelectorAll('.marker.selected').forEach(m=>m.classList.remove('selected'));
  renderMapSelectionPanel();
}

function renderMapSelectionPanel(){
  let panel = document.getElementById('mapSelectionPanel');
  const count = state.selectedAllodIds ? state.selectedAllodIds.size : 0;
  if(count === 0){
    if(panel) panel.remove();
    return;
  }
  if(!panel){
    panel = document.createElement('div');
    panel.id = 'mapSelectionPanel';
    panel.className = 'map-selection-panel';
    document.getElementById('mapView').appendChild(panel);
  }
  panel.innerHTML = `
    <span>Выбрано: ${count} ${count===1?'остров':'острова(ов)'}</span>
    <button id="mapSelectionAssignBtn">Собрать в архипелаг</button>
    <button id="mapSelectionClearBtn" title="Снять выделение">✕</button>
  `;
  document.getElementById('mapSelectionAssignBtn').addEventListener('click', async ()=>{
    const ids = [...state.selectedAllodIds];
    const archs = await loadArchipelagos(true);
    let body;
    if(archs.length){
      const list = archs.map((a,i)=>`${i+1}. ${a.name} (${a.members.length})`).join('\n');
      const answer = prompt(`Собрать ${ids.length} остров(ов) в архипелаг — номер существующего или название нового:\n\n${list}`);
      if(answer === null) return;
      const trimmed = answer.trim();
      if(!trimmed) return;
      const asIndex = /^\d+$/.test(trimmed) ? parseInt(trimmed,10) : null;
      body = (asIndex && asIndex>=1 && asIndex<=archs.length)
        ? { allodIds: ids, archipelagoId: archs[asIndex-1].id }
        : { allodIds: ids, name: trimmed };
    }else{
      const name = prompt(`Название нового архипелага для ${ids.length} остров(ов):`);
      if(!name || !name.trim()) return;
      body = { allodIds: ids, name: name.trim() };
    }
    try{
      const res = await api('/archipelagos/assign', { method:'POST', body });
      ids.forEach(id=>{ const a = byId(id); if(a) a.archipelago_id = res.archipelago.id; });
      await loadArchipelagos(true);
      toast(`${res.updated} остров(ов) добавлено в «${res.archipelago.name}»`);
      clearMapSelection();
    }catch(e){ toast('Ошибка: '+e.message); }
  });
  document.getElementById('mapSelectionClearBtn').addEventListener('click', clearMapSelection);
}
