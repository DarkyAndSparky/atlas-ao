/* ====================== BOOT ====================== */
async function boot(){
  try{
    state.data = await api('/allods');
  }catch(e){
    showServerOfflineMessage();
    return;
  }
  state.project = getCurrentProject();
  renderProjectSwitcher();
  initFilterSelects();
  state.cam = centeredCamera(0.72);
  applyCamera();
  renderMarkers();
  renderTray();
  await loadAnnotations();
  await loadDecorations();
  await loadFactionIcons();
  await loadSiteSettings();
  await updateAuthUI();
}

function showServerOfflineMessage(){
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="offlineScreen">
      <div class="offline-box">
        <div class="offline-title">Сервер недоступен</div>
        <p>Не удалось подключиться к серверу Атласа Аллодов.</p>
        <p>Проверьте, что сервер запущен: выполните <code>start.sh</code> (Linux/macOS)
           или <code>start.bat</code> (Windows) в папке проекта, либо вручную
           <code>node server.js</code> внутри папки <code>server/</code>.</p>
        <button id="offlineRetryBtn">Повторить попытку</button>
      </div>
    </div>
  `;
  document.getElementById('offlineRetryBtn').addEventListener('click', ()=> location.reload());
}

/* ====================== ABOUT MODAL ====================== */
const aboutOverlay = document.getElementById('aboutOverlay');
document.getElementById('aboutBtn').addEventListener('click', ()=>{
  if(!authStatus.loggedIn){ openAuth(); return; }
  if(authStatus.role !== 'admin'){ toast('«О системе» доступно только администратору.'); return; }
  document.getElementById('aboutCount').textContent = state.data.length || '—';
  document.getElementById('aboutAddress').textContent = window.location.origin;
  document.getElementById('aboutHealthResult').textContent = '';
  document.getElementById('aboutHealthResult').className = 'about-health';
  aboutOverlay.classList.add('show');
  loadSystemInfo();
});

function formatUptime(sec){
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  if(h) return `${h} ч ${m} мин`;
  if(m) return `${m} мин ${s} с`;
  return `${s} с`;
}

async function loadSystemInfo(){
  try{
    const info = await api('/system');
    document.getElementById('aboutVersion').textContent = info.project.version;

    const env = info.environment;
    document.getElementById('aboutEnvRows').innerHTML = `
      <div class="about-row"><span>Node.js</span><b>${env.node}</b></div>
      <div class="about-row"><span>Платформа</span><b>${env.platform}</b></div>
      <div class="about-row"><span>Время работы</span><b>${formatUptime(env.uptimeSeconds)}</b></div>
      <div class="about-row"><span>Память процесса</span><b>${env.memoryMb} МБ</b></div>
      <div class="about-row"><span>PID</span><b>${env.pid}</b></div>
      <div class="about-row"><span>Размер БД</span><b>${env.dbSizeKb != null ? env.dbSizeKb + ' КБ' : '—'}</b></div>
      <div class="about-row"><span>Последний бэкап</span><b>${env.lastBackup ? new Date(env.lastBackup).toLocaleString('ru-RU') : 'ещё не делался'}</b></div>
    `;

    document.getElementById('aboutTechGrid').innerHTML = info.technologies.map(t => `
      <div class="about-tech-item">
        <span class="about-tech-icon">${t.icon}</span>
        <div><div class="about-tech-name">${t.name}</div><div class="about-tech-desc">${t.desc}</div></div>
      </div>
    `).join('');

    document.getElementById('aboutDepsTable').innerHTML = info.dependencies.map(d => `
      <div class="about-deps-row" data-dep="${d.name}">
        <span>${d.name}</span>
        <b class="${d.installed ? 'dep-ok' : ''}">${d.installed || '—'} <span style="opacity:.5;">(${d.range})</span></b>
      </div>
    `).join('');

    const changelogEl = document.getElementById('aboutChangelog');
    if(!info.changelog || !info.changelog.length){
      changelogEl.innerHTML = '<div class="about-changelog-empty">Пока пусто — CHANGELOG.md не заполнен.</div>';
    }else{
      changelogEl.innerHTML = info.changelog.map(entry => `
        <div class="about-changelog-entry">
          <div class="about-changelog-head">
            <span class="about-changelog-version">${escapeHtml(entry.version)}</span>
            ${entry.date ? `<span class="about-changelog-date">${escapeHtml(entry.date)}</span>` : ''}
          </div>
          <ul class="about-changelog-items">
            ${entry.items.map(it => `<li>${escapeHtml(it)}</li>`).join('')}
          </ul>
        </div>
      `).join('');
    }
  }catch(e){
    // не критично — остальная часть модалки всё равно работает
  }
}

document.getElementById('aboutCheckUpdatesBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('aboutCheckUpdatesBtn');
  const status = document.getElementById('aboutDepsStatus');
  btn.disabled = true;
  status.className = 'about-deps-status';
  status.textContent = 'Проверяю на npm…';
  try{
    const { results, checkedAt } = await api('/system/check-updates');
    results.forEach(r=>{
      const row = document.querySelector(`.about-deps-row[data-dep="${r.name}"]`);
      if(!row) return;
      const b = row.querySelector('b');
      if(r.error){
        b.innerHTML = `${escapeHtml(r.installed || '—')} <span style="opacity:.5;">— ошибка проверки</span>`;
        return;
      }
      const cls = r.upToDate ? 'dep-ok' : 'dep-outdated';
      const note = r.upToDate ? 'актуально' : `новее: ${r.latest}`;
      b.className = cls;
      b.innerHTML = `${escapeHtml(r.installed || '—')} <span style="opacity:.5;">— ${escapeHtml(note)}</span>`;
    });
    const outdated = results.filter(r=>!r.error && !r.upToDate).length;
    status.textContent = outdated
      ? `Проверено ${new Date(checkedAt).toLocaleTimeString('ru-RU')} — ${outdated} пакет(ов) можно обновить.`
      : `Все пакеты актуальны — проверено ${new Date(checkedAt).toLocaleTimeString('ru-RU')}.`;
  }catch(e){
    status.className = 'about-deps-status error';
    status.textContent = 'Не удалось проверить обновления: ' + e.message;
  }finally{
    btn.disabled = false;
  }
});
document.getElementById('aboutClose').addEventListener('click', ()=> aboutOverlay.classList.remove('show'));
aboutOverlay.addEventListener('mousedown', e=>{ if(e.target===aboutOverlay) aboutOverlay.classList.remove('show'); });

document.getElementById('aboutHealthBtn').addEventListener('click', async ()=>{
  const el = document.getElementById('aboutHealthResult');
  el.className = 'about-health';
  el.textContent = 'Проверяю…';
  const startedAt = performance.now();
  try{
    const rows = await api('/allods');
    const ms = Math.round(performance.now() - startedAt);
    el.textContent = `Сервер отвечает: ${rows.length} аллодов, ${ms} мс.`;
  }catch(e){
    el.classList.add('error');
    el.textContent = 'Сервер не отвечает: ' + e.message;
  }
});

document.getElementById('aboutRefreshBtn').addEventListener('click', async ()=>{
  const el = document.getElementById('aboutHealthResult');
  el.className = 'about-health';
  el.textContent = 'Обновляю данные…';
  try{
    state.data = await api('/allods');
    initFilterSelects();
    renderMarkers(); renderTray();
    if(state.view==='detail' || state.view==='location') renderDetail();
    document.getElementById('aboutCount').textContent = state.data.length;
    el.textContent = 'Данные обновлены с сервера.';
  }catch(e){
    el.classList.add('error');
    el.textContent = 'Не удалось обновить: ' + e.message;
  }
});

boot();
