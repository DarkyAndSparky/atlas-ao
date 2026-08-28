/* ====================== TIMELINE (ХРОНОЛОГИЯ) ======================
   Два уровня: хронология мира (scope='world', своя для каждого project —
   см. state.project) и хронология конкретного аллода (scope='allod').
   Год — просто число (без отдельного лейбла эпохи, решили не городить,
   т.к. часть дат "размазана" внутри одного года) + sort_order для порядка
   внутри одного года, когда самого года недостаточно. */

function showTimeline(){
  state.view = 'timeline';
  state.currentId = null; state.currentLocId = null;
  mapView.style.display='none';
  document.getElementById('zoomCtrl').style.display='none';
  document.getElementById('timelineSliderBar').classList.remove('show');
  detailView.classList.remove('show');
  document.getElementById('wikiView').classList.remove('show');
  document.getElementById('configView').classList.remove('show');
  document.getElementById('aboutView').classList.remove('show');
  document.getElementById('sourcesView').classList.remove('show');
  document.getElementById('timelineView').classList.add('show');
  document.querySelectorAll('.view-toggle-btn').forEach(b=> b.classList.toggle('active', b.dataset.view==='timeline'));
  trayEl.classList.remove('show');
  updateDrawToolbarVisibility();
  renderTimelinePage();
  syncUrl();
}

async function renderTimelinePage(){
  const wrap = document.getElementById('timelineView');
  const projectLabel = currentProjectLabel();
  wrap.innerHTML = `
    <div class="sources-hero">
      <h1>Хронология мира</h1>
      <p>Общемировые события проекта «${escapeHtml(projectLabel)}» — по годам. У каждого аллода есть и своя, отдельная хронология (на его странице).</p>
      ${state.editorOn ? `<button class="add-source-btn" id="addWorldEventBtn">+ Добавить событие</button>` : ''}
    </div>
    <div class="sources-body" id="timelineList">Загрузка…</div>
  `;
  if(state.editorOn){
    document.getElementById('addWorldEventBtn').addEventListener('click', async ()=>{
      const created = await createEventFlow({ scope:'world' });
      if(created) renderTimelinePage();
    });
  }
  let events;
  try{ events = await api(`/timeline/world?project=${encodeURIComponent(state.project)}`); }
  catch(e){ document.getElementById('timelineList').innerHTML = `<div class="prose empty" data-empty="Не удалось загрузить хронологию."></div>`; return; }

  const list = document.getElementById('timelineList');
  if(!events.length){
    list.innerHTML = `<div class="prose empty" data-empty="Событий пока нет."></div>`;
    return;
  }
  list.innerHTML = `<div class="timeline-track">${events.map(ev=>timelineEventHtml(ev)).join('')}</div>`;
}

function timelineEventHtml(ev){
  return `
    <div class="timeline-event" data-event-id="${escapeHtml(ev.id)}">
      <div class="timeline-year">${escapeHtml(String(ev.year))}</div>
      <div class="timeline-event-body">
        <div class="timeline-event-title">${escapeHtml(ev.title)}</div>
        ${ev.description ? `<div class="timeline-event-desc">${escapeHtml(ev.description)}</div>` : ''}
        ${state.editorOn ? `
          <div class="source-card-actions">
            <button data-action="edit-event">Изменить</button>
            <button data-action="delete-event">Удалить</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

/* ---------------- форма события: title/year/description с live-валидацией ----------------
   Раньше три подряд prompt() без общей валидации — если год ввели не числом,
   пользователь узнавал об этом только после трёх окон и терял title/description,
   набранные до этого. Теперь одна форма, Save недоступен пока год не целое число. */
let eventFormOverlay, eventFormResolve = null;
function ensureEventFormDom(){
  if(eventFormOverlay) return;
  eventFormOverlay = document.createElement('div');
  eventFormOverlay.className = 'modal-overlay'; // переиспользуем общие стили модалок
  eventFormOverlay.innerHTML = `
    <div class="modal-box" style="width:420px;">
      <div class="modal-title">Событие хронологии</div>
      <input class="ef-input ef-title" type="text" placeholder="Название события" autocomplete="off">
      <input class="ef-input ef-year" type="text" placeholder="Год (целое число)" autocomplete="off" style="margin-top:8px;">
      <div class="ef-year-err" style="font-family:var(--ui);font-size:11px;color:var(--imperial);min-height:14px;margin-top:3px;"></div>
      <textarea class="ef-input ef-desc" placeholder="Описание (необязательно)" rows="4"
        style="resize:vertical;margin-top:4px;"></textarea>
      <div class="modal-actions">
        <button class="field-cancel">Отмена</button>
        <button class="field-save">Сохранить</button>
      </div>
    </div>
  `;
  document.body.appendChild(eventFormOverlay);
  const titleEl = eventFormOverlay.querySelector('.ef-title');
  const yearEl = eventFormOverlay.querySelector('.ef-year');
  const yearErrEl = eventFormOverlay.querySelector('.ef-year-err');
  const descEl = eventFormOverlay.querySelector('.ef-desc');
  const saveBtn = eventFormOverlay.querySelector('.field-save');
  const cancelBtn = eventFormOverlay.querySelector('.field-cancel');

  const validate = ()=>{
    const yearOk = /^-?\d+$/.test(yearEl.value.trim());
    yearErrEl.textContent = (yearEl.value.trim() && !yearOk) ? 'Год должен быть целым числом' : '';
    const ok = titleEl.value.trim() && yearOk;
    saveBtn.disabled = !ok;
    saveBtn.style.opacity = ok ? '1' : '0.4';
    saveBtn.style.cursor = ok ? 'pointer' : 'default';
    return ok;
  };
  titleEl.addEventListener('input', validate);
  yearEl.addEventListener('input', validate);
  eventFormOverlay._validate = validate;
  eventFormOverlay._els = { titleEl, yearEl, descEl, saveBtn };

  const close = (result)=>{
    eventFormOverlay.classList.remove('show');
    if(eventFormResolve){ const r = eventFormResolve; eventFormResolve = null; r(result); }
  };
  cancelBtn.addEventListener('click', ()=> close(null));
  saveBtn.addEventListener('click', ()=>{
    if(!validate()) return;
    close({ title: titleEl.value.trim(), year: parseInt(yearEl.value.trim(),10), description: descEl.value.trim() });
  });
  eventFormOverlay.addEventListener('mousedown', e=>{ if(e.target===eventFormOverlay) close(null); });
  eventFormOverlay.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ e.preventDefault(); close(null); }
    if(e.key==='Enter' && e.target!==descEl){ e.preventDefault(); if(validate()) saveBtn.click(); }
  });
}

