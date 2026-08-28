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
  await loadFactionIcons(); // до renderMarkers() — иначе бейджи рас не отрисуются при первой загрузке (factionIconFor читает уже загруженный список)
  renderMarkers();
  renderTray();
  await loadAnnotations();
  await loadDecorations();
  await loadSiteSettings();
  await updateAuthUI();
  loadPublicSystemInfo();
  initRouter(); // применяем текущий URL (прямая ссылка на остров/вики/итд или F5) после того, как данные и авторизация уже готовы
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

/* ====================== МИНИ-ПЛАШКА «О СИСТЕМЕ» В ФУТЕРЕ (публичная) ====================== */
async function loadPublicSystemInfo(){
  try{
    const info = await api('/system/public');
    document.getElementById('sysInfoVersion').textContent = info.version;
    if(info.author){
      const authorEl = document.getElementById('sysInfoAuthor');
      authorEl.textContent = info.author;
      authorEl.href = `https://github.com/${info.author}`;
    }
    if(info.repository) document.getElementById('sysInfoRepo').href = info.repository;
  }catch(e){
    document.getElementById('sysInfoVersion').textContent = '—';
  }
}

document.getElementById('sysInfoVersion').addEventListener('click', ()=>{
  if(!authStatus.loggedIn){ openAuth(); return; }
  if(authStatus.role !== 'admin'){ toast('Полная страница «О системе» доступна только администратору.'); return; }
  showAbout();
});

/* ====================== ВКЛАДКА «О СИСТЕМЕ» (полноценная, только admin) ====================== */
function showAbout(){
  state.view = 'about';
  state.currentId = null; state.currentLocId = null;
  mapView.style.display='none';
  document.getElementById('zoomCtrl').style.display='none';
  document.getElementById('timelineSliderBar').classList.remove('show');
  detailView.classList.remove('show');
  document.getElementById('wikiView').classList.remove('show');
  document.getElementById('configView').classList.remove('show');
  document.getElementById('sourcesView').classList.remove('show');
  document.getElementById('timelineView').classList.remove('show');
  document.getElementById('archipelagosView').classList.remove('show');
  document.getElementById('recentChangesView').classList.remove('show');
  document.getElementById('aboutView').classList.add('show');
  document.querySelectorAll('.view-toggle-btn').forEach(b=> b.classList.remove('active'));
  trayEl.classList.remove('show');
  updateDrawToolbarVisibility();
  renderAboutPanel();
  syncUrl();
}

function aboutBreadcrumb(){
  return `<div class="breadcrumb"><span class="breadcrumb-link" data-action="show-map">Атлас</span> / О системе</div>`;
}

