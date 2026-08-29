/* ====================== RECENT CHANGES (общий журнал изменений) ======================
   Та же таблица allod_snapshots, что и per-island "История правок" на
   странице острова (см. detailView.js renderAllodHistory) — но без фильтра
   по allod_id по умолчанию, вся лента правок по сайту сразу (фильтры по
   острову/автору — ниже, необязательные). Видно любому вошедшему (тот же
   уровень доступа, что и у бэкенда — requireAuth, не requireAdmin): это
   про координацию правок между редакторами, не служебная админ-панель. */

// Состояние фильтров и пагинации — локальное для этой страницы, не часть
// глобального state.*, потому что переживать между посещениями страницы
// смысла не имеет (в отличие от, например, state.editorOn).
let rcFilters = { allodId: null, allodName: null, author: null };
let rcOldestSeenAt = null; // курсор для "показать ещё" — created_at самой старой загруженной записи
const rcDiffCache = {}; // snapshotId -> {deleted, changes} — чтобы повторный разворот не дёргал сервер заново

function showRecentChanges(){
  state.view = 'recentChanges';
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
  document.getElementById('archipelagosView').classList.remove('show');
  document.getElementById('recentChangesView').classList.add('show');
  document.querySelectorAll('.view-toggle-btn').forEach(b=> b.classList.remove('active')); // не часть основной группы разделов
  trayEl.classList.remove('show');
  updateDrawToolbarVisibility();
  renderRecentChangesPage();
  syncUrl();
}

function rcQueryString(before){
  const parts = ['limit=50'];
  if(rcFilters.allodId) parts.push('allodId='+encodeURIComponent(rcFilters.allodId));
  if(rcFilters.author) parts.push('author='+encodeURIComponent(rcFilters.author));
  if(before) parts.push('before='+before);
  return parts.join('&');
}

async function renderRecentChangesPage(){
  const wrap = document.getElementById('recentChangesView');
  wrap.innerHTML = `
    <div class="sources-hero">
      <h1>Последние изменения</h1>
      <p>Правки по всем островам сразу, самые свежие сверху — видно любому вошедшему, не только администратору.</p>
    </div>
    <div class="rc-filters">
      <button id="rcFilterAllod" class="btn-small">${rcFilters.allodName ? `Остров: ${escapeHtml(rcFilters.allodName)} ✕` : 'Фильтр по острову…'}</button>
      <button id="rcFilterAuthor" class="btn-small">${rcFilters.author ? `Автор: ${escapeHtml(rcFilters.author)} ✕` : 'Фильтр по автору…'}</button>
    </div>
    <div class="sources-body" id="recentChangesList">Загрузка…</div>
  `;
  document.getElementById('rcFilterAllod').addEventListener('click', async ()=>{
    if(rcFilters.allodId){ rcFilters.allodId = null; rcFilters.allodName = null; renderRecentChangesPage(); return; }
    const names = [...new Set(state.data.map(d=>d.name))].sort((a,b)=>a.localeCompare(b,'ru'));
    const picked = await pickFromList({ title:'Фильтр по острову', items:names, placeholder:'Начните вводить название…' });
    if(picked===null || !picked.trim()) return;
    const item = state.data.find(d=>d.name===picked);
    if(!item) return; // выбор строго из списка (allowCreate не передан) — не должно происходить
    rcFilters.allodId = item.id; rcFilters.allodName = item.name;
    renderRecentChangesPage();
  });
  document.getElementById('rcFilterAuthor').addEventListener('click', async ()=>{
    if(rcFilters.author){ rcFilters.author = null; renderRecentChangesPage(); return; }
    let authors;
    try{ authors = await api('/recent-changes/authors'); }catch(e){ toast('Ошибка: '+e.message); return; }
    const picked = await pickFromList({ title:'Фильтр по автору', items:authors, placeholder:'Начните вводить имя…' });
    if(picked===null || !picked.trim()) return;
    if(!authors.includes(picked)) return; // строго из списка
    rcFilters.author = picked;
    renderRecentChangesPage();
  });

  const listEl = document.getElementById('recentChangesList');
  let entries;
  try{ entries = await api('/recent-changes?'+rcQueryString()); }
  catch(e){ listEl.innerHTML = `<div class="prose empty" data-empty="Не удалось загрузить журнал."></div>`; return; }

  if(!entries.length){
    listEl.innerHTML = `<div class="prose empty" data-empty="${rcFilters.allodId||rcFilters.author ? 'По этому фильтру правок не найдено.' : 'Правок пока не было.'}"></div>`;
    return;
  }
  rcOldestSeenAt = entries[entries.length-1].created_at;
  listEl.innerHTML = `<div class="history-item-list">${entries.map(rcRenderEntry).join('')}</div>
    <button id="rcLoadMoreBtn" class="btn-small" style="margin-top:12px;">Показать ещё</button>`;
  document.getElementById('rcLoadMoreBtn').addEventListener('click', rcLoadMore);
}

