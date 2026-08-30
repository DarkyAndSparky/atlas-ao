// Тесты дефолтного аккаунта admin/<сгенерированный пароль> (см. db.js) —
// защита от дурака: на свежей базе без единого аккаунта сервер сам
// создаёт admin со случайным паролем (не захардкоженным — раньше здесь
// было 'admin0000' для каждой установки этого проекта, это был реальный
// риск для тех, кто не поменял его вовремя).
// Отдельный файл — своя изолированная БД, чтобы не зависеть от
// порядка/состояния auth.test.js.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-default-admin-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';

const { createApp } = require('../app');

let server, baseUrl;
let DEFAULT_PASSWORD; // читаем после создания приложения — см. before() ниже

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  DEFAULT_PASSWORD = readBootstrapPassword();
});

// Пароль больше не захардкожен ('admin0000' раньше) — генерируется заново
// при каждом запуске на пустой БД (см. db.js) и дублируется в файл рядом
// с самой БД. Читаем его оттуда, а не подбираем/угадываем.
function readBootstrapPassword(){
  const content = fs.readFileSync(path.join(TEST_DIR, '.bootstrap-password'), 'utf-8');
  const m = content.match(/admin \/ (\S+)/);
  if(!m) throw new Error('Не удалось распарсить .bootstrap-password: '+content);
  return m[1];
}

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
    if(body !== undefined){
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + p, opts);
    const setCookie = res.headers.get('set-cookie');
    if(setCookie) cookie = setCookie.split(';')[0];
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if(ct.includes('application/json')) data = await res.json().catch(()=>null);
    return { status: res.status, data };
  }
  return {
    get: p=>request('GET',p),
    post: (p,b)=>request('POST',p,b),
    del: p=>request('DELETE',p),
  };
}

/* Тесты в этом файле идут по порядку и меняют общее состояние (как и в
   остальных auth-тестах) — это осознанно, а не проблема. */

test('на свежей базе hasAccount=true с самого начала — дефолтный admin уже создан', async ()=>{
  const c = makeClient();
  const r = await c.get('/api/auth/status');
  assert.equal(r.data.hasAccount, true);
  assert.equal(r.data.loggedIn, false);
});

test('admin со сгенерированным паролем логинится и требует смены пароля (mustChangePassword=true)', async ()=>{
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username: 'admin', password: DEFAULT_PASSWORD });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  assert.equal(r.data.user.mustChangePassword, true);

  const status = await c.get('/api/auth/status');
  assert.equal(status.data.mustChangePassword, true);
});

test('дефолтный admin виден в списке пользователей с mustChangePassword=true', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'admin', password: DEFAULT_PASSWORD });
  const users = await c.get('/api/auth/users');
  const admin = users.data.find(u=>u.username==='admin');
  assert.ok(admin);
  assert.equal(admin.mustChangePassword, true);
});

test('нельзя удалить дефолтный admin, пока это единственный аккаунт на сервере', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'admin', password: DEFAULT_PASSWORD });
  const users = await c.get('/api/auth/users');
  const admin = users.data.find(u=>u.username==='admin');

  const del = await c.del('/api/auth/users/'+admin.id);
  assert.equal(del.status, 400);
  assert.match(del.data.error, /последнего оставшегося/);

  // аккаунт реально никуда не делся
  const stillThere = await makeClient().post('/api/auth/login', { username: 'admin', password: DEFAULT_PASSWORD });
  assert.equal(stillThere.status, 200);
});

test('форс-смена пароля (must_change_password=1) НЕ требует текущий пароль — сессия уже аутентифицирована', async ()=>{
  const admin = makeClient();
  await admin.post('/api/auth/login', { username: 'admin', password: DEFAULT_PASSWORD });
  await admin.post('/api/auth/register', { username: 'forced-user', password: 'temp-password-1' }); // роль по умолчанию editor, must_change_password=1

  const c = makeClient();
  await c.post('/api/auth/login', { username: 'forced-user', password: 'temp-password-1' });
  assert.equal((await c.get('/api/auth/status')).data.mustChangePassword, true);

  // currentPassword вообще не передаём — должно пройти, раз идёт форс-смена
  const change = await c.post('/api/auth/password', { newPassword: 'brand-new-password-1' });
  assert.equal(change.status, 200);
  assert.equal((await c.get('/api/auth/status')).data.mustChangePassword, false);

  const relogin = await makeClient().post('/api/auth/login', { username: 'forced-user', password: 'brand-new-password-1' });
  assert.equal(relogin.status, 200);
});

