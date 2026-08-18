// Тесты дефолтного аккаунта admin/admin0000 (см. db.js) — защита от дурака:
// на свежей базе без единого аккаунта сервер сам создаёт admin/admin0000
// с обязательной сменой пароля при первом входе. Отдельный файл — своя
// изолированная БД, чтобы не зависеть от порядка/состояния auth.test.js.

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

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
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

test('admin/admin0000 логинится и требует смены пароля (mustChangePassword=true)', async ()=>{
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username: 'admin', password: 'admin0000' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  assert.equal(r.data.user.mustChangePassword, true);

  const status = await c.get('/api/auth/status');
  assert.equal(status.data.mustChangePassword, true);
});

test('дефолтный admin виден в списке пользователей с mustChangePassword=true', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'admin', password: 'admin0000' });
  const users = await c.get('/api/auth/users');
  const admin = users.data.find(u=>u.username==='admin');
  assert.ok(admin);
  assert.equal(admin.mustChangePassword, true);
});

test('нельзя удалить дефолтный admin, пока это единственный аккаунт на сервере', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'admin', password: 'admin0000' });
  const users = await c.get('/api/auth/users');
  const admin = users.data.find(u=>u.username==='admin');

  const del = await c.del('/api/auth/users/'+admin.id);
  assert.equal(del.status, 400);
  assert.match(del.data.error, /последнего оставшегося/);

  // аккаунт реально никуда не делся
  const stillThere = await makeClient().post('/api/auth/login', { username: 'admin', password: 'admin0000' });
  assert.equal(stillThere.status, 200);
});

test('смена пароля дефолтного admin снимает mustChangePassword', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'admin', password: 'admin0000' });
  const change = await c.post('/api/auth/password', { currentPassword: 'admin0000', newPassword: 'a-much-better-password1' });
  assert.equal(change.status, 200);

  const status = await c.get('/api/auth/status');
  assert.equal(status.data.mustChangePassword, false);

  // старый пароль admin0000 больше не подходит, новый — подходит
  const oldLogin = await makeClient().post('/api/auth/login', { username: 'admin', password: 'admin0000' });
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
  assert.equal(users.data.length, 1, 'должен остаться только второй admin — дефолтный удалён в прошлом тесте');

  const onlyLeft = users.data[0];
  const del = await c.del('/api/auth/users/'+onlyLeft.id);
  assert.equal(del.status, 400);
  assert.match(del.data.error, /последнего оставшегося/);
});
