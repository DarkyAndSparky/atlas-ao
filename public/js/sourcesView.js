/* ====================== SOURCES ======================
   Два способа посмотреть на одни и те же данные:
   1) /api/sources — глобальный список для страницы «Источники» (весь сайт,
      не привязано к текущему project — статья по лору годится для любого).
   2) /api/sources/for/:entityType/:entityId — блок «Источники» на странице
      конкретного аллода/локации (detailView.js), только его привязки. */

let sourcesCache = null; // кэш глобального списка на время открытой вкладки — сбрасывается при любой мутации

async function loadSources(force=false){
  if(sourcesCache && !force) return sourcesCache;
  sourcesCache = await api('/sources');
  return sourcesCache;
}

/* ---------------- глобальная страница ---------------- */
function showSources(){
  state.view = 'sources';
  state.currentId = null; state.currentLocId = null;
  mapView.style.display='none';
  document.getElementById('zoomCtrl').style.display='none';
  document.getElementById('timelineSliderBar').classList.remove('show');
  detailView.classList.remove('show');
  document.getElementById('wikiView').classList.remove('show');
  document.getElementById('configView').classList.remove('show');
  document.getElementById('aboutView').classList.remove('show');
  document.getElementById('timelineView').classList.remove('show');
  document.getElementById('archipelagosView').classList.remove('show');
  document.getElementById('recentChangesView').classList.remove('show');
  document.getElementById('sourcesView').classList.add('show');
  document.querySelectorAll('.view-toggle-btn').forEach(b=> b.classList.toggle('active', b.dataset.view==='sources'));
  trayEl.classList.remove('show');
  updateDrawToolbarVisibility();
  renderSourcesPage();
  syncUrl();
}

// имя сущности по entity_type/entity_id — резолвится из уже загруженных
// state.data (все острова всех проектов, см. main.js: api('/allods')), без
// отдельного запроса. Если аллод/локация с тех пор удалены — рёбра всё равно
// подчистит DELETE-обработчик на сервере, но на случай гонки — просто
// пропускаем неразрешившуюся ссылку, не роняя рендер.
function resolveEntityLabel(entityType, entityId){
  if(entityType === 'allod'){
    const a = byId(entityId);
    return a ? { label:a.name, id:a.id } : null;
  }
  if(entityType === 'location'){
    for(const a of state.data){
      const loc = (a.locations||[]).find(l=>l.id===entityId);
      if(loc) return { label: `${loc.name} (${a.name})`, allodId:a.id, id:loc.id };
    }
    return null;
  }
  return null;
}

