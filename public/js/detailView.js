/* ====================== VIEW ENTRY ====================== */
function openDetail(id, locId=null){
  if(state.view==='map' || state.view==='wiki' || state.view==='sources' || state.view==='timeline' || state.view==='archipelagos' || state.view==='recentChanges') state.returnView = state.view;
  if(typeof clearMapSelection==='function') clearMapSelection(); // уходим с карты — снимаем ctrl+клик выделение архипелага, если было
  state.view = locId? 'location':'detail';
  state.currentId = id;
  state.currentLocId = locId;
  mapView.style.display='none';
  document.getElementById('zoomCtrl').style.display='none';
  document.getElementById('timelineSliderBar').classList.remove('show');
  document.getElementById('wikiView').classList.remove('show');
  document.getElementById('configView').classList.remove('show');
  document.getElementById('aboutView').classList.remove('show');
  document.getElementById('sourcesView').classList.remove('show');
  document.getElementById('timelineView').classList.remove('show');
  document.getElementById('archipelagosView').classList.remove('show');
  document.getElementById('recentChangesView').classList.remove('show');
  detailView.classList.add('show');
  renderDetail();
  renderTray();
  detailView.scrollTop=0;
  syncUrl();
}

/* ====================== DETAIL RENDERING ====================== */
function renderDetail(){
  const item = byId(state.currentId);
  if(!item){ showMap(); return; }
  const facCls = facClass(item.faction);
  const heroImg = item.gallery && item.gallery.length ? item.gallery[0].url : null;
  const heroStyle = heroImg ? `style="background-image:url('${escapeHtml(heroImg)}')"` : '';
  detailView.innerHTML = `
    <div class="detail-hero${heroImg?' has-image':''}" ${heroStyle}>
      <div class="breadcrumb">
        <span class="breadcrumb-link" data-action="show-map">Атлас</span>
        ${renderBreadcrumbArchipelago(item)}
        / ${escapeHtml(item.name)}
      </div>
      <h1 contenteditable="${state.editorOn}" data-field="name">${escapeHtml(item.name)}</h1>
      ${state.editorOn ? `<div class="field-actions" data-for="name"><button class="field-save">Сохранить</button><button class="field-cancel">Отмена</button></div>` : ''}
      ${item.lastUpdatedAt ? (authStatus.loggedIn
        ? `<button class="last-updated-badge" data-action="jump-to-diff" data-snapshot-id="${escapeHtml(item.lastSnapshotId)}" title="${new Date(item.lastUpdatedAt).toLocaleString('ru-RU')}">Обновлено ${timeAgo(item.lastUpdatedAt)} — что изменилось?</button>`
        : `<span class="last-updated-badge" style="cursor:default;" title="${new Date(item.lastUpdatedAt).toLocaleString('ru-RU')}">Обновлено ${timeAgo(item.lastUpdatedAt)}</span>`
      ) : ''}
      <button class="report-issue-btn" data-action="report-issue" title="Сообщить об ошибке в описании этого острова">⚠ Сообщить об ошибке</button>
      <button class="del-allod editor-hidden" id="delAllodBtn" title="Удалить остров">✕ Удалить остров</button>
      ${item.year_disappeared!=null ? `<div class="destroyed-banner">⚰ Остров уничтожен в ${escapeHtml(String(item.year_disappeared))} году</div>` : ''}
      <div class="tag-row">
        ${(item.mapX==null || item.mapY==null) ? `<span class="tag tag-unplaced" title="Этот остров есть в базе, но не отмечен на глобальной карте">✕ не на карте</span>`:''}
        ${renderEditableTag(item, 'faction', 'фракцию', `fac-${facCls}`)}
        ${renderEditableTag(item, 'category', 'категорию')}
        ${renderEditableTag(item, 'climate', 'климат')}
        ${renderEditableTag(item, 'size', 'размер')}
      </div>
    </div>
    <div class="detail-body">
      <div class="detail-grid">
        <div>
          <div class="section">
            <div class="section-label">Описание</div>
            ${state.editorOn ? `<div class="prose-toolbar" data-for="description"><button data-md="**" title="Жирный" aria-label="Жирный текст">Ж</button><button data-md="*" title="Курсив" aria-label="Курсив"><i>К</i></button><button data-md="@" title="Ссылка на остров (@Название или @&quot;Два слова&quot;)" aria-label="Вставить ссылку на остров">@</button></div>` : ''}
            <div class="prose ${item.description?'':'empty'}" data-empty="Описание ещё не добавлено — включите редактор, чтобы написать его."
                 contenteditable="${state.editorOn}" data-field="description">${state.editorOn ? escapeHtml(item.description) : parseProse(item.description)}</div>
            ${state.editorOn ? `<div class="field-actions" data-for="description"><button class="field-save">Сохранить</button><button class="field-cancel">Отмена</button></div>` : ''}
          </div>
          <div class="section">
            <div class="section-label">История</div>
            ${state.editorOn ? `<div class="prose-toolbar" data-for="history"><button data-md="**" title="Жирный" aria-label="Жирный текст">Ж</button><button data-md="*" title="Курсив" aria-label="Курсив"><i>К</i></button><button data-md="@" title="Ссылка на остров (@Название или @&quot;Два слова&quot;)" aria-label="Вставить ссылку на остров">@</button></div>` : ''}
            <div class="prose ${item.history?'':'empty'}" data-empty="История аллода ещё не записана."
                 contenteditable="${state.editorOn}" data-field="history">${state.editorOn ? escapeHtml(item.history) : parseProse(item.history)}</div>
            ${state.editorOn ? `<div class="field-actions" data-for="history"><button class="field-save">Сохранить</button><button class="field-cancel">Отмена</button></div>` : ''}
          </div>
          <div class="section">
            <div class="section-label">Галерея</div>
            <div class="gallery" id="galleryWrap"></div>
          </div>
          <div class="section" id="locMapSection"></div>
          <div class="section">
            <div class="section-label">Локации</div>
            <div class="locations-list" id="locationsWrap"></div>
            <button class="add-location editor-hidden" id="addLocBtn">+ Добавить локацию</button>
          </div>
          <div class="section" id="relatedSection"></div>
          <div class="section" id="timelineSection"></div>
          <div class="section" id="sourcesSection"></div>
          <div class="section" id="historySection"></div>
        </div>
        <div>
          <div class="section-label">Сведения</div>
          ${sidebarFact('Владелец', item.holder, 'holder')}
          ${sidebarFact('Тип', item.type, 'type')}
          ${sidebarFact('Дополнение', item.expansion, 'expansion')}
          ${sidebarFact('Карта локации', item.hasMap ? 'есть' : null)}
          ${sidebarFact('Сюжет', item.plot, 'plot')}
          ${sidebarFact('Год появления', item.year_appeared!=null ? String(item.year_appeared) : null, 'year_appeared')}
          ${sidebarFact('Год исчезновения', item.year_disappeared!=null ? String(item.year_disappeared) : null, 'year_disappeared')}
          ${sidebarFact('Проект', item.project)}
          <div class="icon-control" id="iconControl"></div>
          <div class="icon-control" id="projectControl"></div>
          <div class="icon-control" id="archipelagoControl"></div>
        </div>
      </div>
    </div>
  `;
  bindEditableFields(item);
  bindProseToolbars(detailView);
  renderGallery(item.gallery, 'galleryWrap', 'allod', item.id,
    async (galId)=>{ await api(`/gallery/${galId}`, {method:'DELETE'}); item.gallery = item.gallery.filter(g=>g.id!==galId); renderDetail(); },
    async (result)=>{ item.gallery.push(result); renderDetail(); }
  );
  renderLocationMiniMap(item);
  renderLocations(item);
  renderRelated(item);
  renderAllodTimeline(document.getElementById('timelineSection'), item.id);
  renderEntitySources(document.getElementById('sourcesSection'), 'allod', item.id);
  renderAllodHistory(document.getElementById('historySection'), item.id);
  renderIconControl(item);
  renderProjectControl(item);
  renderArchipelagoControl(item);
  if(state.editorOn) document.getElementById('addLocBtn').classList.remove('editor-hidden');
  document.getElementById('addLocBtn').onclick = async ()=>{
    const name = await textPrompt({ title:'Новая локация', placeholder:'Название локации', required:true });
    if(!name) return;
    try{
      const updated = await api(`/allods/${item.id}/locations`, { method:'POST', body:{ name } });
      Object.assign(item, updated);
      renderDetail();
    }catch(e){ toast('Ошибка: '+e.message); }
  };
  if(state.editorOn) document.getElementById('delAllodBtn').classList.remove('editor-hidden');
  document.getElementById('delAllodBtn').onclick = async ()=>{
    const ok = await confirmDialog({
      title:'Удалить остров?',
      message:`«${item.name}» будет удалён целиком, вместе со всеми локациями и галереей. Это необратимо.`,
      confirmLabel:'Удалить', danger:true
    });
    if(!ok) return;
    try{
      await api(`/allods/${item.id}`, { method:'DELETE' });
      state.data = state.data.filter(d=>d.id!==item.id);
      toast('Остров удалён');
      showMap();
      renderMarkers(); renderTray();
    }catch(e){ toast('Ошибка: '+e.message); }
  };
}

