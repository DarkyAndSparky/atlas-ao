/* ====================== SITE SETTINGS / BRANDING ======================
   Название, логотип и цвет акцента (отдельно для светлой и тёмной темы)
   настраиваются админом через панель «Настройки» (видна любому вошедшему)
   и применяются на лету через CSS-переменные. */

let siteSettings = null;
state.factionIcons = []; // [{id, faction, icon_url}] — управляемая библиотека, см. routes/factions.js

async function loadFactionIcons(){
  try{ state.factionIcons = await api('/factions'); }
  catch(e){ state.factionIcons = []; }
}
// см. комментарий в server/routes/auth.js про COLLATE NOCASE и кириллицу —
// та же причина регистронезависимого сравнения строго через toLowerCase() в JS
function factionIconFor(faction){
  if(!faction) return null;
  const target = faction.toLowerCase();
  const row = state.factionIcons.find(f => f.faction.toLowerCase() === target);
  return row ? row.icon_url : null;
}

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
  updateThemeQuickToggleIcon();
}

// Публичная кнопка-иконка в шапке — доступна всем посетителям сразу, не
// только через «⚙ Настройки» (которая вообще только для admin). Простое
// переключение светлая/тёмная — вариант "авто" (по системе) остаётся
// доступен в полной панели настроек для тех, кому он нужен.
function updateThemeQuickToggleIcon(){
  const btn = document.getElementById('themeQuickToggle');
  if(!btn) return;
  btn.textContent = isDarkActive() ? '🌙' : '☀️';
}
document.getElementById('themeQuickToggle').addEventListener('click', ()=>{
  setTheme(isDarkActive() ? 'light' : 'dark');
});
updateThemeQuickToggleIcon();
if(window.matchMedia){
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{
    if(!getStoredTheme()){ applyAccentColor(); updateThemeQuickToggleIcon(); } // только если тема не выбрана вручную
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
  document.getElementById('timelineSliderBar').classList.remove('show');
  detailView.classList.remove('show');
  document.getElementById('wikiView').classList.remove('show');
  document.getElementById('aboutView').classList.remove('show');
  document.getElementById('sourcesView').classList.remove('show');
  document.getElementById('timelineView').classList.remove('show');
  document.getElementById('archipelagosView').classList.remove('show');
  document.getElementById('recentChangesView').classList.remove('show');
  document.getElementById('configView').classList.add('show');
  document.querySelectorAll('.view-toggle-btn').forEach(b=> b.classList.remove('active'));
  trayEl.classList.remove('show');
  updateDrawToolbarVisibility();
  renderConfigPanel();
  syncUrl();
}

async function renderConfigPanel(){
  const wrap = document.getElementById('configView');
  const s = siteSettings || {};
  const storedTheme = getStoredTheme(); // null | 'light' | 'dark'
  const users = await api('/auth/users').catch(()=>[]);
  const decorations = await api('/decorations').catch(()=>[]);
  const factionIconsList = await api('/factions').catch(()=>[]);

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
        <h3>👤 Пользователи</h3>
        <p class="config-hint"><b>Администратор</b> — полный доступ: настройки сайта, бэкапы,
        пользователи, «О системе». <b>Редактор</b> — может править контент (острова, локации,
        галерею, карту, фракции, украшения), но не видит эту панель и не может управлять
        пользователями/бэкапами. Роль меняется прямо в списке ниже; «Сбросить пароль» заставит
        человека задать новый при следующем входе (например, если пароль мог стать известен
        кому-то ещё) — доступ при этом не блокируется немедленно, только при следующем входе.
        Нельзя удалить и нельзя понизить в роли последнего оставшегося администратора — если
        понадобится сбросить всех, это делается на сервере командой <code>npm run reset-password</code>.</p>
        <div class="users-list" id="usersList">
          ${users.map(u=>`
            <div class="user-row">
              <span class="user-name">${escapeHtml(u.username)}${u.username===authStatus.username ? ' <em>(вы)</em>' : ''}</span>
              <select class="user-role-select" data-user-id="${u.id}" data-user-name="${escapeHtml(u.username)}">
                <option value="editor" ${u.role==='editor'?'selected':''}>редактор</option>
                <option value="admin" ${u.role==='admin'?'selected':''}>администратор</option>
              </select>
              <span class="user-date">с ${new Date(u.createdAt).toLocaleDateString('ru-RU')}</span>
              ${u.mustChangePassword ? '<span class="user-reset-pending" title="При следующем входе потребуется сменить пароль">ожидает смены пароля</span>' : ''}
              <button class="btn user-reset-pass" data-user-id="${u.id}" data-user-name="${escapeHtml(u.username)}" title="Заставить сменить пароль при следующем входе">Сбросить пароль</button>
              ${users.length>1 ? `<button class="btn user-del" data-user-id="${u.id}" data-user-name="${escapeHtml(u.username)}">Удалить</button>` : ''}
            </div>`).join('')}
        </div>

        <h4 class="config-subhead">Добавить пользователя</h4>
        <div class="config-actions">
          <input type="text" id="cfgNewUser" class="config-input" placeholder="Имя пользователя" style="max-width:220px;">
          <input type="password" id="cfgNewPass" class="config-input" placeholder="Пароль (от 8 символов)" style="max-width:220px;">
          <select id="cfgNewRole" class="config-input" style="max-width:160px;">
            <option value="editor" selected>Редактор</option>
            <option value="admin">Администратор</option>
          </select>
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
        <h3>🖼 Украшения карты</h3>
        <p class="config-hint">Набор картинок для инструмента «Украшение» на панели рисования
        (слева внизу на карте, в режиме редактора). Стартовый набор идёт в комплекте —
        можно добавлять свои или убирать ненужные, список не зашит в код.</p>
        <div class="deco-manage-grid" id="decoManageGrid">
          ${decorations.map(d=>`
            <div class="deco-manage-item" title="${escapeHtml(d.name)}">
              <img src="${escapeHtml(d.url)}" alt="${escapeHtml(d.name)}">
              <span>${escapeHtml(d.name)}</span>
              <button class="deco-del" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name)}" title="Удалить">✕</button>
            </div>`).join('') || '<p class="config-hint">Пока ничего нет.</p>'}
        </div>
        <h4 class="config-subhead">Добавить украшение</h4>
        <div class="config-actions">
          <input type="text" id="cfgNewDecoName" class="config-input" placeholder="Название" style="max-width:220px;">
          <input type="file" id="cfgNewDecoFile" accept="image/*">
          <button class="btn" id="cfgAddDecoBtn">Добавить</button>
        </div>
      </div>

      <div class="config-card config-card-wide">
        <h3>🛡 Иконки фракций</h3>
        <p class="config-hint">Иконка показывается рядом с тегом фракции на странице острова и в заголовке
        группы в «Атласе островов» — там, где название фракции у острова совпадает с одной из
        перечисленных ниже (без учёта регистра). Не хардкод — список полностью управляемый:
        замените картинку, переименуйте фракцию или добавьте новую.</p>
        <div class="faction-manage-grid" id="factionManageGrid">
          ${factionIconsList.map(f=>`
            <div class="faction-manage-item">
              <label class="faction-manage-thumb" title="Заменить картинку">
                <img src="${escapeHtml(f.icon_url)}" alt="${escapeHtml(f.faction)}">
                <input type="file" accept="image/*" class="faction-replace-input" data-id="${escapeHtml(f.id)}">
              </label>
              <input type="text" class="faction-name-input config-input" value="${escapeHtml(f.faction)}"
                     data-id="${escapeHtml(f.id)}" data-prev="${escapeHtml(f.faction)}">
              <button class="icon-del-btn faction-del" data-id="${escapeHtml(f.id)}" data-name="${escapeHtml(f.faction)}" title="Удалить">✕</button>
            </div>`).join('') || '<p class="config-hint">Пока ничего нет.</p>'}
        </div>
        <h4 class="config-subhead">Добавить фракцию</h4>
        <div class="config-actions">
          <input type="text" id="cfgNewFactionName" class="config-input" placeholder="Название фракции" style="max-width:220px;">
          <input type="file" id="cfgNewFactionFile" accept="image/*">
          <button class="btn" id="cfgAddFactionBtn">Добавить</button>
        </div>
      </div>

      <div class="config-card config-card-wide">
        <h3>💾 Данные</h3>
        <p class="config-hint">Экспорт/импорт содержимого таблиц (JSON) — быстрый способ. Скачать/восстановить базу целиком (.db) — самый надёжный способ переноса на другой компьютер, но <b>без</b> загруженных файлов (иконок, галереи) — только структурированные данные и ссылки на них.</p>
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

      <div class="config-card config-card-wide">
        <h3>📦 Полный архив сайта (база + файлы)</h3>
        <p class="config-hint">Для переноса на новый сервер — <b>единственный полный способ</b>: одним .zip
        и база, и все загруженные изображения (иконки островов, галерея, украшения, логотип). Просто
        «Скачать базу» выше — не годится для переезда: ссылки на картинки в базе останутся указывать
        на файлы, которых на новом сервере физически нет.</p>
        <div class="config-actions">
          <button class="btn" id="cfgDownloadFullBtn">Скачать полный архив (.zip)</button>
          <button class="btn" id="cfgRestoreFullBtn">Восстановить из полного архива (.zip)</button>
          <input type="file" id="cfgRestoreFullFile" accept=".zip" style="display:none">
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
    const role = document.getElementById('cfgNewRole').value;
    if(!username || !password) return toast('Укажите имя пользователя и пароль');
    try{
      await api('/auth/register', { method:'POST', body:{ username, password, role } });
      toast('Пользователь добавлен: '+username);
      renderConfigPanel();
    }catch(e){ toast('Ошибка: '+e.message); }
  });

  document.querySelectorAll('.user-role-select').forEach(sel=>{
    const prevValue = sel.value;
    sel.addEventListener('change', async ()=>{
      const id = sel.dataset.userId;
      const name = sel.dataset.userName;
      const isSelf = name === authStatus.username;
      const newRole = sel.value;
      const label = newRole==='admin' ? 'администратора' : 'редактора';
      const ok = await confirmDialog({
        title:'Сменить роль?',
        message: isSelf
          ? `Сменить себе роль на «${label}»? Если это понижение — часть этой панели сразу станет недоступна.`
          : `Сменить роль пользователя «${name}» на «${label}»?`,
        confirmLabel:'Сменить'
      });
      if(!ok){
        sel.value = prevValue;
        return;
      }
      try{
        await api('/auth/users/'+id, { method:'PATCH', body:{ role:newRole } });
        toast('Роль обновлена: '+name);
        if(isSelf) await updateAuthUI();
        renderConfigPanel();
      }catch(e){
        toast('Ошибка: '+e.message);
        sel.value = prevValue;
      }
    });
  });

  document.querySelectorAll('.user-reset-pass').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.userId;
      const name = btn.dataset.userName;
      const ok = await confirmDialog({
        title:'Сбросить пароль?',
        message:`Пользователю «${name}» придётся сменить пароль при следующем входе. Текущий пароль перестанет действовать только после смены — доступ не блокируется немедленно.`,
        confirmLabel:'Сбросить'
      });
      if(!ok) return;
      try{
        await api('/auth/users/'+id, { method:'PATCH', body:{ forcePasswordReset:true } });
        toast('При следующем входе "'+name+'" потребуется сменить пароль');
        renderConfigPanel();
      }catch(e){ toast('Ошибка: '+e.message); }
    });
  });

  document.querySelectorAll('.user-del').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.userId;
      const name = btn.dataset.userName;
      const isSelf = name === authStatus.username;
      const ok = await confirmDialog({
        title:'Удалить пользователя?',
        message: isSelf
          ? `Удалить собственный аккаунт «${name}»? Вы сразу выйдете из системы.`
          : `Удалить пользователя «${name}»? Отменить это будет нельзя.`,
        confirmLabel:'Удалить', danger:true
      });
      if(!ok) return;
      try{
        const result = await api('/auth/users/'+id, { method:'DELETE' });
        toast('Пользователь удалён: '+name);
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

  /* ---- украшения для слоя рисования ---- */
  document.getElementById('cfgAddDecoBtn').addEventListener('click', async ()=>{
    const name = document.getElementById('cfgNewDecoName').value.trim();
    const fileInput = document.getElementById('cfgNewDecoFile');
    const file = fileInput.files[0];
    if(!name || !file) return toast('Укажите название и выберите файл');
    const fd = new FormData();
    fd.append('name', name);
    fd.append('image', file);
    try{
      await api('/decorations', { method:'POST', body: fd });
      toast('Украшение добавлено: '+name);
      await loadDecorations(); // обновляем библиотеку и в самом пикере на карте
      renderConfigPanel();
    }catch(e){ toast('Ошибка: '+e.message); }
  });

  document.querySelectorAll('.deco-del').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const ok = await confirmDialog({
        title:'Убрать украшение?',
        message:`«${btn.dataset.name}» будет убрано из библиотеки. Уже расставленные на карте копии не исчезнут.`,
        confirmLabel:'Убрать'
      });
      if(!ok) return;
      try{
        await api('/decorations/'+btn.dataset.id, { method:'DELETE' });
        toast('Украшение удалено');
        await loadDecorations();
        renderConfigPanel();
      }catch(e){ toast('Ошибка: '+e.message); }
    });
  });

  /* ---- иконки фракций ---- */
  document.getElementById('cfgAddFactionBtn').addEventListener('click', async ()=>{
    const faction = document.getElementById('cfgNewFactionName').value.trim();
    const fileInput = document.getElementById('cfgNewFactionFile');
    const file = fileInput.files[0];
    if(!faction || !file) return toast('Укажите название фракции и выберите файл');
    const fd = new FormData();
    fd.append('faction', faction);
    fd.append('image', file);
    try{
      await api('/factions', { method:'POST', body: fd });
      toast('Иконка добавлена: '+faction);
      await loadFactionIcons();
      renderConfigPanel();
    }catch(e){ toast('Ошибка: '+e.message); }
  });

  document.querySelectorAll('.faction-replace-input').forEach(input=>{
    input.addEventListener('change', async ()=>{
      const file = input.files[0];
      if(!file) return;
      const fd = new FormData();
      fd.append('image', file);
      try{
        await api('/factions/'+input.dataset.id+'/icon', { method:'POST', body: fd });
        toast('Картинка обновлена');
        await loadFactionIcons();
        renderConfigPanel();
      }catch(e){ toast('Ошибка: '+e.message); }
    });
  });

  document.querySelectorAll('.faction-name-input').forEach(input=>{
    input.addEventListener('blur', async ()=>{
      const value = input.value.trim();
      if(!value || value === input.dataset.prev) return;
      try{
        await api('/factions/'+input.dataset.id, { method:'PATCH', body:{ faction: value } });
        toast('Переименовано: '+value);
        await loadFactionIcons();
        renderConfigPanel();
      }catch(e){
        toast('Ошибка: '+e.message);
        input.value = input.dataset.prev; // откатываем на экране, раз не сохранилось
      }
    });
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') input.blur(); });
  });

  document.querySelectorAll('.faction-del').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const ok = await confirmDialog({
        title:'Убрать иконку фракции?',
        message:`«${btn.dataset.name}» — уже показанные на страницах островов иконки перестанут отображаться.`,
        confirmLabel:'Убрать'
      });
      if(!ok) return;
      try{
        await api('/factions/'+btn.dataset.id, { method:'DELETE' });
        toast('Иконка фракции удалена');
        await loadFactionIcons();
        renderConfigPanel();
      }catch(e){ toast('Ошибка: '+e.message); }
    });
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
    const ok = await confirmDialog({
      title:'Заменить базу данных?',
      message:`Текущая база будет заменена содержимым файла «${file.name}». Старая версия сохранится в backups/ на всякий случай, но после этого сервер нужно будет перезапустить вручную.`,
      confirmLabel:'Заменить', danger:true
    });
    if(!ok){
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

  document.getElementById('cfgDownloadFullBtn').addEventListener('click', ()=>{
    window.location.href = '/api/backup/download-full';
  });
  document.getElementById('cfgRestoreFullBtn').addEventListener('click', ()=> document.getElementById('cfgRestoreFullFile').click());
  document.getElementById('cfgRestoreFullFile').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const ok = await confirmDialog({
      title:'Заменить всё содержимое сайта?',
      message:`База и все загруженные файлы будут заменены содержимым архива «${file.name}». Текущие данные сохранятся в backups/ на всякий случай, но после этого сервер нужно будет перезапустить вручную.`,
      confirmLabel:'Заменить', danger:true
    });
    if(!ok){
      e.target.value=''; return;
    }
    const fd = new FormData();
    fd.append('archive', file);
    try{
      const result = await api('/backup/restore-full', { method:'POST', body: fd });
      alert(result.message || 'Сайт восстановлен из полного архива. Перезапустите сервер вручную.');
    }catch(err){ alert('Не удалось восстановить из архива: '+err.message); }
    e.target.value = '';
  });
}

/* configView — тот же DOM-узел на протяжении всей жизни страницы, поэтому один
   делегированный обработчик достаточно повесить один раз при загрузке скрипта. */
document.getElementById('configView').addEventListener('click', (ev)=>{
  const el = ev.target.closest('[data-action="show-map"]');
  if(el) showMap();
});
