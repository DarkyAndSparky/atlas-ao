/* ====================== SITE SETTINGS / BRANDING ======================
   Название, логотип и цвет акцента (отдельно для светлой и тёмной темы)
   настраиваются админом через панель «Настройки» (видна любому вошедшему)
   и применяются на лету через CSS-переменные. */

let siteSettings = null;

async function loadSiteSettings(){
  try{
    siteSettings = await api('/settings');
  }catch(e){
    siteSettings = { title:'Атлас Аллодов', logo_url:null, accent_light:'#96701f', accent_dark:'#c9a24b' };
  }
  applyBranding();
}

function applyBranding(){
  if(!siteSettings) return;

  // --- название ---
  document.title = siteSettings.title;
  const brandEl = document.getElementById('brand');
  if(brandEl){
    const parts = siteSettings.title.trim().split(/\s+/);
    if(parts.length > 1){
      const last = parts.pop();
      brandEl.innerHTML = `${escapeHtml(parts.join(' '))} <small>${escapeHtml(last)}</small>`;
    }else{
      brandEl.textContent = siteSettings.title;
    }
    if(siteSettings.logo_url){
      const img = document.createElement('img');
      img.src = siteSettings.logo_url;
      img.alt = '';
      img.className = 'brand-logo';
      brandEl.prepend(img);
    }
  }

  applyAccentColor();
}

/* ====================== ТЕМА (светлая/тёмная/авто) ======================
   Хранится в localStorage. Если не задана явно — используется системная
   (prefers-color-scheme), см. style.css. */
const THEME_KEY = 'atlas_theme';

function getStoredTheme(){
  const t = localStorage.getItem(THEME_KEY);
  return (t === 'light' || t === 'dark') ? t : null;
}
function isDarkActive(){
  const stored = getStoredTheme();
  if(stored) return stored === 'dark';
  return !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function setTheme(theme){
  // theme: 'light' | 'dark' | null (авто, по системе)
  if(theme === 'light' || theme === 'dark'){
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }else{
    localStorage.removeItem(THEME_KEY);
    document.documentElement.removeAttribute('data-theme');
  }
  applyAccentColor();
  if(state.view === 'config') renderConfigPanel();
}
if(window.matchMedia){
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{
    if(!getStoredTheme()) applyAccentColor(); // только если тема не выбрана вручную
  });
}

function applyAccentColor(){
  if(!siteSettings) return;
  const isDark = isDarkActive();
  const base = isDark ? siteSettings.accent_dark : siteSettings.accent_light;
  const bright = lightenHex(base, isDark ? 0.22 : -0.12);
  document.documentElement.style.setProperty('--gold', base);
  document.documentElement.style.setProperty('--gold-bright', bright);
}