async function renderSourcesPage(){
  const wrap = document.getElementById('sourcesView');
  wrap.innerHTML = `
    <div class="sources-hero">
      <h1>Источники</h1>
      <p>Ссылки, на основе которых заполняется вики — форумные темы, статьи, официальные материалы. Список общий для всех проектов.</p>
      ${state.editorOn ? `<button class="add-source-btn" id="addGlobalSourceBtn">+ Добавить источник</button>` : ''}
    </div>
    <div class="sources-body" id="sourcesList">Загрузка…</div>
  `;
  if(state.editorOn){
    document.getElementById('addGlobalSourceBtn').addEventListener('click', async ()=>{
      const created = await createSourceFlow();
      if(created){ await loadSources(true); renderSourcesPage(); }
    });
  }
  let sources;
  try{ sources = await loadSources(true); }
  catch(e){ document.getElementById('sourcesList').innerHTML = `<div class="prose empty" data-empty="Не удалось загрузить источники."></div>`; return; }

  const list = document.getElementById('sourcesList');
  if(!sources.length){
    list.innerHTML = `<div class="prose empty" data-empty="Источников пока нет."></div>`;
    return;
  }
  list.innerHTML = sources.map(s=>{
    const refLinks = s.refs.map(r=>{
      const ent = resolveEntityLabel(r.entity_type, r.entity_id);
      if(!ent) return '';
      return `<a class="source-ref-chip" href="#" data-action="open-detail" data-id="${escapeHtml(ent.allodId||ent.id)}">${escapeHtml(ent.label)}</a>`;
    }).join('');
    return `
      <div class="source-card" data-source-id="${escapeHtml(s.id)}">
        <div class="source-card-title">${s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)}</div>
        ${s.note ? `<div class="source-card-note">${escapeHtml(s.note)}</div>` : ''}
        ${refLinks ? `<div class="source-card-refs">${refLinks}</div>` : `<div class="source-card-note">Пока нигде не упомянут.</div>`}
        ${state.editorOn ? `
          <div class="source-card-actions">
            <button data-action="edit-source">Изменить</button>
            <button data-action="delete-source">Удалить</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

/* ---------------- форма источника: title/url/note одним окном ---------------- */
let sourceFormOverlay, sourceFormResolve = null;
function ensureSourceFormDom(){
  if(sourceFormOverlay) return;
  sourceFormOverlay = document.createElement('div');
  sourceFormOverlay.className = 'modal-overlay';
  sourceFormOverlay.innerHTML = `
    <div class="modal-box" style="width:420px;">
      <div class="modal-title">Источник</div>
      <input class="ef-input sf-title" type="text" placeholder="Название (статья/тема)" autocomplete="off">
      <input class="ef-input sf-url" type="text" placeholder="Ссылка (необязательно)" autocomplete="off" style="margin-top:8px;">
      <textarea class="ef-input sf-note" placeholder="Заметка (необязательно)" rows="3" style="resize:vertical;margin-top:8px;"></textarea>
      <div class="modal-actions">
        <button class="field-cancel">Отмена</button>
        <button class="field-save">Сохранить</button>
      </div>
    </div>
  `;
  document.body.appendChild(sourceFormOverlay);
  const titleEl = sourceFormOverlay.querySelector('.sf-title');
  const urlEl = sourceFormOverlay.querySelector('.sf-url');
  const noteEl = sourceFormOverlay.querySelector('.sf-note');
  const saveBtn = sourceFormOverlay.querySelector('.field-save');
  const cancelBtn = sourceFormOverlay.querySelector('.field-cancel');
  const close = (result)=>{
    sourceFormOverlay.classList.remove('show');
    if(sourceFormResolve){ const r = sourceFormResolve; sourceFormResolve = null; r(result); }
  };
  const submit = ()=>{
    if(!titleEl.value.trim()) return;
    close({ title: titleEl.value.trim(), url: urlEl.value.trim(), note: noteEl.value.trim() });
  };
  saveBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', ()=> close(null));
  sourceFormOverlay.addEventListener('mousedown', e=>{ if(e.target===sourceFormOverlay) close(null); });
  sourceFormOverlay.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ e.preventDefault(); close(null); }
    if(e.key==='Enter' && e.target!==noteEl){ e.preventDefault(); submit(); }
  });
  sourceFormOverlay._els = { titleEl, urlEl, noteEl };
}
function sourceFormFlow(initial={}){
  ensureSourceFormDom();
  const { titleEl, urlEl, noteEl } = sourceFormOverlay._els;
  titleEl.value = initial.title || '';
  urlEl.value = initial.url || '';
  noteEl.value = initial.note || '';
  sourceFormOverlay.classList.add('show');
  setTimeout(()=> titleEl.focus(), 0);
  return new Promise(resolve=>{ sourceFormResolve = resolve; });
}

async function createSourceFlow(){
  const result = await sourceFormFlow({});
  if(!result) return null;
  try{
    const created = await api('/sources', { method:'POST', body:{ title: result.title, url: result.url||null, note: result.note } });
    toast('Источник добавлен');
    return created;
  }catch(e){ toast('Ошибка: '+e.message); return null; }
}

async function editSourceFlow(sourceId){
  const sources = await loadSources();
  const s = sources.find(x=>x.id===sourceId);
  if(!s) return;
  const result = await sourceFormFlow({ title:s.title, url:s.url, note:s.note });
  if(!result) return;
  try{
    await api(`/sources/${sourceId}`, { method:'PATCH', body:{ title: result.title, url: result.url||null, note: result.note } });
    await loadSources(true);
    toast('Сохранено');
  }catch(e){ toast('Ошибка: '+e.message); }
}

async function deleteSourceFlow(sourceId){
  const ok = await confirmDialog({
    title:'Удалить источник?',
    message:'Все привязки к аллодам/локациям тоже пропадут. Это необратимо.',
    confirmLabel:'Удалить', danger:true
  });
  if(!ok) return;
  try{
    await api(`/sources/${sourceId}`, { method:'DELETE' });
    await loadSources(true);
    toast('Источник удалён');
    renderSourcesPage();
  }catch(e){ toast('Ошибка: '+e.message); }
}