async function renderAboutPanel(){
  const wrap = document.getElementById('aboutView');
  wrap.innerHTML = `
    <div class="config-hero">
      ${aboutBreadcrumb()}
      <h1>О системе</h1>
    </div>
    <div class="about-body">

      <div class="about-actions">
        <button id="aboutHealthBtn" type="button">🔍 Проверить состояние</button>
        <button id="aboutRefreshBtn" type="button">⚙️ Обновить данные</button>
      </div>
      <div class="about-health" id="aboutHealthResult"></div>

      <div class="config-card config-card-wide">
        <div class="about-rows">
          <div class="about-row"><span>Версия</span><b id="aboutVersion">—</b></div>
          <div class="about-row"><span>Аллодов в базе</span><b id="aboutCount">${state.data.length || '—'}</b></div>
          <div class="about-row"><span>БД</span><b><code>server/atlas.db</code> (node:sqlite)</b></div>
          <div class="about-row"><span>Сервер</span><b>Node.js + Express</b></div>
          <div class="about-row"><span>Адрес</span><b><code id="aboutAddress">${window.location.origin}</code></b></div>
        </div>
        <p class="about-desc" style="margin-top:14px;">Атлас Аллодов — самостоятельный сайт-энциклопедия аллодов
        (островов) вселенной Allods Online: глобальная карта, страницы островов с историей и галереей,
        встроенный редактор для наполнения.</p>
      </div>

      <div class="config-card config-card-wide about-section" id="aboutEnvSection">
        <div class="about-section-title">Окружение</div>
        <div class="about-rows" id="aboutEnvRows"></div>
      </div>

      <div class="config-card config-card-wide about-section" id="aboutTechSection">
        <div class="about-section-title">Технологии</div>
        <div class="about-tech-grid" id="aboutTechGrid"></div>
      </div>

      <div class="config-card config-card-wide about-section" id="aboutDepsSection">
        <div class="about-deps-header">
          <div class="about-section-title" style="margin:0;">Зависимости</div>
          <button id="aboutCheckUpdatesBtn" type="button" class="about-check-btn">🔄 Проверить обновления</button>
        </div>
        <div class="about-deps-status" id="aboutDepsStatus"></div>
        <div class="about-deps-table" id="aboutDepsTable"></div>
      </div>

      <div class="config-card config-card-wide about-section" id="aboutChangelogSection">
        <div class="about-section-title">Последние изменения</div>
        <div class="about-changelog" id="aboutChangelog"></div>
      </div>

      <div class="config-card config-card-wide about-section">
        <div class="about-section-title">Лицензия</div>
        <p class="about-desc" style="margin-bottom:14px;">
          Лицензия <b>MIT</b> распространяется только на исходный код проекта.
          Все ресурсы вселенной Allods Online (название, арты, скриншоты и другой
          игровой контент) принадлежат их правообладателю — ASTRUM ENTERTAINMENT /
          ASTRUM LAB LLC — и лицензией MIT не покрываются.
        </p>
        <a id="aboutLicenseDownload" class="about-license-btn" href="/api/system/license" download>⬇️ Скачать лицензию (.txt)</a>
      </div>

      <div class="config-card config-card-wide">
        <p class="about-legal">
          Это неофициальный, некоммерческий фан-проект. Он не разработан и не поддерживается
          студией ASTRUM ENTERTAINMENT / ASTRUM LAB LLC, не аффилирован с ней и не претендует
          на официальность или полную точность сведений. Все материалы собраны и систематизированы
          энтузиастами, не являющимися сотрудниками разработчика, вручную и на основе открытых
          источников — часть данных может быть неполной, устаревшей или в будущем не соответствовать
          актуальному состоянию игры.
        </p>
        <p class="about-copyright">
          © 2026 ASTRUM LAB LLC. Все права защищены.<br>
          Все товарные знаки являются собственностью их правообладателей.<br>
          Шрифт «Allods West» — © 2008 Zakhar Yaschin для Nival Online. Все права защищены.
        </p>
        <p class="about-author" style="margin-top:10px;">
          Автор: <a href="https://www.linkedin.com/in/tarentiev-makar/" target="_blank" rel="noopener">Макар Терентьев</a>
        </p>
      </div>

    </div>
  `;

  document.getElementById('aboutCount').textContent = state.data.length || '—';
  loadSystemInfo();
  wireAboutHandlers();
}

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
    // не критично — остальная часть вкладки всё равно работает
  }
}

// DOM вкладки «О системе» пересоздаётся при каждом renderAboutPanel() (как и
// в config-панели) — обработчики навешиваются заново каждый раз, поэтому
// вынесены в отдельную функцию, а не document.getElementById(...).addEventListener
// на уровне модуля (тот сработал бы только один раз, на первый рендер).
function wireAboutHandlers(){
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
}

// aboutView — тот же DOM-узел на протяжении всей жизни страницы (как и
// configView), поэтому делегированный обработчик хлебной крошки достаточно
// повесить один раз.
document.getElementById('aboutView').addEventListener('click', (ev)=>{
  const el = ev.target.closest('[data-action="show-map"]');
  if(el) showMap();
});

boot();