function rcRenderEntry(e){
  const date = new Date(e.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  return `
    <div class="history-item" data-snapshot-id="${escapeHtml(e.id)}">
      <div class="history-row">
        <span class="history-date">${date}</span>
        <a href="#" class="history-target" data-action="open-detail" data-id="${escapeHtml(e.allod_id)}">${escapeHtml(e.allod_name)}</a>
        <span class="history-author">${e.changed_by ? escapeHtml(e.changed_by) : 'неизвестно кто'}</span>
        <button class="rc-diff-toggle" data-action="toggle-diff" data-snapshot-id="${escapeHtml(e.id)}">Что изменилось?</button>
      </div>
      <div class="rc-diff-body" style="display:none;"></div>
    </div>
  `;
}

async function rcLoadMore(){
  const btn = document.getElementById('rcLoadMoreBtn');
  btn.disabled = true; btn.textContent = 'Загрузка…';
  let entries;
  try{ entries = await api('/recent-changes?'+rcQueryString(rcOldestSeenAt)); }
  catch(e){ toast('Ошибка: '+e.message); btn.disabled=false; btn.textContent='Показать ещё'; return; }
  if(!entries.length){ btn.remove(); return; }
  rcOldestSeenAt = entries[entries.length-1].created_at;
  document.querySelector('#recentChangesList .history-item-list').insertAdjacentHTML('beforeend', entries.map(rcRenderEntry).join(''));
  btn.disabled = false; btn.textContent = 'Показать ещё';
}

function rcFormatDiffValue(v){
  if(v===null || v===undefined || v==='') return '<span class="rc-diff-empty">(пусто)</span>';
  const s = escapeHtml(String(v));
  return s.length > 200 ? s.slice(0,200)+'…' : s;
}

async function rcToggleDiff(snapshotId, itemEl){
  const body = itemEl.querySelector('.rc-diff-body');
  const shown = body.style.display !== 'none';
  if(shown){ body.style.display = 'none'; return; }
  body.style.display = 'block';
  if(rcDiffCache[snapshotId]){ rcRenderDiff(body, rcDiffCache[snapshotId]); return; }
  body.innerHTML = `<div class="rc-diff-loading">Загрузка…</div>`;
  try{
    const result = await api(`/allod-snapshots/${snapshotId}/diff`);
    rcDiffCache[snapshotId] = result;
    rcRenderDiff(body, result);
  }catch(e){
    body.innerHTML = `<div class="rc-diff-loading">Не удалось загрузить: ${escapeHtml(e.message)}</div>`;
  }
}

function rcRenderDiff(body, result){
  if(result.deleted){
    body.innerHTML = `<div class="rc-diff-loading">Остров с тех пор удалён — не с чем сравнить текущее состояние.</div>`;
    return;
  }
  if(!result.changes.length){
    body.innerHTML = `<div class="rc-diff-loading">Видимых изменений полей нет (могла поменяться только позиция метки на карте).</div>`;
    return;
  }
  body.innerHTML = result.changes.map(c=> `
    <div class="rc-diff-field">
      <span class="rc-diff-label">${escapeHtml(c.label)}:</span>
      <span class="rc-diff-from">${rcFormatDiffValue(c.from)}</span>
      <span class="rc-diff-arrow">→</span>
      <span class="rc-diff-to">${rcFormatDiffValue(c.to)}</span>
    </div>
  `).join('');
}

document.getElementById('recentChangesView').addEventListener('click', (ev)=>{
  const diffBtn = ev.target.closest('[data-action="toggle-diff"]');
  if(diffBtn){ ev.preventDefault(); rcToggleDiff(diffBtn.dataset.snapshotId, diffBtn.closest('.history-item')); return; }
  const link = ev.target.closest('[data-action="open-detail"]');
  if(!link) return;
  ev.preventDefault();
  openDetail(link.dataset.id);
});