function renderRelated(item){
  const wrap = document.getElementById('relatedSection');
  if(!wrap) return;
  const sameArchipelago = item.archipelago
    ? state.data.filter(d=> d.id!==item.id && d.archipelago===item.archipelago)
    : [];
  const sameCategory = state.data.filter(d=> d.id!==item.id && d.category===item.category && !sameArchipelago.some(x=>x.id===d.id));
  const related = [...sameArchipelago, ...sameCategory].slice(0, 6);
  if(!related.length){ wrap.innerHTML=''; return; }
  wrap.innerHTML = `
    <div class="section-label">Похожие острова</div>
    <div class="related-list">
      ${related.map(r=>`<span class="related-chip" data-action="open-detail" data-id="${escapeHtml(r.id)}">${escapeHtml(r.name)}${r.archipelago===item.archipelago && item.archipelago ? '' : ''}</span>`).join('')}
    </div>
  `;
}

function sidebarFact(label, value, editField){
  if(state.editorOn && editField){
    return `<div class="sidebar-fact clickable" data-action="edit-plain" data-field="${editField}" data-label="${escapeHtml(label)}" title="Изменить">
      <span>${escapeHtml(label)}</span><b>${value ? escapeHtml(value) : '<span class="fact-empty">— задать —</span>'}</b>
    </div>`;
  }
  if(!value) return '';
  return `<div class="sidebar-fact"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

// Простой inline-редактор для свободнотекстовых полей сайдбара (Владелец,
// Тип, Дополнение, Сюжет) — без списка «уже использующихся значений», в
// отличие от editTagField(): это скорее заметки, чем таксономия.
async function editPlainField(field, label){
  const item = byId(state.currentId);
  if(!item) return;
  const answer = await textPrompt({ title:`Изменить «${label}»`, initialValue: item[field] || '', placeholder: label });
  if(answer===null) return;
  const value = answer.trim();
  try{
    await api(`/allods/${item.id}`, { method:'PATCH', body:{ [field]: value || null } });
    item[field] = value || null;
    renderDetail();
    toast('Сохранено');
  }catch(e){ toast('Ошибка: '+e.message); }
}

function renderProjectControl(item){
  const wrap = document.getElementById('projectControl');
  if(!wrap || !state.editorOn) { if(wrap) wrap.innerHTML=''; return; }
  wrap.innerHTML = `
    <div class="section-label">Проект</div>
    <select id="projectSelect" class="project-select"></select>
  `;
  const sel = document.getElementById('projectSelect');
  const currentValue = item.project || PROJECTS[0].id;
  const knownIds = new Set(PROJECTS.map(p=>p.id));
  const options = PROJECTS.slice();
  if(!knownIds.has(currentValue)) options.push({ id: currentValue, label: currentValue }); // см. комментарий в renderProjectSwitcher
  options.forEach(p=>{
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.label;
    if(currentValue===p.id) o.selected = true;
    sel.appendChild(o);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__'; newOpt.textContent = '+ Новый проект…';
  sel.appendChild(newOpt);
  sel.addEventListener('change', async ()=>{
    let newProject = sel.value;
    if(newProject==='__new__'){
      const name = await textPrompt({ title:'Новый проект', placeholder:'Название проекта', required:true });
      if(!name || !name.trim()){ sel.value = currentValue; return; }
      newProject = name.trim();
    }
    try{
      await api(`/allods/${item.id}`, { method:'PATCH', body:{ project: newProject } });
      item.project = newProject;
      toast('Проект изменён — остров переехал в «'+currentProjectLabelFor(newProject)+'»');
      if(newProject !== state.project){
        // остров больше не относится к выбранному сейчас проекту — возвращаемся в каталог
        showMap();
      }else{
        renderMarkers();
      }
    }catch(e){ toast('Ошибка: '+e.message); }
  });
}
function currentProjectLabelFor(id){
  const p = PROJECTS.find(p=>p.id===id);
  return p ? p.label : id;
}

function renderIconControl(item){
  const wrap = document.getElementById('iconControl');
  if(!wrap) return;
  const preview = item.icon_url
    ? `<img src="${escapeHtml(item.icon_url)}" alt="">`
    : templateIslandIconFixed(item.size, item.climate, 40);
  if(!state.editorOn){
    wrap.innerHTML = `
      <div class="section-label">Иконка на карте</div>
      <div class="icon-preview">${preview}</div>
      ${!item.icon_url ? `<div class="icon-note">Заготовка по размеру и климату</div>` : ''}
    `;
    return;
  }
  wrap.innerHTML = `
    <div class="section-label">Иконка на карте</div>
    <div class="icon-preview">${preview}</div>
    <div class="icon-note">${item.icon_url ? 'Своя иконка' : 'Заготовка по размеру и климату — можно заменить своей'}</div>
    <div class="icon-actions">
      <button class="btn-small" id="setIconBtn">${item.icon_url?'Заменить':'Добавить свою'}</button>
      ${item.icon_url ? `<button class="btn-small" id="clearIconBtn">Вернуть заготовку</button>` : ''}
    </div>
  `;
  document.getElementById('setIconBtn').addEventListener('click', ()=> openIconSetMenu(item));
  const clearBtn = document.getElementById('clearIconBtn');
  if(clearBtn){
    clearBtn.addEventListener('click', async ()=>{
      item.icon_url = null;
      try{ await api(`/allods/${item.id}`, { method:'PATCH', body:{ icon_url: null } }); renderMarkers(); }
      catch(e){ toast('Ошибка: '+e.message); }
      renderIconControl(item);
    });
  }
}

async function openIconSetMenu(item){
  const useFile = await confirmDialog({
    title:'Установить иконку острова',
    message:'Загрузить файл с компьютера или вставить ссылку на изображение?',
    confirmLabel:'Файл с компьютера', cancelLabel:'Вставить ссылку'
  });
  if(useFile){
    const input = document.createElement('input');
    input.type='file'; input.accept='image/*';
    input.onchange = async ()=>{
      const file = input.files[0];
      if(!file) return;
      const fd = new FormData();
      fd.append('image', file);
      try{
        const result = await api(`/allods/${item.id}/icon`, { method:'POST', body: fd });
        item.icon_url = result.icon_url;
        renderMarkers();
        renderIconControl(item);
      }catch(e){ toast('Ошибка загрузки: '+e.message); }
    };
    input.click();
  }else{
    const url = await textPrompt({ title:'Ссылка на иконку', placeholder:'https://…', required:true });
    if(!url) return;
    item.icon_url = url.trim();
    api(`/allods/${item.id}`, { method:'PATCH', body:{ icon_url: url.trim() } })
      .then(()=>{ renderMarkers(); renderIconControl(item); })
      .catch(e=> toast('Ошибка: '+e.message));
  }
}

// Тег: вне режима редактора — обычный кликабельный фильтр (как раньше).
// В режиме редактора — клик открывает editTagField() вместо фильтрации;
// если поле у острова ещё не заполнено, показываем «призрачную» кнопку
// "+ добавить X", чтобы это поле вообще можно было завести впервые.
function renderEditableTag(item, field, label, extraClass=''){
  const value = item[field];
  const iconUrl = field==='faction' ? factionIconFor(value) : null;
  const iconHtml = iconUrl ? `<img class="tag-faction-icon" src="${escapeHtml(iconUrl)}" alt="">` : '';
  if(state.editorOn){
    if(value){
      return `<span class="tag ${extraClass} clickable" data-action="edit-tag" data-field="${field}" title="Изменить ${escapeHtml(label)}">${iconHtml}${escapeHtml(value)} <span class="tag-edit-mark">✎</span></span>`;
    }
    return `<span class="tag tag-add-ghost clickable" data-action="edit-tag" data-field="${field}">+ ${escapeHtml(label)}</span>`;
  }
  if(!value) return '';
  return `<span class="tag ${extraClass} clickable" data-action="filter-tag" data-field="${field}" data-value="${escapeHtml(value)}">${iconHtml}${escapeHtml(value)}</span>`;
}

function renderBreadcrumbArchipelago(item){
  if(state.editorOn){
    return item.archipelago
      ? ` / <span class="breadcrumb-link" data-action="edit-tag" data-field="archipelago" title="Изменить архипелаг">${escapeHtml(item.archipelago)} ✎</span>`
      : ` / <span class="breadcrumb-link" data-action="edit-tag" data-field="archipelago">+ архипелаг</span>`;
  }
  return item.archipelago
    ? ` / <span class="breadcrumb-link" data-action="filter-tag" data-field="archipelago" data-value="${escapeHtml(item.archipelago)}">${escapeHtml(item.archipelago)}</span>`
    : '';
}

const TAG_FIELD_LABELS = { faction:'фракцию', category:'категорию', climate:'климат', size:'размер', archipelago:'архипелаг' };

// Простой «редактор фракций/категорий»: без отдельной админ-панели, но даёт
// выбрать одно из уже используемых в базе значений (так группы не плодятся
// в вариациях написания) либо ввести новое, либо очистить поле совсем.
async function editTagField(field){
  const item = byId(state.currentId);
  if(!item) return;
  const existing = [...new Set(state.data.map(d=>d[field]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  const label = TAG_FIELD_LABELS[field] || field;
  const value = await pickFromList({
    title: `Изменить ${label}`,
    items: existing,
    allowCreate: true,
    passEmpty: true,
    initialValue: item[field] || '',
    placeholder: `Введите или выберите ${label}…`
  });
  if(value===null) return; // отмена
  try{
    await api(`/allods/${item.id}`, { method:'PATCH', body:{ [field]: value || null } });
    item[field] = value || null;
    renderDetail();
    renderMarkers();
    toast('Сохранено');
  }catch(e){ toast('Ошибка: '+e.message); }
}

function filterByTag(field, value){
  state.filters = { category:'', faction:'', q:'', archipelago:'', climate:'', size:'' };
  state.filters[field] = value;
  document.getElementById('searchbox').value = '';
  document.getElementById('catFilter').value = '';
  document.getElementById('facFilter').value = '';
  if(state.returnView==='wiki'){
    showWiki(); // showWiki() сама вызывает updateActiveFilterBar()
  }else{
    showMap();
    renderMarkers(); renderTray();
    updateActiveFilterBar();
  }
}

/* ====================== LOCATIONS (inline mini-blocks) ====================== */
function renderLocations(item){
  const wrap = document.getElementById('locationsWrap');
  wrap.innerHTML='';
  if(!item.locations.length){
    wrap.innerHTML = `<div class="prose empty" data-empty="Локации ещё не добавлены."></div>`;
    return;
  }
  item.locations.forEach(loc=>{
    const block = document.createElement('div');
    block.className='location-block';
    block.id = 'loc-block-' + loc.id;
    block.dataset.locId = loc.id;
    block.innerHTML = `
      <div class="loc-head">
        ${state.editorOn ? `<span class="loc-drag" title="Перетащите, чтобы изменить порядок">⠿</span>` : ''}
        <div class="loc-name" contenteditable="${state.editorOn}" data-loc-field="name">${escapeHtml(loc.name)}</div>
        <button class="del" title="Удалить локацию" aria-label="Удалить локацию «${escapeHtml(loc.name)}»">✕</button>
      </div>
      ${state.editorOn ? `<div class="field-actions" data-for="loc-name-${loc.id}"><button class="field-save">Сохранить</button><button class="field-cancel">Отмена</button></div>` : ''}
      ${state.editorOn ? `<div class="prose-toolbar" data-for="loc-desc-${loc.id}"><button data-md="**" title="Жирный" aria-label="Жирный текст">Ж</button><button data-md="*" title="Курсив" aria-label="Курсив"><i>К</i></button><button data-md="@" title="Ссылка на остров" aria-label="Вставить ссылку на остров">@</button></div>` : ''}
      <div class="prose loc-desc ${loc.description?'':'empty'}" data-empty="Описание локации ещё не добавлено."
           contenteditable="${state.editorOn}" data-loc-field="description">${state.editorOn ? escapeHtml(loc.description) : parseProse(loc.description)}</div>
      ${state.editorOn ? `<div class="field-actions" data-for="loc-desc-${loc.id}"><button class="field-save">Сохранить</button><button class="field-cancel">Отмена</button></div>` : ''}
      <div class="gallery loc-gallery" id="gal-${loc.id}"></div>
    `;
    const nameEl = block.querySelector('[data-loc-field="name"]');
    wireEditableField(nameEl, block.querySelector(`[data-for="loc-name-${loc.id}"]`), async (val, restoreValue)=>{
      const result = await patchWithConflict({
        url: `/locations/${loc.id}`, field:'name', fieldLabel:'Название локации',
        val, expectedRev: loc.rev,
        extractTheirValue: current=> (current.locations.find(l=>l.id===loc.id)||{}).name,
        extractRev: current=> (current.locations.find(l=>l.id===loc.id)||{}).rev
      });
      loc.name = val;
      loc.rev = (result.locations.find(l=>l.id===loc.id)||{}).rev;
      toast('Сохранено', async ()=>{
        loc.name = restoreValue;
        const r = await api(`/locations/${loc.id}`, { method:'PATCH', body:{ name: restoreValue, expectedRev: loc.rev } });
        loc.rev = (r.locations.find(l=>l.id===loc.id)||{}).rev;
        if(state.currentId===item.id) renderDetail();
      });
    }, { required:true, requiredMsg:'Название локации не может быть пустым — отменено.' });
    const descEl = block.querySelector('[data-loc-field="description"]');
    wireEditableField(descEl, descEl.nextElementSibling, async (val, restoreValue)=>{
      const result = await patchWithConflict({
        url: `/locations/${loc.id}`, field:'description', fieldLabel:'Описание локации',
        val, expectedRev: loc.rev,
        extractTheirValue: current=> (current.locations.find(l=>l.id===loc.id)||{}).description,
        extractRev: current=> (current.locations.find(l=>l.id===loc.id)||{}).rev
      });
      loc.description = val;
      loc.rev = (result.locations.find(l=>l.id===loc.id)||{}).rev;
      toast('Сохранено', async ()=>{
        loc.description = restoreValue;
        const r = await api(`/locations/${loc.id}`, { method:'PATCH', body:{ description: restoreValue, expectedRev: loc.rev } });
        loc.rev = (r.locations.find(l=>l.id===loc.id)||{}).rev;
        if(state.currentId===item.id) renderDetail();
      });
    });
    bindProseToolbars(block);
    block.querySelector('.del').addEventListener('click', async ()=>{
      const ok = await confirmDialog({ title:'Удалить локацию?', message:`«${loc.name}» будет удалена без возможности восстановить.`, confirmLabel:'Удалить', danger:true });
      if(!ok) return;
      try{
        await api(`/locations/${loc.id}`, { method:'DELETE' });
        item.locations = item.locations.filter(l=>l.id!==loc.id);
        renderDetail();
      }catch(e){ toast('Ошибка: '+e.message); }
    });
    const dragHandle = block.querySelector('.loc-drag');
    if(dragHandle){
      startPointerDrag(dragHandle, {
        onStart: ()=>{ block.classList.add('drag-src'); return null; },
        onMove: (x, y)=>{
          const after = getLocationBlockAfter(wrap, y);
          if(after==null) wrap.appendChild(block);
          else if(after!==block) wrap.insertBefore(block, after);
        },
        onEnd: async ()=>{
          block.classList.remove('drag-src');
          const order = [...wrap.querySelectorAll('.location-block')].map(b=>b.dataset.locId);
          item.locations.sort((a,b)=> order.indexOf(a.id) - order.indexOf(b.id));
          try{ await api(`/allods/${item.id}/locations/reorder`, { method:'POST', body:{ order } }); toast('Порядок сохранён'); }
          catch(e){ toast('Ошибка сохранения порядка: '+e.message); }
        }
      });
    }
    wrap.appendChild(block);
    renderGallery(loc.gallery, 'gal-'+loc.id, 'location', loc.id,
      async (galId)=>{ await api(`/gallery/${galId}`, {method:'DELETE'}); loc.gallery = loc.gallery.filter(g=>g.id!==galId); renderLocations(item); },
      async (result)=>{ loc.gallery.push(result); renderLocations(item); }
    );
  });
}

function getLocationBlockAfter(wrap, y){
  const blocks = [...wrap.querySelectorAll('.location-block:not(.drag-src)')];
  let closest = null, closestOffset = -Infinity;
  blocks.forEach(el=>{
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height/2;
    if(offset < 0 && offset > closestOffset){ closestOffset = offset; closest = el; }
  });
  return closest;
}

/* ====================== GALLERY ====================== */
/* gallery item shape: { id, url } */
function renderGallery(list, wrapId, ownerType, ownerId, onRemove, onAdd){
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML='';
  list.forEach((g, idx)=>{
    const el = document.createElement('div');
    el.className='gallery-item';
    const captionHtml = state.editorOn
      ? `<div class="cap" contenteditable="true" data-empty="Подпись…">${escapeHtml(g.caption||'')}</div>`
      : (g.caption ? `<div class="cap">${escapeHtml(g.caption)}</div>` : '');
    el.innerHTML = `<img src="${escapeHtml(g.url)}" loading="lazy"><button class="rm">✕</button>${captionHtml}`;
    el.querySelector('img').addEventListener('error', function(){ this.parentElement.style.background = 'var(--void-2)'; });
    el.querySelector('img').addEventListener('click', ()=> openLightbox(list, idx));
    el.querySelector('.rm').addEventListener('click', (ev)=>{ ev.stopPropagation(); onRemove(g.id); });
    const capEl = el.querySelector('.cap');
    if(capEl && state.editorOn){
      capEl.addEventListener('blur', async ()=>{
        const val = capEl.textContent.trim();
        g.caption = val;
        try{ await api(`/gallery/${g.id}`, { method:'PATCH', body:{ caption: val } }); }
        catch(e){ toast('Ошибка сохранения подписи: '+e.message); }
      });
      capEl.addEventListener('click', ev=> ev.stopPropagation());
    }
    wrap.appendChild(el);
  });
  if(state.editorOn){
    const add = document.createElement('button');
    add.className='gallery-add';
    add.textContent='+';
    add.title='Добавить изображение (файл или ссылка)';
    add.addEventListener('click', ()=> openGalleryAddMenu(ownerType, ownerId, onAdd));
    wrap.appendChild(add);
  }
}

async function openGalleryAddMenu(ownerType, ownerId, onAdd){
  const useFile = await confirmDialog({
    title:'Добавить изображение', message:'Загрузить файл с компьютера или вставить ссылку?',
    confirmLabel:'Файл с компьютера', cancelLabel:'Вставить ссылку'
  });
  if(useFile){
    const input = document.createElement('input');
    input.type='file'; input.accept='image/*';
    input.onchange = async ()=>{
      const file = input.files[0];
      if(!file) return;
      const fd = new FormData();
      fd.append('image', file);
      fd.append('ownerType', ownerType);
      fd.append('ownerId', ownerId);
      try{
        const result = await api('/gallery/upload', { method:'POST', body: fd });
        onAdd(result);
      }catch(e){ toast('Ошибка загрузки: '+e.message); }
    };
    input.click();
  }else{
    const url = await textPrompt({ title:'Ссылка на изображение', placeholder:'https://…', required:true });
    if(!url) return;
    api('/gallery', { method:'POST', body:{ ownerType, ownerId, url: url.trim() } })
      .then(result=> onAdd(result))
      .catch(e=> toast('Ошибка: '+e.message));
  }
}

/* ====================== EDITABLE ISLAND FIELDS ====================== */
// Явные Save/Cancel вместо неявного автосохранения по blur: пока не нажата
// кнопка, изменения остаются только в DOM и никуда не отправляются — это
// защищает от случайной потери фокуса (клик мимо, переключение окна) и от
// сохранения пустоты, если что-то в браузере обнулит поле на фокусе.
// Общий "движок" переиспользуется и для полей острова, и для полей локации.
function wireEditableField(el, actions, saveFn, opts={}){
  let prevValue = el.textContent.trim();
  const showActions = ()=>{ if(actions) actions.classList.add('show'); el.classList.add('field-editing'); };
  const hideActions = ()=>{ if(actions) actions.classList.remove('show'); el.classList.remove('field-editing'); };

  el.addEventListener('focus', ()=>{ el.classList.remove('empty'); prevValue = el.textContent.trim(); });
  el.addEventListener('input', ()=>{
    if(el.textContent.trim() === prevValue) hideActions(); else showActions();
  });
  el.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ e.preventDefault(); el.textContent = prevValue; hideActions(); el.blur(); }
  });
  if(!actions) return;

  actions.querySelector('.field-cancel').addEventListener('click', ()=>{
    el.textContent = prevValue;
    if(!prevValue) el.classList.add('empty');
    hideActions();
  });
  actions.querySelector('.field-save').addEventListener('click', async ()=>{
    const val = el.textContent.trim();
    if(opts.required && !val){
      el.textContent = prevValue;
      toast(opts.requiredMsg || 'Поле не может быть пустым — отменено.');
      hideActions();
      return;
    }
    if(val === prevValue){ hideActions(); return; }
    const restoreValue = prevValue;
    try{
      await saveFn(val, restoreValue);
      prevValue = val;
      hideActions();
      if(!val) el.classList.add('empty');
    }
    catch(e){
      // saveFn сам разрулил конфликт версий (см. resolveConflict в
      // detailView.js) и просит только обновить текст в поле — либо на
      // их версию (пользователь выбрал "отменить мою правку"), либо
      // просто сброситься без второго тоста об ошибке (retry уже удался
      // и обработан внутри saveFn как обычный success-путь).
      if(e && e.__handled){
        if('newValue' in e){ el.textContent = e.newValue; prevValue = e.newValue; if(!e.newValue) el.classList.add('empty'); }
        hideActions();
        return;
      }
      toast('Ошибка сохранения: '+e.message);
    }
  });
}

/* ---------------- автокомплит @ в описании/истории ----------------
   При вводе "@" и последующих букв — выпадающий список совпадений по
   названиям островов (переиспользует .picker-item/.modal-list вёрстку
   из picker.js, но без модального оверлея — плавающий блок под полем). */
function bindAtAutocomplete(field){
  if(field._atWired) return;
  field._atWired = true;
  const dropdown = document.createElement('div');
  dropdown.className = 'modal-list at-autocomplete';
  dropdown.style.display = 'none';
  field.insertAdjacentElement('afterend', dropdown);
  let activeIndex = -1;

  function textBeforeCaret(){
    const sel = window.getSelection();
    if(!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if(!field.contains(range.startContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(field);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString();
  }

  function currentAtQuery(){
    const before = textBeforeCaret();
    if(before===null) return null;
    const m = before.match(/@([^\s@]*)$/); // от последнего "@" (без пробелов внутри) до каретки
    return m ? m[1] : null;
  }

  function closeDropdown(){ dropdown.style.display='none'; activeIndex=-1; }

  function renderDropdown(query){
    const matches = state.data
      .filter(d=> d.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8);
    if(!matches.length){ closeDropdown(); return; }
    dropdown.innerHTML = matches.map((d,i)=>
      `<div class="picker-item${i===0?' active':''}" data-name="${escapeHtml(d.name)}">${escapeHtml(d.name)}</div>`
    ).join('');
    activeIndex = 0;
    dropdown.style.display = 'block';
  }

  function applySelection(name){
    const before = textBeforeCaret();
    if(before===null) return;
    const atIdx = before.lastIndexOf('@');
    if(atIdx===-1) return;
    const insertText = name.includes(' ') ? `@"${name}" ` : `@${name} `;
    // заменяем "@частично-набранное" на полное имя целиком через выделение диапазона
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    let offset = 0, startNode=null, startOffset=0;
    while(walker.nextNode()){
      const len = walker.currentNode.textContent.length;
      if(offset + len >= atIdx){ startNode = walker.currentNode; startOffset = atIdx - offset; break; }
      offset += len;
    }
    if(!startNode) return;
    const delRange = document.createRange();
    delRange.setStart(startNode, startOffset);
    delRange.setEnd(range.startContainer, range.startOffset);
    delRange.deleteContents();
    const node = document.createTextNode(insertText);
    delRange.insertNode(node);
    const newRange = document.createRange();
    newRange.setStart(node, insertText.length);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    closeDropdown();
    field.dispatchEvent(new Event('input', { bubbles:true }));
  }

  field.addEventListener('input', ()=>{
    const q = currentAtQuery();
    if(q===null) closeDropdown(); else renderDropdown(q);
  });
  field.addEventListener('blur', ()=> setTimeout(closeDropdown, 150)); // задержка — чтобы mousedown по варианту успел сработать раньше blur
  field.addEventListener('keydown', e=>{
    if(dropdown.style.display==='none') return;
    const items = [...dropdown.children];
    if(e.key==='ArrowDown'){ e.preventDefault(); activeIndex=(activeIndex+1)%items.length; items.forEach((it,i)=>it.classList.toggle('active',i===activeIndex)); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); activeIndex=(activeIndex-1+items.length)%items.length; items.forEach((it,i)=>it.classList.toggle('active',i===activeIndex)); }
    else if(e.key==='Enter' || e.key==='Tab'){ if(items[activeIndex]){ e.preventDefault(); applySelection(items[activeIndex].dataset.name); } }
    else if(e.key==='Escape'){ closeDropdown(); }
  });
  dropdown.addEventListener('mousedown', e=>{
    const item = e.target.closest('.picker-item');
    if(!item) return;
    e.preventDefault();
    applySelection(item.dataset.name);
  });
}

function bindProseToolbars(root){
  root.querySelectorAll('.prose-toolbar').forEach(bar=>{
    if(bar._wired) return; // защита от повторного навешивания при перевызове с тем же root
    bar._wired = true;
    const forAttr = bar.dataset.for;
    const field = root.querySelector(`[data-field="${forAttr}"]`) || root.querySelector(`[data-loc-field="description"]`);
    if(!field) return;
    bindAtAutocomplete(field);
    bar.querySelectorAll('button[data-md]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        field.focus();
        const marker = btn.dataset.md;
        const sel = window.getSelection();
        const hasSelectionInField = sel.rangeCount && field.contains(sel.getRangeAt(0).commonAncestorContainer);
        const range = hasSelectionInField ? sel.getRangeAt(0) : document.createRange();
        if(!hasSelectionInField){ range.selectNodeContents(field); range.collapse(false); }
        const selectedText = range.toString();
        range.deleteContents();
        let insertText, caretOffsetFromEnd;
        if(marker==='@'){
          insertText = selectedText ? `@"${selectedText}"` : '@';
          caretOffsetFromEnd = selectedText ? 0 : 0;
        }else{
          insertText = selectedText ? `${marker}${selectedText}${marker}` : `${marker}${marker}`;
          caretOffsetFromEnd = selectedText ? 0 : marker.length;
        }
        const node = document.createTextNode(insertText);
        range.insertNode(node);
        const newRange = document.createRange();
        newRange.setStart(node, insertText.length - caretOffsetFromEnd);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        field.dispatchEvent(new Event('input', { bubbles:true })); // чтобы сработала логика показа панели Сохранить/Отмена
      });
    });
  });
}

/* ---------------- сохранение поля с обработкой конфликта версий ----------------
   Общая обвязка над api() PATCH: передаёт expectedRev, и если сервер
   ответил 409 (кто-то другой уже сохранил это же поле, пока мы его
   редактировали) — показывает resolveConflict() с их и нашей версией
   рядом. "Отменить мою правку" — бросает специальную ошибку с
   __handled:true и their-значением, которую wireEditableField понимает
   как "просто обнови текст в поле, второй тост об ошибке не нужен".
   "Сохранить мою версию поверх" — повторяет PATCH уже с их актуальным
   rev, то есть отдаёт приоритет тому, кто нажал "сохранить" последним. */
async function patchWithConflict({ url, field, fieldLabel, val, expectedRev, extractTheirValue, extractRev }){
  try{
    return await api(url, { method:'PATCH', body:{ [field]: val, expectedRev } });
  }catch(e){
    if(e.status===409 && e.body && e.body.current){
      const theirValue = extractTheirValue(e.body.current);
      const choice = await resolveConflict({ fieldLabel, myValue: val, theirValue });
      if(choice==='discard'){
        const err = new Error('discarded'); err.__handled = true; err.newValue = theirValue;
        throw err;
      }
      return await api(url, { method:'PATCH', body:{ [field]: val, expectedRev: extractRev(e.body.current) } });
    }
    throw e;
  }
}

const ALLOD_FIELD_LABELS = { name:'Название', description:'Описание', history:'История' };

function bindEditableFields(item){
  detailView.querySelectorAll('[contenteditable="true"][data-field]').forEach(el=>{
    const field = el.dataset.field;
    const actions = el.nextElementSibling && el.nextElementSibling.classList.contains('field-actions')
      ? el.nextElementSibling : null;
    wireEditableField(el, actions, async (val, restoreValue)=>{
      const result = await patchWithConflict({
        url: `/allods/${item.id}`, field, fieldLabel: ALLOD_FIELD_LABELS[field] || field,
        val, expectedRev: item.rev,
        extractTheirValue: current=> current[field],
        extractRev: current=> current.rev
      });
      item[field] = val;
      item.rev = result.rev;
      toast('Сохранено', async ()=>{
        item[field] = restoreValue;
        await api(`/allods/${item.id}`, { method:'PATCH', body:{ [field]: restoreValue, expectedRev: item.rev } })
          .then(r=>{ item.rev = r.rev; });
        if(state.currentId===item.id && !state.currentLocId) renderDetail();
      });
    }, field==='name' ? { required:true, requiredMsg:'Название острова не может быть пустым — отменено.' } : {});
  });
}

/* ====================== LOCATION MINI-MAP ====================== */
// Карта локаций острова: изображение (загруженное или по ссылке) с метками,
// по одной на каждую локацию, у которой заданы координаты mapX/mapY (0–100, % от картинки).
// В режиме редактора метки можно перетаскивать, а неразмещённые локации — перетащить на карту.
function renderLocationMiniMap(item){
  const section = document.getElementById('locMapSection');
  if(!item.locations.length){ section.innerHTML=''; return; }

  if(!item.location_map_url){
    if(!state.editorOn){ section.innerHTML=''; return; }
    section.innerHTML = `
      <div class="section-label">Карта локаций</div>
      <button class="add-location" id="addLocMapBtn">+ Добавить карту локации</button>
    `;
    document.getElementById('addLocMapBtn').addEventListener('click', ()=> openLocMapAddMenu(item));
    return;
  }

  const unplaced = item.locations.filter(l=> l.mapX==null || l.mapY==null);
  section.innerHTML = `
    <div class="section-label">Карта локаций</div>
    <div class="locmap-wrap" id="locmapWrap">
      <img class="locmap-img" src="${escapeHtml(item.location_map_url)}" id="locmapImg" alt="">
    </div>
    ${state.editorOn ? `
      <div class="locmap-toolbar">
        <span class="locmap-hint">${unplaced.length ? 'Перетащите локацию на карту, чтобы поставить метку.' : 'Все локации размещены.'}</span>
        <button class="locmap-remove" id="removeLocMapBtn">Убрать карту</button>
      </div>
      <div class="locmap-tray" id="locmapTray"></div>
    ` : ''}
  `;

  const wrap = document.getElementById('locmapWrap');
  item.locations.forEach(loc=>{
    if(loc.mapX==null || loc.mapY==null) return;
    const m = document.createElement('div');
    m.className = 'locmap-marker' + (state.editorOn ? ' editable' : '');
    m.style.left = loc.mapX + '%';
    m.style.top = loc.mapY + '%';
    m.innerHTML = `<div class="dot"></div><div class="lbl">${escapeHtml(loc.name)}</div>`;
    m.addEventListener('click', ()=>{
      if(m.classList.contains('was-dragged')){ m.classList.remove('was-dragged'); return; }
      const target = document.getElementById('loc-block-' + loc.id);
      if(target) target.scrollIntoView({ behavior:'smooth', block:'center' });
    });
    if(state.editorOn) makeLocMapMarkerDraggable(m, loc, wrap);
    wrap.appendChild(m);
  });

  if(state.editorOn){
    const tray = document.getElementById('locmapTray');
    unplaced.forEach(loc=>{
      const chip = document.createElement('div');
      chip.className='locmap-chip';
      chip.textContent = loc.name;
      startPointerDrag(chip, {
        onStart: ()=> makeDragGhost(escapeHtml(loc.name)),
        onEnd: async (x, y, ev, moved)=>{
          if(!moved) return; // просто клик по чипу без перетаскивания — не размещаем
          const rect = wrap.getBoundingClientRect();
          if(x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
          const mapX = Math.round(((x-rect.left)/rect.width)*1000)/10;
          const mapY = Math.round(((y-rect.top)/rect.height)*1000)/10;
          loc.mapX = mapX; loc.mapY = mapY;
          renderLocationMiniMap(item);
          try{ await api(`/locations/${loc.id}`, { method:'PATCH', body:{ mapX, mapY } }); toast('Сохранено'); }
          catch(e){ toast('Ошибка: '+e.message); }
        }
      });
      tray.appendChild(chip);
    });

    document.getElementById('removeLocMapBtn').addEventListener('click', async ()=>{
      const ok = await confirmDialog({
        title:'Убрать карту локаций?',
        message:'Расставленные метки при этом сохранятся и вернутся, если добавить карту заново.',
        confirmLabel:'Убрать'
      });
      if(!ok) return;
      item.location_map_url = null;
      try{ await api(`/allods/${item.id}`, { method:'PATCH', body:{ location_map_url: null } }); }
      catch(e){ toast('Ошибка: '+e.message); }
      renderLocationMiniMap(item);
    });
  }
}

async function openLocMapAddMenu(item){
  const useFile = await confirmDialog({
    title:'Добавить карту локаций', message:'Загрузить файл с компьютера или вставить ссылку?',
    confirmLabel:'Файл с компьютера', cancelLabel:'Вставить ссылку'
  });
  if(useFile){
    const input = document.createElement('input');
    input.type='file'; input.accept='image/*';
    input.onchange = async ()=>{
      const file = input.files[0];
      if(!file) return;
      const fd = new FormData();
      fd.append('image', file);
      try{
        const result = await api(`/allods/${item.id}/location-map`, { method:'POST', body: fd });
        item.location_map_url = result.location_map_url;
        renderLocationMiniMap(item);
      }catch(e){ toast('Ошибка загрузки: '+e.message); }
    };
    input.click();
  }else{
    const url = await textPrompt({ title:'Ссылка на карту локаций', placeholder:'https://…', required:true });
    if(!url) return;
    item.location_map_url = url.trim();
    api(`/allods/${item.id}`, { method:'PATCH', body:{ location_map_url: url.trim() } })
      .then(()=> renderLocationMiniMap(item))
      .catch(e=> toast('Ошибка: '+e.message));
  }
}

function makeLocMapMarkerDraggable(el, loc, wrap){
  let origLeftPct, origTopPct, moved=false, startX=0, startY=0;
  startPointerDrag(el, {
    onStart: (ev)=>{
      moved=false;
      startX = ev.clientX; startY = ev.clientY;
      origLeftPct = parseFloat(el.style.left);
      origTopPct = parseFloat(el.style.top);
      el.classList.add('dragging');
      return null;
    },
    onMove: (x, y)=>{
      const rect = wrap.getBoundingClientRect();
      const dxPct = ((x-startX)/rect.width)*100;
      const dyPct = ((y-startY)/rect.height)*100;
      if(Math.abs(dxPct)>0.3||Math.abs(dyPct)>0.3) moved=true;
      el.style.left = Math.min(100, Math.max(0, origLeftPct+dxPct)) + '%';
      el.style.top = Math.min(100, Math.max(0, origTopPct+dyPct)) + '%';
    },
    onEnd: async ()=>{
      el.classList.remove('dragging');
      if(moved){
        loc.mapX = Math.round(parseFloat(el.style.left)*10)/10;
        loc.mapY = Math.round(parseFloat(el.style.top)*10)/10;
        el.classList.add('was-dragged');
        try{ await api(`/locations/${loc.id}`, { method:'PATCH', body:{ mapX:loc.mapX, mapY:loc.mapY } }); toast('Сохранено'); }
        catch(e){ toast('Ошибка: '+e.message); }
      }
    }
  });
}

/* ====================== DELEGATED CLICKS (CSP: без inline onclick) ======================
   detailView — тот же DOM-узел на протяжении всей жизни страницы (его innerHTML
   перестраивается в renderDetail(), но сам узел не пересоздаётся), поэтому вешаем
   один делегированный обработчик один раз при загрузке скрипта, а не на каждый рендер. */
detailView.addEventListener('click', (ev)=>{
  const tagLink = ev.target.closest('[data-goto-allod]');
  if(tagLink){ ev.preventDefault(); openDetail(tagLink.dataset.gotoAllod); return; }
  const el = ev.target.closest('[data-action]');
  if(!el) return;
  const action = el.dataset.action;
  if(action==='show-map'){ showMap(); }
  else if(action==='filter-tag'){ filterByTag(el.dataset.field, el.dataset.value); }
  else if(action==='edit-tag'){ editTagField(el.dataset.field); }
  else if(action==='edit-plain'){ editPlainField(el.dataset.field, el.dataset.label); }
  else if(action==='open-detail'){ openDetail(el.dataset.id); }
  else if(action==='jump-to-diff'){
    document.getElementById('historySection').scrollIntoView({ behavior:'smooth', block:'start' });
    renderAllodHistory(document.getElementById('historySection'), state.currentId, el.dataset.snapshotId);
  }
  else if(action==='report-issue'){ reportIssueFlow(state.currentId); }
});

/* ---------------- история правок (снимки) ---------------- */
// Список снимков с датой/автором и кнопкой "что изменилось?" — разворачивает
// построчный diff (было → стало), тот же формат, что и в общей ленте
// последних изменений (rcToggleDiff/rcRenderDiff, см. recentChangesView.js —
// переиспользуем, чтобы не дублировать логику). Видна только вошедшим (тот
// же уровень доступа, что и у бэкенда — GET .../history требует requireAuth).

async function renderAllodHistory(wrap, allodId, jumpToSnapshotId){
  if(!authStatus.loggedIn){ wrap.innerHTML=''; return; }
  wrap.innerHTML = `<div class="section-label">История правок</div><div id="historyList">Загрузка…</div>`;
  let snapshots;
  try{ snapshots = await api(`/allods/${allodId}/history`); }
  catch(e){ document.getElementById('historyList').innerHTML=''; return; }

  const listEl = document.getElementById('historyList');
  if(!snapshots.length){
    listEl.innerHTML = `<div class="prose empty" data-empty="Правок этого острова ещё не было записано в историю."></div>`;
    return;
  }
  listEl.innerHTML = snapshots.map(s=>{
    const date = new Date(s.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    return `
      <div class="history-item" data-snapshot-id="${escapeHtml(s.id)}">
        <div class="history-row">
          <span class="history-date">${date}</span>
          <span class="history-author">${s.changed_by ? escapeHtml(s.changed_by) : 'неизвестно кто'}</span>
          <button class="rc-diff-toggle" data-action="view-snapshot">Что изменилось?</button>
        </div>
        <div class="rc-diff-body" style="display:none"></div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('[data-action="view-snapshot"]').forEach(btn=>{
    btn.addEventListener('click', ()=> rcToggleDiff(btn.closest('.history-item').dataset.snapshotId, btn.closest('.history-item')));
  });

  // Пришли по клику с бейджа "Обновлено N назад — что изменилось?" —
  // сразу разворачиваем именно эту правку и прокручиваем к ней, а не
  // заставляем искать её глазами в списке.
  if(jumpToSnapshotId){
    const targetItem = listEl.querySelector(`[data-snapshot-id="${CSS.escape(jumpToSnapshotId)}"]`);
    if(targetItem){
      targetItem.scrollIntoView({ behavior:'smooth', block:'center' });
      targetItem.querySelector('[data-action="view-snapshot"]').click();
    }
  }
}