// затемняет (amount<0) или осветляет (amount>0) hex-цвет на заданную долю
function lightenHex(hex, amount){
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if(!m) return hex;
  const num = parseInt(m[1], 16);
  let r = (num>>16)&0xff, g = (num>>8)&0xff, b = num&0xff;
  const mix = (c)=> Math.round(amount>=0 ? c + (255-c)*amount : c * (1+amount));
  r = Math.min(255, Math.max(0, mix(r)));
  g = Math.min(255, Math.max(0, mix(g)));
  b = Math.min(255, Math.max(0, mix(b)));
  return '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

/* ====================== ПАНЕЛЬ «НАСТРОЙКИ» (виден любому вошедшему) ====================== */
function showConfig(){
  state.view = 'config';
  state.currentId = null; state.currentLocId = null;
  mapView.style.display='none';
  document.getElementById('zoomCtrl').style.display='none';
  detailView.classList.remove('show');
  document.getElementById('wikiView').classList.remove('show');
  document.getElementById('configView').classList.add('show');
  document.querySelectorAll('.view-toggle-btn').forEach(b=> b.classList.remove('active'));
  trayEl.classList.remove('show');
  renderConfigPanel();
}

async function renderConfigPanel(){
  const wrap = document.getElementById('configView');
  const s = siteSettings || {};
  const storedTheme = getStoredTheme(); // null | 'light' | 'dark'
  const users = await api('/auth/users').catch(()=>[]);

  wrap.innerHTML = `
    <div class="config-hero">
      <div class="breadcrumb"><span class="breadcrumb-link" data-action="show-map">Атлас</span> / Настройки</div>
      <h1>Настройки сайта</h1>
    </div>
    <div class="config-body">

      <div class="config-card">
        <h3>📛 Название</h3>
        <label class="config-label">Название сайта</label>
        <input type="text" id="cfgTitle" class="config-input" maxlength="60" value="${escapeHtml(s.title||'')}">
        <div class="config-actions">
          <button class="btn" id="cfgTitleSave">Сохранить название</button>
        </div>
      </div>

      <div class="config-card">
        <h3>🖼️ Логотип</h3>
        <p class="config-hint">Отображается в шапке рядом с названием. Поддерживаются PNG/JPG/WebP/SVG.</p>
        <div class="config-logo-preview" id="cfgLogoPreview">
          ${s.logo_url ? `<img src="${escapeHtml(s.logo_url)}" alt="">` : `<span>Логотип не установлен</span>`}
        </div>
        <div class="config-actions">
          <input type="file" id="cfgLogoFile" accept="image/*" style="display:none">
          <button class="btn" id="cfgLogoUpload">Загрузить</button>
          ${s.logo_url ? `<button class="btn" id="cfgLogoRemove">Убрать</button>` : ''}
        </div>
      </div>

      <div class="config-card">
        <h3>🌗 Тема оформления</h3>
        <p class="config-hint">Светлая/тёмная выбираются вручную и запоминаются в этом браузере. «Авто» — следует системным настройкам устройства.</p>
        <div class="theme-toggle" id="themeToggle">
          <button class="theme-toggle-btn ${storedTheme===null ? 'active':''}" data-theme-choice="auto">💻 Авто</button>
          <button class="theme-toggle-btn ${storedTheme==='light' ? 'active':''}" data-theme-choice="light">☀️ Светлая</button>
          <button class="theme-toggle-btn ${storedTheme==='dark' ? 'active':''}" data-theme-choice="dark">🌙 Тёмная</button>
        </div>
      </div>

      <div class="config-card config-card-wide">
        <h3>🎨 Цвет акцента</h3>
        <p class="config-hint">Цвет кнопок, активных пунктов и подсветки. Отдельно для светлой и тёмной темы.</p>
        <div class="config-accent-grid">
          <div class="config-accent-col">
            <div class="config-accent-label">☀️ Светлая тема</div>
            <div class="config-swatch-row">
              <input type="color" id="cfgAccentLight" value="${s.accent_light||'#96701f'}">
              <span id="cfgAccentLightHex">${s.accent_light||''}</span>
            </div>
          </div>
          <div class="config-accent-col">
            <div class="config-accent-label">🌙 Тёмная тема</div>
            <div class="config-swatch-row">
              <input type="color" id="cfgAccentDark" value="${s.accent_dark||'#c9a24b'}">
              <span id="cfgAccentDarkHex">${s.accent_dark||''}</span>
            </div>
          </div>
        </div>
        <div class="config-actions">
          <button class="btn" id="cfgAccentSave">Сохранить цвет</button>
          <span class="config-hint" style="margin:0;">Применяется сразу после сохранения</span>
        </div>
      </div>

      <div class="config-card config-card-wide">
        <h3>👤 Редакторы</h3>
        <p class="config-hint">Все перечисленные аккаунты имеют одинаковые права редактирования.
        Нельзя удалить последнего оставшегося — если понадобится сбросить всех,
        это делается на сервере командой <code>npm run reset-password</code>.</p>
        <div class="users-list" id="usersList">
          ${users.map(u=>`
            <div class="user-row">
              <span class="user-name">${escapeHtml(u.username)}${u.username===authStatus.username ? ' <em>(вы)</em>' : ''}</span>
              <span class="user-date">с ${new Date(u.createdAt).toLocaleDateString('ru-RU')}</span>
              ${users.length>1 ? `<button class="btn user-del" data-user-id="${u.id}" data-user-name="${escapeHtml(u.username)}">Удалить</button>` : ''}
            </div>`).join('')}
        </div>

        <h4 class="config-subhead">Добавить редактора</h4>
        <div class="config-actions">
          <input type="text" id="cfgNewUser" class="config-input" placeholder="Имя пользователя" style="max-width:220px;">
          <input type="password" id="cfgNewPass" class="config-input" placeholder="Пароль (от 8 символов)" style="max-width:220px;">
          <button class="btn" id="cfgAddUserBtn">Добавить</button>
        </div>

        <h4 class="config-subhead">Сменить свой пароль</h4>
        <div class="config-actions">
          <input type="password" id="cfgCurPass" class="config-input" placeholder="Текущий пароль" style="max-width:220px;">
          <input type="password" id="cfgNewOwnPass" class="config-input" placeholder="Новый пароль" style="max-width:220px;">
          <button class="btn" id="cfgChangePassBtn">Сменить пароль</button>
        </div>
      </div>

      <div class="config-card config-card-wide">
        <h3>💾 Данные</h3>
        <p class="config-hint">Экспорт/импорт содержимого таблиц (JSON) — быстрый способ. Скачать/восстановить базу целиком (.db) — самый надёжный способ переноса на другой компьютер.</p>
        <div class="config-actions" style="margin-bottom:10px;">
          <button class="btn" id="cfgExportBtn">Экспорт (JSON)</button>
          <button class="btn" id="cfgImportBtn">Импорт (JSON)</button>
          <input type="file" id="cfgImportFile" accept="application/json" style="display:none">
        </div>
        <div class="config-actions">
          <button class="btn" id="cfgDownloadDbBtn">Скачать базу целиком (.db)</button>
          <button class="btn" id="cfgRestoreDbBtn">Восстановить базу из файла (.db)</button>
          <input type="file" id="cfgRestoreFile" accept=".db" style="display:none">
        </div>
      </div>

    </div>
  `;

  document.getElementById('cfgTitleSave').addEventListener('click', async ()=>{
    const title = document.getElementById('cfgTitle').value.trim();
    if(!title) return toast('Название не может быть пустым');
    try{
      siteSettings = await api('/settings', { method:'PATCH', body:{ title } });
      applyBranding();
      toast('Название сохранено');
    }catch(e){ toast('Ошибка: '+e.message); }
  });

  document.getElementById('cfgLogoUpload').addEventListener('click', ()=> document.getElementById('cfgLogoFile').click());
  document.getElementById('cfgLogoFile').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    try{
      siteSettings = await api('/settings/logo', { method:'POST', body: fd });
      applyBranding();
      renderConfigPanel();
      toast('Логотип загружен');
    }catch(err){ toast('Ошибка загрузки: '+err.message); }
    e.target.value = '';
  });
  const removeBtn = document.getElementById('cfgLogoRemove');
  if(removeBtn){
    removeBtn.addEventListener('click', async ()=>{
      try{
        siteSettings = await api('/settings/logo', { method:'DELETE' });
        applyBranding();
        renderConfigPanel();
        toast('Логотип убран');
      }catch(e){ toast('Ошибка: '+e.message); }
    });
  }

  document.querySelectorAll('.theme-toggle-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const choice = btn.dataset.themeChoice;
      setTheme(choice === 'auto' ? null : choice);
      toast(choice==='auto' ? 'Тема: авто (по системе)' : 'Тема сохранена');
    });
  });

  const lightInput = document.getElementById('cfgAccentLight');
  const darkInput = document.getElementById('cfgAccentDark');
  lightInput.addEventListener('input', ()=> document.getElementById('cfgAccentLightHex').textContent = lightInput.value);
  darkInput.addEventListener('input', ()=> document.getElementById('cfgAccentDarkHex').textContent = darkInput.value);
  document.getElementById('cfgAccentSave').addEventListener('click', async ()=>{
    try{
      siteSettings = await api('/settings', { method:'PATCH', body:{
        accent_light: lightInput.value, accent_dark: darkInput.value
      } });
      applyAccentColor();
      toast('Цвет сохранён');
    }catch(e){ toast('Ошибка: '+e.message); }
  });

  /* ---- редакторы: добавить/удалить/сменить свой пароль ---- */
  document.getElementById('cfgAddUserBtn').addEventListener('click', async ()=>{
    const username = document.getElementById('cfgNewUser').value.trim();
    const password = document.getElementById('cfgNewPass').value;
    if(!username || !password) return toast('Укажите имя пользователя и пароль');
    try{
      await api('/auth/register', { method:'POST', body:{ username, password } });
      toast('Редактор добавлен: '+username);
      renderConfigPanel();
    }catch(e){ toast('Ошибка: '+e.message); }
  });

  document.querySelectorAll('.user-del').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.userId;
      const name = btn.dataset.userName;
      const isSelf = name === authStatus.username;
      if(!confirm(isSelf
        ? 'Удалить собственный аккаунт "'+name+'"? Вы сразу выйдете из системы.'
        : 'Удалить редактора "'+name+'"? Отменить это будет нельзя.')) return;
      try{
        const result = await api('/auth/users/'+id, { method:'DELETE' });
        toast('Редактор удалён: '+name);
        if(result.selfDeleted){ await updateAuthUI(); showMap(); }
        else renderConfigPanel();
      }catch(e){ toast('Ошибка: '+e.message); }
    });
  });

  document.getElementById('cfgChangePassBtn').addEventListener('click', async ()=>{
    const currentPassword = document.getElementById('cfgCurPass').value;
    const newPassword = document.getElementById('cfgNewOwnPass').value;
    if(!currentPassword || !newPassword) return toast('Заполните оба поля');
    try{
      await api('/auth/password', { method:'POST', body:{ currentPassword, newPassword } });
      toast('Пароль изменён');
      document.getElementById('cfgCurPass').value = '';
      document.getElementById('cfgNewOwnPass').value = '';
    }catch(e){ toast('Ошибка: '+e.message); }
  });

  /* ---- данные: экспорт/импорт/бэкап ---- */
  document.getElementById('cfgExportBtn').addEventListener('click', ()=>{
    window.location.href = '/api/export';
  });
  document.getElementById('cfgImportBtn').addEventListener('click', ()=> document.getElementById('cfgImportFile').click());
  document.getElementById('cfgImportFile').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async ()=>{
      try{
        const parsed = JSON.parse(reader.result);
        const result = await api('/import', { method:'POST', body: parsed });
        state.data = await api('/allods');
        initFilterSelects();
        toast('Импортировано: '+result.count+' аллодов');
        showMap(); renderMarkers(); renderTray();
      }catch(err){ alert('Не удалось импортировать: '+err.message); }
      e.target.value='';
    };
    reader.readAsText(file);
  });

  document.getElementById('cfgDownloadDbBtn').addEventListener('click', ()=>{
    window.location.href = '/api/backup/download';
  });
  document.getElementById('cfgRestoreDbBtn').addEventListener('click', ()=> document.getElementById('cfgRestoreFile').click());
  document.getElementById('cfgRestoreFile').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    if(!confirm('Заменить текущую базу данных содержимым файла "'+file.name+'"? Текущая база будет сохранена в backups/ на всякий случай, но после этого сервер нужно будет перезапустить вручную.')){
      e.target.value=''; return;
    }
    const fd = new FormData();
    fd.append('database', file);
    try{
      const result = await api('/backup/restore', { method:'POST', body: fd });
      alert(result.message || 'База восстановлена. Перезапустите сервер вручную.');
    }catch(err){ alert('Не удалось восстановить базу: '+err.message); }
    e.target.value = '';
  });
}

/* configView — тот же DOM-узел на протяжении всей жизни страницы, поэтому один
   делегированный обработчик достаточно повесить один раз при загрузке скрипта. */
document.getElementById('configView').addEventListener('click', (ev)=>{
  const el = ev.target.closest('[data-action="show-map"]');
  if(el) showMap();
});