function eventFormFlow(initial={}){
  ensureEventFormDom();
  const { titleEl, yearEl, descEl } = eventFormOverlay._els;
  titleEl.value = initial.title || '';
  yearEl.value = initial.year!=null ? String(initial.year) : '';
  descEl.value = initial.description || '';
  eventFormOverlay._validate();
  eventFormOverlay.classList.add('show');
  setTimeout(()=> titleEl.focus(), 0);
  return new Promise(resolve=>{ eventFormResolve = resolve; });
}

async function createEventFlow({ scope, allodId }){
  const result = await eventFormFlow({});
  if(!result) return null;
  try{
    const body = { scope, year: result.year, title: result.title, description: result.description };
    if(scope==='allod') body.allodId = allodId;
    else body.project = state.project; // иначе мировое событие всегда уходит в дефолтный "Аллоды Онлайн", даже если открыт другой проект
    const created = await api('/timeline', { method:'POST', body });
    toast('Событие добавлено');
    return created;
  }catch(e){ toast('Ошибка: '+e.message); return null; }
}

async function editEventFlow(ev){
  const result = await eventFormFlow({ title: ev.title, year: ev.year, description: ev.description });
  if(!result) return null;
  try{
    const updated = await api(`/timeline/${ev.id}`, { method:'PATCH', body:{ title: result.title, year: result.year, description: result.description } });
    toast('Сохранено');
    return updated;
  }catch(e){ toast('Ошибка: '+e.message); return null; }
}

async function deleteEventFlow(id){
  const ok = await confirmDialog({ title:'Удалить событие?', message:'Это необратимо.', confirmLabel:'Удалить', danger:true });
  if(!ok) return false;
  try{
    await api(`/timeline/${id}`, { method:'DELETE' });
    toast('Событие удалено');
    return true;
  }catch(e){ toast('Ошибка: '+e.message); return false; }
}

document.getElementById('timelineView').addEventListener('click', async (ev)=>{
  const card = ev.target.closest('.timeline-event');
  if(!card) return;
  const id = card.dataset.eventId;
  if(ev.target.closest('[data-action="edit-event"]')){
    const events = await api(`/timeline/world?project=${encodeURIComponent(state.project)}`);
    const found = events.find(e=>e.id===id);
    if(found && await editEventFlow(found)) renderTimelinePage();
  }else if(ev.target.closest('[data-action="delete-event"]')){
    if(await deleteEventFlow(id)) renderTimelinePage();
  }
});

/* ---------------- блок хронологии на странице аллода ---------------- */
async function renderAllodTimeline(wrap, allodId){
  wrap.innerHTML = `<div class="section-label">Хронология</div><div id="allodTimelineList">Загрузка…</div>`;
  let events;
  try{ events = await api(`/timeline/allod/${allodId}`); }
  catch(e){ document.getElementById('allodTimelineList').innerHTML=''; return; }

  const listEl = document.getElementById('allodTimelineList');
  if(!events.length){
    listEl.innerHTML = state.editorOn ? '' : `<div class="prose empty" data-empty="Хронология этого аллода ещё не заполнена."></div>`;
  }else{
    listEl.innerHTML = `<div class="timeline-track timeline-track-compact">${events.map(ev=>timelineEventHtml(ev)).join('')}</div>`;
  }

  if(state.editorOn){
    const btn = document.createElement('button');
    btn.className = 'add-source-btn';
    btn.textContent = '+ Добавить событие';
    btn.addEventListener('click', async ()=>{
      const created = await createEventFlow({ scope:'allod', allodId });
      if(created) renderAllodTimeline(wrap, allodId);
    });
    wrap.appendChild(btn);
  }

  listEl.querySelectorAll('[data-action="edit-event"]').forEach(b=>{
    b.addEventListener('click', async (ev)=>{
      const card = ev.target.closest('.timeline-event');
      const found = events.find(e=>e.id===card.dataset.eventId);
      if(found && await editEventFlow(found)) renderAllodTimeline(wrap, allodId);
    });
  });
  listEl.querySelectorAll('[data-action="delete-event"]').forEach(b=>{
    b.addEventListener('click', async (ev)=>{
      const card = ev.target.closest('.timeline-event');
      if(await deleteEventFlow(card.dataset.eventId)) renderAllodTimeline(wrap, allodId);
    });
  });
}
