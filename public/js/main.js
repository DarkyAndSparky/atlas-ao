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
  document.getElementById('aboutCount').textContent = state.data.length || '—';
  document.getElementById('aboutAddress').textContent = window.location.origin;
  document.getElementById('aboutHealthResult').textContent = '';
  document.getElementById('aboutHealthResult').className = 'about-health';
  aboutOverlay.classList.add('show');
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