/* ---------------- сообщить об ошибке (гостевая форма) ---------------- */
// Единственное место на сайте, где может писать вообще кто угодно без
// аккаунта — форма/эндпоинт спроектированы соответственно: только текст
// сообщения + необязательный контакт, ничего, что могло бы что-то менять
// на сайте напрямую (это просто письмо в очередь на бэкенде, которое потом
// разбирает администратор в «⚙ Настройки»).
let reportOverlay, reportResolve;
function ensureReportDom(){
  if(reportOverlay) return;
  reportOverlay = document.createElement('div');
  reportOverlay.className = 'modal-overlay';
  reportOverlay.innerHTML = `
    <div class="modal-box" style="width:420px;">
      <div class="modal-title">Сообщить об ошибке</div>
      <div class="modal-message">Что не так с этим островом — опечатка, неверный факт, сломанная картинка? Опишите своими словами, администратор разберётся.</div>
      <textarea class="ef-input rp-message" placeholder="Что заметили…" rows="4" style="margin-top:10px;resize:vertical;"></textarea>
      <input class="ef-input rp-contact" type="text" placeholder="Как с вами связаться (необязательно) — email, ник и т.п." style="margin-top:8px;">
      <div class="modal-actions">
        <button class="field-cancel">Отмена</button>
        <button class="field-save">Отправить</button>
      </div>
    </div>
  `;
  document.body.appendChild(reportOverlay);
  const msgEl = reportOverlay.querySelector('.rp-message');
  const contactEl = reportOverlay.querySelector('.rp-contact');
  const saveBtn = reportOverlay.querySelector('.field-save');
  const cancelBtn = reportOverlay.querySelector('.field-cancel');
  const close = (result)=>{ reportOverlay.classList.remove('show'); if(reportResolve){ const r=reportResolve; reportResolve=null; r(result); } };
  cancelBtn.addEventListener('click', ()=> close(null));
  saveBtn.addEventListener('click', ()=>{
    if(!msgEl.value.trim()) return;
    close({ message: msgEl.value.trim(), contact: contactEl.value.trim() });
  });
  reportOverlay.addEventListener('mousedown', e=>{ if(e.target===reportOverlay) close(null); });
  reportOverlay.addEventListener('keydown', e=>{ if(e.key==='Escape'){ e.preventDefault(); close(null); } });
  reportOverlay._els = { msgEl, contactEl };
}
async function reportIssueFlow(allodId){
  ensureReportDom();
  const { msgEl, contactEl } = reportOverlay._els;
  msgEl.value = ''; contactEl.value = '';
  reportOverlay.classList.add('show');
  setTimeout(()=> msgEl.focus(), 0);
  const result = await new Promise(resolve=>{ reportResolve = resolve; });
  if(!result) return;
  try{
    await api('/reports', { method:'POST', body:{ allodId, message: result.message, contact: result.contact || undefined } });
    toast('Спасибо, обращение отправлено — администратор его увидит.');
  }catch(e){
    toast(e.status===429 ? 'Слишком много обращений подряд — попробуйте чуть позже.' : 'Ошибка: '+e.message);
  }
}
