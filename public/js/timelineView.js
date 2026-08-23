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

async function createEventFlow({ scope, allodId }){
  const title = prompt('Название события:');
  if(!title || !title.trim()) return null;
  const yearAnswer = prompt('Год (целое число):');
  if(yearAnswer === null) return null;
  const year = parseInt(yearAnswer.trim(), 10);
  if(!Number.isInteger(year)){ toast('Год должен быть целым числом'); return null; }
  const description = prompt('Описание события (необязательно):', '') || '';
  try{
    const body = { scope, year, title: title.trim(), description: description.trim() };
    if(scope==='allod') body.allodId = allodId;
    const created = await api('/timeline', { method:'POST', body });
    toast('Событие добавлено');
    return created;
  }catch(e){ toast('Ошибка: '+e.message); return null; }
}

async function editEventFlow(ev){
  const title = prompt('Название события:', ev.title);
  if(title === null) return null;
  const yearAnswer = prompt('Год:', String(ev.year));
  if(yearAnswer === null) return null;
  const year = parseInt(yearAnswer.trim(), 10);
  if(!Number.isInteger(year)){ toast('Год должен быть целым числом'); return null; }
  const description = prompt('Описание:', ev.description || '');
  if(description === null) return null;
  try{
    const updated = await api(`/timeline/${ev.id}`, { method:'PATCH', body:{ title: title.trim(), year, description: description.trim() } });
    toast('Сохранено');
    return updated;
  }catch(e){ toast('Ошибка: '+e.message); return null; }
}

async function deleteEventFlow(id){
  if(!confirm('Удалить это событие хронологии? Это необратимо.')) return false;
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
