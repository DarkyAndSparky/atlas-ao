/* ====================== RECENT CHANGES (общий журнал изменений) ======================
   Та же таблица allod_snapshots, что и per-island "История правок" на
   странице острова (см. detailView.js renderAllodHistory) — но без фильтра
   по allod_id, вся лента правок по сайту сразу. Видно любому вошедшему
   (тот же уровень доступа, что и у бэкенда — requireAuth, не requireAdmin):
   это про координацию правок между редакторами, не служебная админ-панель. */

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
}

async function renderRecentChangesPage(){
  const wrap = document.getElementById('recentChangesView');
  wrap.innerHTML = `
    <div class="sources-hero">
      <h1>Последние изменения</h1>
      <p>Правки по всем островам сразу, самые свежие сверху — видно любому вошедшему, не только администратору.</p>
    </div>
    <div class="sources-body" id="recentChangesList">Загрузка…</div>
  `;
  const listEl = document.getElementById('recentChangesList');
  let entries;
  try{ entries = await api('/recent-changes?limit=100'); }
  catch(e){ listEl.innerHTML = `<div class="prose empty" data-empty="Не удалось загрузить журнал."></div>`; return; }

  if(!entries.length){
    listEl.innerHTML = `<div class="prose empty" data-empty="Правок пока не было."></div>`;
    return;
  }
  listEl.innerHTML = `<div class="history-item-list">${entries.map(e=>{
    const date = new Date(e.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    return `
      <div class="history-item">
        <div class="history-row">
          <span class="history-date">${date}</span>
          <a href="#" class="history-target" data-action="open-detail" data-id="${escapeHtml(e.allod_id)}">${escapeHtml(e.allod_name)}</a>
          <span class="history-author">${e.changed_by ? escapeHtml(e.changed_by) : 'неизвестно кто'}</span>
        </div>
      </div>
    `;
  }).join('')}</div>`;
}

document.getElementById('recentChangesView').addEventListener('click', (ev)=>{
  const link = ev.target.closest('[data-action="open-detail"]');
  if(!link) return;
  ev.preventDefault();
  openDetail(link.dataset.id);
});