test('обычная (не форс) смена пароля по-прежнему требует верный currentPassword', async ()=>{
  // 'forced-user' из предыдущего теста уже сменил пароль — must_change_password теперь 0
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'forced-user', password: 'brand-new-password-1' });

  const wrongCurrent = await c.post('/api/auth/password', { currentPassword: 'totally-wrong', newPassword: 'yet-another-password-1' });
  assert.equal(wrongCurrent.status, 401);

  const correctCurrent = await c.post('/api/auth/password', { currentPassword: 'brand-new-password-1', newPassword: 'yet-another-password-1' });
  assert.equal(correctCurrent.status, 200);
});

test('смена пароля дефолтного admin снимает mustChangePassword', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'admin', password: DEFAULT_PASSWORD });
  const change = await c.post('/api/auth/password', { currentPassword: DEFAULT_PASSWORD, newPassword: 'a-much-better-password1' });
  assert.equal(change.status, 200);

  const status = await c.get('/api/auth/status');
  assert.equal(status.data.mustChangePassword, false);

  // старый (сгенерированный) пароль больше не подходит, новый — подходит
  const oldLogin = await makeClient().post('/api/auth/login', { username: 'admin', password: DEFAULT_PASSWORD });
  assert.equal(oldLogin.status, 401);
  const newLogin = await makeClient().post('/api/auth/login', { username: 'admin', password: 'a-much-better-password1' });
  assert.equal(newLogin.status, 200);
  assert.equal(newLogin.data.user.mustChangePassword, false);
});

test('после появления второго admin — удаление ПЕРВОНАЧАЛЬНОГО дефолтного admin проходит нормально', async ()=>{
  // (пароль уже сменён в предыдущем тесте на a-much-better-password1)
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'admin', password: 'a-much-better-password1' });
  await c.post('/api/auth/register', { username: 'second-admin', password: 'second-admin-pass1', role: 'admin' });

  const users = await c.get('/api/auth/users');
  const originalAdmin = users.data.find(u=>u.username==='admin');
  assert.ok(originalAdmin, 'дефолтный admin ещё должен существовать на этом шаге');

  // удаляем ЧУЖОЙ (не свой) аккаунт — из-под сессии дефолтного admin удаляем сам себя
  const del = await c.del('/api/auth/users/'+originalAdmin.id);
  assert.equal(del.status, 200);
  assert.equal(del.data.selfDeleted, true, 'admin удалил сам себя, сессия должна была разлогиниться');

  // сессия того же клиента теперь разлогинена
  const status = await c.get('/api/auth/status');
  assert.equal(status.data.loggedIn, false);

  // а вот войти по старому логину admin/пароль больше нельзя — аккаунта нет
  const loginAsDeleted = await makeClient().post('/api/auth/login', { username: 'admin', password: 'a-much-better-password1' });
  assert.equal(loginAsDeleted.status, 401);

  // при этом второй admin остаётся полностью рабочим — сайт не осиротел
  const loginSecond = await makeClient().post('/api/auth/login', { username: 'second-admin', password: 'second-admin-pass1' });
  assert.equal(loginSecond.status, 200);
  assert.equal(loginSecond.data.user.role, 'admin');
});

test('после удаления дефолтного admin сайт снова остался хотя бы с одним админом — нельзя удалить и его тоже', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'second-admin', password: 'second-admin-pass1' });
  const users = await c.get('/api/auth/users');
  const admins = users.data.filter(u=>u.role==='admin');
  assert.equal(admins.length, 1, 'должен остаться только один admin — дефолтный удалён в прошлом тесте');
  assert.equal(admins[0].username, 'second-admin');

  const del = await c.del('/api/auth/users/'+admins[0].id);
  assert.equal(del.status, 400);
  assert.match(del.data.error, /последнего оставшегося/);
});