document.getElementById('sourcesView').addEventListener('click', (ev)=>{
  const detailLink = ev.target.closest('[data-action="open-detail"]');
  if(detailLink){ ev.preventDefault(); openDetail(detailLink.dataset.id); return; }
  const card = ev.target.closest('.source-card');
  if(!card) return;
  const sourceId = card.dataset.sourceId;
  if(ev.target.closest('[data-action="edit-source"]')){
    editSourceFlow(sourceId).then(()=> renderSourcesPage());
  }else if(ev.target.closest('[data-action="delete-source"]')){
    deleteSourceFlow(sourceId);
  }
});

/* ---------------- блок на странице аллода/локации ---------------- */
// entityType/entityId — 'allod'/item.id или 'location'/loc.id. wrap — DOM-узел
// секции (см. detailView.js: <div class="section" id="sourcesSection">).
async function renderEntitySources(wrap, entityType, entityId){
  wrap.innerHTML = `<div class="section-label">Источники</div><div class="entity-sources-list" id="entitySourcesList">Загрузка…</div>`;
  let refs;
  try{ refs = await api(`/sources/for/${entityType}/${entityId}`); }
  catch(e){ document.getElementById('entitySourcesList').innerHTML = ''; return; }

  const listEl = document.getElementById('entitySourcesList');
  if(!refs.length){
    listEl.innerHTML = state.editorOn ? '' : `<div class="prose empty" data-empty="Источники ещё не привязаны."></div>`;
  }else{
    listEl.innerHTML = refs.map(({ref, source})=>`
      <div class="entity-source-item" data-ref-id="${escapeHtml(ref.id)}">
        <span>${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a>` : escapeHtml(source.title)}${ref.note ? ` <span class="note">— ${escapeHtml(ref.note)}</span>` : ''}</span>
        ${state.editorOn ? `<button class="entity-source-remove" data-action="remove-entity-source" title="Отвязать источник">✕</button>` : ''}
      </div>
    `).join('');
  }

  if(state.editorOn){
    const btn = document.createElement('button');
    btn.className = 'add-source-btn';
    btn.textContent = '+ Добавить источник';
    btn.addEventListener('click', async ()=>{
      const attached = await attachSourceFlow(entityType, entityId);
      if(attached) renderEntitySources(wrap, entityType, entityId);
    });
    wrap.appendChild(btn);
  }

  listEl.querySelectorAll('[data-action="remove-entity-source"]').forEach(b=>{
    b.addEventListener('click', async (ev)=>{
      const refId = ev.target.closest('.entity-source-item').dataset.refId;
      try{
        await api(`/source-refs/${refId}`, { method:'DELETE' });
        renderEntitySources(wrap, entityType, entityId);
      }catch(e){ toast('Ошибка: '+e.message); }
    });
  });
}

// прикрепить источник к сущности: выбрать номер из уже существующих
// (которые ещё не привязаны к этой сущности) либо создать новый — тот же
// UX-паттерн, что и editTagField() в detailView.js
async function attachSourceFlow(entityType, entityId){
  let alreadyAttached;
  try{ alreadyAttached = new Set((await api(`/sources/for/${entityType}/${entityId}`)).map(x=>x.source.id)); }
  catch(e){ alreadyAttached = new Set(); }

  const all = await loadSources(true);
  const available = all.filter(s=>!alreadyAttached.has(s.id));

  let sourceId;
  if(available.length){
    const value = await pickFromList({
      title: 'Прикрепить источник',
      items: available.map(s=> `${s.title}${s.url ? ' — '+s.url : ''}`),
      allowCreate: true,
      createLabel: v=> `+ Создать источник «${v}»`,
      placeholder: 'Название источника…'
    });
    if(value===null) return false;
    const trimmed = value.trim();
    const match = available.find(s=> `${s.title}${s.url ? ' — '+s.url : ''}` === value);
    if(match){
      sourceId = match.id;
    }else if(trimmed){
      const url = await textPrompt({ title:'Ссылка на источник', placeholder:'https:// (можно оставить пустым)' });
      if(url === null) return false;
      try{
        const created = await api('/sources', { method:'POST', body:{ title: trimmed, url: url.trim()||null } });
        sourceId = created.id;
      }catch(e){ toast('Ошибка: '+e.message); return false; }
    }else{
      return false;
    }
  }else{
    const created = await createSourceFlow();
    if(!created) return false;
    sourceId = created.id;
  }

  const note = (await textPrompt({ title:'Заметка о привязке', placeholder:'Например: «описание климата взято отсюда»' })) || '';
  try{
    await api('/source-refs', { method:'POST', body:{ sourceId, entityType, entityId, note: note.trim() } });
    await loadSources(true);
    toast('Источник привязан');
    return true;
  }catch(e){ toast('Ошибка: '+e.message); return false; }
}
