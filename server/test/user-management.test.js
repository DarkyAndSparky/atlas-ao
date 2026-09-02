// Тесты расширенного управления пользователями (см. обсуждение роадмапа —
// аудит по ролям, раздел "Админ"): PATCH /api/auth/users/:id — смена роли
// существующего пользователя и принудительный сброс пароля, без удаления
// и повторного создания аккаунта.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-user-mgmt-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';

const { createApp } = require('../app');

// Пароль дефолтного admin больше не захардкожен ('admin0000' раньше) —
// генерируется заново на пустой БД (см. db.js) и дублируется в файл рядом
// с самой БД. Читаем его оттуда вместо литерала.
let DEFAULT_PASSWORD;
function readBootstrapPassword(){
  const content = fs.readFileSync(path.join(TEST_DIR, '.bootstrap-password'), 'utf-8');
  const m = content.match(/admin \/ (\S+)/);
  if(!m) throw new Error('Не удалось распарсить .bootstrap-password: '+content);
  return m[1];
}


let server, baseUrl, admin;

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  DEFAULT_PASSWORD = readBootstrapPassword();

  admin = makeClient();
  const r = await admin.post('/api/auth/login', { username:'admin', password:DEFAULT_PASSWORD });
  assert.equal(r.status, 200);
});

after(async ()=>{
  await new Promise(resolve => server.close(resolve));
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function makeClient(){
  let cookie = '';
  async function request(method, p, body){
    const opts = { method, headers: {} };
    if(cookie) opts.headers['Cookie'] = cookie;
    if(body !== undefined){ opts.headers['Content-Type']='application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(baseUrl + p, opts);
    const setCookie = res.headers.get('set-cookie');
    if(setCookie) cookie = setCookie.split(';')[0];
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if(ct.includes('application/json')) data = await res.json().catch(()=>null);
    return { status: res.status, data };
  }
  return { get:p=>request('GET',p), post:(p,b)=>request('POST',p,b), patch:(p,b)=>request('PATCH',p,b), del:p=>request('DELETE',p) };
}

test('без входа -> 401', async ()=>{
  const anon = makeClient();
  const r = await anon.patch('/api/auth/users/1', { role:'admin' });
  assert.equal(r.status, 401);
});

test('редактор (не админ) не может менять роли -> 403', async ()=>{
  const reg = await admin.post('/api/auth/register', { username:'plaineditor', password:'plain-editor-pass1', role:'editor' });
  assert.equal(reg.status, 200);
  const editorId = reg.data.user.id;

  const editorClient = makeClient();
  await editorClient.post('/api/auth/login', { username:'plaineditor', password:'plain-editor-pass1' });
  const r = await editorClient.patch(`/api/auth/users/${editorId}`, { role:'admin' });
  assert.equal(r.status, 403);
});

test('неизвестная роль отклоняется', async ()=>{
  const reg = await admin.post('/api/auth/register', { username:'rolecheck', password:'role-check-pass1', role:'editor' });
  const r = await admin.patch(`/api/auth/users/${reg.data.user.id}`, { role:'superadmin' });
  assert.equal(r.status, 400);
});

test('несуществующий пользователь -> 404', async ()=>{
  const r = await admin.patch('/api/auth/users/999999', { role:'admin' });
  assert.equal(r.status, 404);
});

test('повышение editor -> admin и понижение обратно работают', async ()=>{
  const reg = await admin.post('/api/auth/register', { username:'promoteme', password:'promote-me-pass1', role:'editor' });
  const id = reg.data.user.id;

  const promoted = await admin.patch(`/api/auth/users/${id}`, { role:'admin' });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.data.role, 'admin');

  const demoted = await admin.patch(`/api/auth/users/${id}`, { role:'editor' });
  assert.equal(demoted.status, 200);
  assert.equal(demoted.data.role, 'editor');
});

test('нельзя понизить последнего оставшегося администратора', async ()=>{
  // на этом этапе файла единственный admin — bootstrap-аккаунт 'admin'
  // (остальные созданные в тестах выше — editor или уже понижены обратно)
  const users = await admin.get('/api/auth/users');
  const admins = users.data.filter(u=>u.role==='admin');
  assert.equal(admins.length, 1, 'ожидали ровно одного администратора на этом шаге теста');

  const r = await admin.patch(`/api/auth/users/${admins[0].id}`, { role:'editor' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /последнего/);
});

test('можно понизить админа, если есть ещё один администратор', async ()=>{
  const reg = await admin.post('/api/auth/register', { username:'secondadmin', password:'second-admin-pass1', role:'admin' });
  const secondId = reg.data.user.id;

  const r = await admin.patch(`/api/auth/users/${secondId}`, { role:'editor' });
  assert.equal(r.status, 200);
  assert.equal(r.data.role, 'editor');

  // вернуть обратно, чтобы не влиять на следующий тест по количеству админов
  await admin.patch(`/api/auth/users/${secondId}`, { role:'admin' });
});

test('forcePasswordReset заставляет уже активного пользователя сменить пароль при следующем входе', async ()=>{
  const reg = await admin.post('/api/auth/register', { username:'resetme', password:'reset-me-pass123', role:'editor' });
  const id = reg.data.user.id;
  // приглашённый (не bootstrap) пользователь и так стартует с mustChangePassword=true —
  // моделируем реальный сценарий: он уже сменил пароль и активно пользуется аккаунтом
  const targetClient = makeClient();
  const firstLogin = await targetClient.post('/api/auth/login', { username:'resetme', password:'reset-me-pass123' });
  assert.equal(firstLogin.data.user.mustChangePassword, true);
  const changed = await targetClient.post('/api/auth/password', { currentPassword:'reset-me-pass123', newPassword:'reset-me-new-pass456' });
  assert.equal(changed.status, 200);

  // теперь это обычный активный аккаунт без ожидающего сброса — админ подозревает
  // компрометацию и принудительно требует сменить пароль заново
  const patched = await admin.patch(`/api/auth/users/${id}`, { forcePasswordReset:true });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.mustChangePassword, true);

  const secondLogin = await targetClient.post('/api/auth/login', { username:'resetme', password:'reset-me-new-pass456' });
  assert.equal(secondLogin.status, 200);
  assert.equal(secondLogin.data.user.mustChangePassword, true);
});

test('админ меняет роль самому себе — новая роль применяется сразу в текущей сессии', async ()=>{
  // заводим отдельного второго админа специально для этого теста, чтобы не
  // трогать основной bootstrap-аккаунт 'admin', на который опираются другие тесты
  const reg = await admin.post('/api/auth/register', { username:'selfdemote', password:'self-demote-pass1', role:'admin' });
  const selfClient = makeClient();
  await selfClient.post('/api/auth/login', { username:'selfdemote', password:'self-demote-pass1' });

  const demoteSelf = await selfClient.patch(`/api/auth/users/${reg.data.user.id}`, { role:'editor' });
  assert.equal(demoteSelf.status, 200);

  // сразу следующим запросом той же сессией — админский эндпоинт должен
  // отказать НЕМЕДЛЕННО, без необходимости перелогиниваться
  const afterDemote = await selfClient.get('/api/auth/users');
  assert.equal(afterDemote.status, 403);
});

test('пустое тело запроса не меняет пользователя и не падает', async ()=>{
  const reg = await admin.post('/api/auth/register', { username:'notouch', password:'no-touch-pass123', role:'editor' });
  const r = await admin.patch(`/api/auth/users/${reg.data.user.id}`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.role, 'editor');
});

/* ---------------- мягкая блокировка (disabled) + last_login_at ---------------- */

test('заблокированный пользователь не может войти, даже с верным паролем', async ()=>{
  const reg = await admin.post('/api/auth/register', { username:'tobedisabled', password:'to-be-disabled-1', role:'editor' });
  assert.equal(reg.status, 200);
  const userId = reg.data.user.id;

  const disableRes = await admin.patch(`/api/auth/users/${userId}`, { disabled: true });
  assert.equal(disableRes.status, 200);
  assert.equal(disableRes.data.disabled, true);

  const victimClient = makeClient();
  const loginRes = await victimClient.post('/api/auth/login', { username:'tobedisabled', password:'to-be-disabled-1' });
  assert.equal(loginRes.status, 403);
  assert.match(loginRes.data.error, /заблокирован/);
});

test('блокировка немедленно убивает уже открытую сессию — не ждёт следующего входа', async ()=>{
  const reg = await admin.post('/api/auth/register', { username:'activesession', password:'active-session-pass1', role:'editor' });
  const userId = reg.data.user.id;

  const victimClient = makeClient();
  const loginRes = await victimClient.post('/api/auth/login', { username:'activesession', password:'active-session-pass1' });
  assert.equal(loginRes.status, 200);

  // сессия активна и рабочая — проверим на безобидном authenticated-эндпоинте
  const beforeDisable = await victimClient.get('/api/auth/status');
  assert.equal(beforeDisable.data.loggedIn, true);

  const disableRes = await admin.patch(`/api/auth/users/${userId}`, { disabled: true });
  assert.equal(disableRes.status, 200);

  // та же cookie, тот же клиент — но сессия уже должна быть мертва
  const afterDisable = await victimClient.get('/api/auth/status');
  assert.equal(afterDisable.data.loggedIn, false);
});

test('разблокировка возвращает доступ к входу', async ()=>{
  const reg = await admin.post('/api/auth/register', { username:'reenabled', password:'re-enabled-pass1', role:'editor' });
  const userId = reg.data.user.id;

  await admin.patch(`/api/auth/users/${userId}`, { disabled: true });
  const enableRes = await admin.patch(`/api/auth/users/${userId}`, { disabled: false });
  assert.equal(enableRes.status, 200);
  assert.equal(enableRes.data.disabled, false);

  const victimClient = makeClient();
  const loginRes = await victimClient.post('/api/auth/login', { username:'reenabled', password:'re-enabled-pass1' });
  assert.equal(loginRes.status, 200);
});

test('нельзя заблокировать последнего активного администратора', async ()=>{
  // Общий файл — к этому моменту могло накопиться больше одного активного
  // админа из более ранних тестов (например, "смена роли самому себе").
  // Сводим к ровно одному прямо в этом тесте, а не полагаемся на состояние
  // снаружи — иначе тест хрупкий к порядку/содержимому соседних тестов.
  let usersRes = await admin.get('/api/auth/users');
  let activeAdmins = usersRes.data.filter(u=> u.role==='admin' && !u.disabled);
  for(const extra of activeAdmins.slice(1)){
    const r = await admin.patch(`/api/auth/users/${extra.id}`, { disabled: true });
    assert.equal(r.status, 200, 'блокировка НЕ последнего админа должна проходить');
  }
  usersRes = await admin.get('/api/auth/users');
  activeAdmins = usersRes.data.filter(u=> u.role==='admin' && !u.disabled);
  assert.equal(activeAdmins.length, 1, 'после зачистки должен остаться ровно один активный администратор');

  const r = await admin.patch(`/api/auth/users/${activeAdmins[0].id}`, { disabled: true });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /последнего активного администратора/);
});

test('last_login_at — null у ни разу не логинившегося, проставляется после первого входа', async ()=>{
  const reg = await admin.post('/api/auth/register', { username:'neverloggedin', password:'never-logged-in-1', role:'editor' });
  const userId = reg.data.user.id;

  const beforeLogin = await admin.get('/api/auth/users');
  const beforeRec = beforeLogin.data.find(u=>u.id===userId);
  assert.equal(beforeRec.lastLoginAt, null);

  const victimClient = makeClient();
  await victimClient.post('/api/auth/login', { username:'neverloggedin', password:'never-logged-in-1' });

  const afterLogin = await admin.get('/api/auth/users');
  const afterRec = afterLogin.data.find(u=>u.id===userId);
  assert.ok(afterRec.lastLoginAt !== null && afterRec.lastLoginAt > Date.now() - 10000);
});
