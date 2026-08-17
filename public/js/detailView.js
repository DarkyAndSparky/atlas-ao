/* ====================== VIEW ENTRY ====================== */
function openDetail(id, locId=null){
  if(state.view==='map' || state.view==='wiki') state.returnView = state.view;
  state.view = locId? 'location':'detail';
  state.currentId = id;
  state.currentLocId = locId;
  mapView.style.display='none';
  document.getElementById('zoomCtrl').style.display='none';
  document.getElementById('wikiView').classList.remove('show');
  document.getElementById('configView').classList.remove('show');
  document.getElementById('aboutView').classList.remove('show');
  detailView.classList.add('show');
  renderDetail();
  renderTray();
  detailView.scrollTop=0;
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
      <button class="del-allod editor-hidden" id="delAllodBtn" title="Удалить остров">✕ Удалить остров</button>
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
            <div class="prose ${item.description?'':'empty'}" data-empty="Описание ещё не добавлено — включите редактор, чтобы написать его."
                 contenteditable="${state.editorOn}" data-field="description">${escapeHtml(item.description)}</div>
          </div>
          <div class="section">
            <div class="section-label">История</div>
            <div class="prose ${item.history?'':'empty'}" data-empty="История аллода ещё не записана."
                 contenteditable="${state.editorOn}" data-field="history">${escapeHtml(item.history)}</div>
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
        </div>
        <div>
          <div class="section-label">Сведения</div>
          ${sidebarFact('Владелец', item.holder, 'holder')}
          ${sidebarFact('Архипелаг', item.archipelago)}
          ${sidebarFact('Тип', item.type, 'type')}
          ${sidebarFact('Дополнение', item.expansion, 'expansion')}
          ${sidebarFact('Карта локации', item.hasMap ? 'есть' : null)}
          ${sidebarFact('Сюжет', item.plot, 'plot')}
          ${sidebarFact('Проект', item.project)}
          <div class="icon-control" id="iconControl"></div>
          <div class="icon-control" id="projectControl"></div>
        </div>
      </div>
    </div>
  `;
  bindEditableFields(item);
  renderGallery(item.gallery, 'galleryWrap', 'allod', item.id,
    async (galId)=>{ await api(`/gallery/${galId}`, {method:'DELETE'}); item.gallery = item.gallery.filter(g=>g.id!==galId); renderDetail(); },
    async (result)=>{ item.gallery.push(result); renderDetail(); }
  );
  renderLocationMiniMap(item);
  renderLocations(item);
  renderRelated(item);
  renderIconControl(item);
  renderProjectControl(item);
  if(state.editorOn) document.getElementById('addLocBtn').classList.remove('editor-hidden');
  document.getElementById('addLocBtn').onclick = async ()=>{
    const name = prompt('Название локации:');
    if(!name) return;
    try{
      const updated = await api(`/allods/${item.id}/locations`, { method:'POST', body:{ name } });
      Object.assign(item, updated);
      renderDetail();
    }catch(e){ toast('Ошибка: '+e.message); }
  };
  if(state.editorOn) document.getElementById('delAllodBtn').classList.remove('editor-hidden');
  document.getElementById('delAllodBtn').onclick = async ()=>{
    if(!confirm('Удалить остров "'+item.name+'" целиком, вместе со всеми локациями и галереей? Это необратимо.')) return;
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
  const answer = prompt(`${label}:`, item[field] || '');
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
      const name = prompt('Название нового проекта:');
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

function openIconSetMenu(item){
  const choice = confirm('Загрузить файл иконки с компьютера? (OK — файл, Отмена — вставить ссылку)');
  if(choice){
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
    const url = prompt('Ссылка на иконку (URL):');
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
  let value;
  if(existing.length){
    const list = existing.map((v,i)=>`${i+1}. ${v}`).join('\n');
    const label = TAG_FIELD_LABELS[field] || field;
    const answer = prompt(
      `Выберите номер уже существующего значения для поля «${label}», либо впишите новое (пусто — очистить поле):\n\n${list}`,
      item[field] || ''
    );
    if(answer===null) return; // отмена
    const trimmed = answer.trim();
    const asIndex = /^\d+$/.test(trimmed) ? parseInt(trimmed,10) : null;
    value = (asIndex && asIndex>=1 && asIndex<=existing.length) ? existing[asIndex-1] : trimmed;
  }else{
    const answer = prompt(`Введите значение для поля «${TAG_FIELD_LABELS[field]||field}»:`, item[field] || '');
    if(answer===null) return;
    value = answer.trim();
  }
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
        <button class="del">✕</button>
      </div>
      <div class="prose loc-desc ${loc.description?'':'empty'}" data-empty="Описание локации ещё не добавлено."
           contenteditable="${state.editorOn}" data-loc-field="description">${escapeHtml(loc.description)}</div>
      <div class="gallery loc-gallery" id="gal-${loc.id}"></div>
    `;
    const nameEl = block.querySelector('[data-loc-field="name"]');
    let prevLocName = loc.name;
    nameEl.addEventListener('focus', ()=>{ prevLocName = nameEl.textContent.trim(); });
    nameEl.addEventListener('blur', async e=>{
      const val = e.target.textContent.trim();
      if(val === prevLocName) return;
      if(!val){
        e.target.textContent = prevLocName;
        toast('Название локации не может быть пустым — отменено.');
        return;
      }
      loc.name = val;
      const restoreValue = prevLocName;
      try{
        await api(`/locations/${loc.id}`, { method:'PATCH', body:{ name: val } });
        toast('Сохранено', async ()=>{
          loc.name = restoreValue;
          await api(`/locations/${loc.id}`, { method:'PATCH', body:{ name: restoreValue } });
          if(state.currentId===item.id) renderDetail();
        });
      }
      catch(err){ toast('Ошибка: '+err.message); }
    });
    const descEl = block.querySelector('[data-loc-field="description"]');
    let prevLocDesc = loc.description;
    descEl.addEventListener('focus', e=>{ e.target.classList.remove('empty'); prevLocDesc = descEl.textContent.trim(); });
    descEl.addEventListener('blur', async e=>{
      const val = e.target.textContent.trim();
      if(val === prevLocDesc){ if(!val) e.target.classList.add('empty'); return; }
      loc.description = val;
      const restoreValue = prevLocDesc;
      try{
        await api(`/locations/${loc.id}`, { method:'PATCH', body:{ description: val } });
        toast('Сохранено', async ()=>{
          loc.description = restoreValue;
          await api(`/locations/${loc.id}`, { method:'PATCH', body:{ description: restoreValue } });
          if(state.currentId===item.id) renderDetail();
        });
      }
      catch(err){ toast('Ошибка: '+err.message); }
      if(!val) e.target.classList.add('empty');
    });
    block.querySelector('.del').addEventListener('click', async ()=>{
      if(!confirm('Удалить локацию "'+loc.name+'"?')) return;
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

function openGalleryAddMenu(ownerType, ownerId, onAdd){
  const choice = confirm('Загрузить файл с компьютера? (OK — файл, Отмена — вставить ссылку)');
  if(choice){
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
    const url = prompt('Ссылка на изображение (URL):');
    if(!url) return;
    api('/gallery', { method:'POST', body:{ ownerType, ownerId, url: url.trim() } })
      .then(result=> onAdd(result))
      .catch(e=> toast('Ошибка: '+e.message));
  }
}

/* ====================== EDITABLE ISLAND FIELDS ====================== */
function bindEditableFields(item){
  detailView.querySelectorAll('[contenteditable="true"]').forEach(el=>{
    let prevValue = el.textContent.trim();
    el.addEventListener('focus', ()=>{ el.classList.remove('empty'); prevValue = el.textContent.trim(); });
    el.addEventListener('blur', async ()=>{
      const field = el.dataset.field;
      const val = el.textContent.trim();
      if(val === prevValue) return; // ничего не изменилось — не дёргаем сервер и не показываем undo
      if(field==='name' && !val){
        // пустое название острова ломает сортировку/группировку в вики и просто
        // выглядит как баг — не даём сохранить, откатываем текст обратно
        el.textContent = prevValue;
        toast('Название острова не может быть пустым — отменено.');
        return;
      }
      const patch = {};
      if(field==='name') patch.name = val;
      if(field==='description') patch.description = val;
      if(field==='history') patch.history = val;
      item[field] = val;
      const restoreValue = prevValue;
      try{
        await api(`/allods/${item.id}`, { method:'PATCH', body: patch });
        toast('Сохранено', async ()=>{
          item[field] = restoreValue;
          await api(`/allods/${item.id}`, { method:'PATCH', body: { [field]: restoreValue } });
          if(state.currentId===item.id && !state.currentLocId) renderDetail();
        });
      }
      catch(e){ toast('Ошибка сохранения: '+e.message); }
      if(!val){ el.classList.add('empty'); }
    });
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
        onEnd: async (x, y)=>{
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
      if(!confirm('Убрать карту локаций? Расставленные метки при этом сохранятся и вернутся, если добавить карту заново.')) return;
      item.location_map_url = null;
      try{ await api(`/allods/${item.id}`, { method:'PATCH', body:{ location_map_url: null } }); }
      catch(e){ toast('Ошибка: '+e.message); }
      renderLocationMiniMap(item);
    });
  }
}

function openLocMapAddMenu(item){
  const choice = confirm('Загрузить файл карты с компьютера? (OK — файл, Отмена — вставить ссылку)');
  if(choice){
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
    const url = prompt('Ссылка на изображение карты (URL):');
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
  const el = ev.target.closest('[data-action]');
  if(!el) return;
  const action = el.dataset.action;
  if(action==='show-map'){ showMap(); }
  else if(action==='filter-tag'){ filterByTag(el.dataset.field, el.dataset.value); }
  else if(action==='edit-tag'){ editTagField(el.dataset.field); }
  else if(action==='edit-plain'){ editPlainField(el.dataset.field, el.dataset.label); }
  else if(action==='open-detail'){ openDetail(el.dataset.id); }
});
