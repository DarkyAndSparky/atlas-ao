/* ====================== AUTH ====================== */
const authOverlay = document.getElementById('authOverlay');
const amTitle = document.getElementById('amTitle');
const amSub = document.getElementById('amSub');
const amUser = document.getElementById('amUser');
const amPass = document.getElementById('amPass');
const amPass2 = document.getElementById('amPass2');
const amErr = document.getElementById('amErr');
let authMode = 'login'; // 'login' | 'create' (create = самый первый бутстрап-аккаунт на сервере)
let authStatus = { hasAccount:false, loggedIn:false, username:null };

async function updateAuthUI(){
  try{ authStatus = await api('/auth/status'); }catch(e){ /* сервер может быть ещё недоступен */ }
  const btn = document.getElementById('authBtn');
  const editorBtn = document.getElementById('editorToggle');
  const configBtn = document.getElementById('configBtn');
  if(authStatus.loggedIn){
    btn.textContent = 'Выйти (' + authStatus.username + ')';
    btn.classList.add('logged-in');
    editorBtn.title = '';
    if(configBtn) configBtn.style.display = 'inline-block';
  }else{
    btn.textContent = 'Войти';
    btn.classList.remove('logged-in');
    if(configBtn) configBtn.style.display = 'none';
    if(state.view === 'config') showMap();
    if(state.editorOn){
      state.editorOn = false;
      editorBtn.classList.remove('on');
      editorBtn.textContent = 'Редактор';
      document.body.classList.remove('editor-on');
      renderMarkers(); renderTray();
      if(state.view==='detail' || state.view==='location') renderDetail();
    }
    editorBtn.title = 'Войдите в аккаунт, чтобы редактировать';
  }
}
document.getElementById('configBtn').addEventListener('click', ()=>{
  if(!authStatus.loggedIn){ openAuth(); return; }
  showConfig();
});

function openAuth(){
  authMode = authStatus.hasAccount ? 'login' : 'create';
  amErr.textContent = '';
  amUser.value=''; amPass.value=''; amPass2.value='';
  if(authMode==='create'){
    amTitle.textContent = 'Создать первый аккаунт редактора';
    amSub.textContent = 'На этом сервере ещё нет ни одного редактора. Придумайте имя пользователя и пароль — они будут храниться в базе данных сервера (SQLite). Позже можно будет пригласить ещё редакторов через панель «Настройки».';
    amPass2.style.display='block';
    document.getElementById('amSubmit').textContent='Создать и войти';
    document.getElementById('amReset').style.display='none';
  }else{
    amTitle.textContent = 'Вход';
    amSub.textContent = 'Введите имя пользователя и пароль редактора.';
    amPass2.style.display='none';
    document.getElementById('amSubmit').textContent='Войти';
    document.getElementById('amReset').style.display='block';
  }
  authOverlay.classList.add('show');
  setTimeout(()=>amUser.focus(), 50);
}
function closeAuth(){ authOverlay.classList.remove('show'); }

document.getElementById('authBtn').addEventListener('click', async ()=>{
  if(authStatus.loggedIn){
    await api('/auth/logout', { method:'POST' });
    toast('Вы вышли из аккаунта');
    await updateAuthUI();
  } else openAuth();
});
document.getElementById('amCancel').addEventListener('click', closeAuth);
document.getElementById('amReset').addEventListener('click', ()=>{
  toast('Сброс пароля выполняется на сервере: npm run reset-password (см. README).');
});
async function submitAuth(){
  const username = amUser.value.trim();
  const p1 = amPass.value;
  if(!username){ amErr.textContent='Введите имя пользователя.'; return; }
  if(!p1){ amErr.textContent='Введите пароль.'; return; }
  try{
    if(authMode==='create'){
      const p2 = amPass2.value;
      if(p1.length<8){ amErr.textContent='Пароль должен быть не короче 8 символов.'; return; }
      if(p1!==p2){ amErr.textContent='Пароли не совпадают.'; return; }
      await api('/auth/register', { method:'POST', body:{ username, password:p1 } });
      toast('Аккаунт создан, вы вошли');
    }else{
      await api('/auth/login', { method:'POST', body:{ username, password:p1 } });
      toast('Вы вошли');
    }
    closeAuth();
    await updateAuthUI();
  }catch(e){ amErr.textContent = e.message; }
}
document.getElementById('amSubmit').addEventListener('click', submitAuth);
[amUser, amPass, amPass2].forEach(inp=> inp.addEventListener('keydown', e=>{ if(e.key==='Enter') submitAuth(); }));
authOverlay.addEventListener('mousedown', e=>{ if(e.target===authOverlay) closeAuth(); });

/* ====================== EDITOR TOGGLE ====================== */
document.getElementById('editorToggle').addEventListener('click', ()=>{
  if(!authStatus.loggedIn){ openAuth(); return; }
  state.editorOn = !state.editorOn;
  document.getElementById('editorToggle').classList.toggle('on', state.editorOn);
  document.getElementById('editorToggle').textContent = state.editorOn? '● Редактор включён':'Редактор';
  document.body.classList.toggle('editor-on', state.editorOn);
  renderMarkers(); renderTray();
  if(state.view==='detail' || state.view==='location') renderDetail();
});

/* Экспорт/импорт/бэкап переехали в панель «Настройки» — см. js/settings.js */
