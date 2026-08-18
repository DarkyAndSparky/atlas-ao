// Тесты авторизации: регистрация первого (бутстрап) аккаунта, вход, выход,
// rate-limit, а также многопользовательские сценарии — приглашение других
// редакторов, удаление аккаунтов, смена собственного пароля.
// Работают на своей собственной чистой БД (тесты идут по порядку и меняют
// глобальное состояние — сначала на сервере вообще нет аккаунтов).

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-auth-'));
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
  // На Windows SQLite иногда держит файловый хэндл чуть дольше, чем на Linux/macOS —
  // rmSync с retry не падает, если папка ещё какое-то мгновение занята.
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function makeClient(){
  let cookie = '';
  async function request(method, path, body){
    const opts = { method, headers: {} };
    if(cookie) opts.headers['Cookie'] = cookie;
    if(body !== undefined){
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + path, opts);
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
    patch: (p,b)=>request('PATCH',p,b),
    del: p=>request('DELETE',p),
  };
}

/* ВАЖНО: тесты в этом файле идут по порядку и меняют глобальное состояние,
   поэтому порядок важен и специально выстроен так.

   С седированным дефолтным admin/admin0000 (см. db.js) на свежей БД уже
   с самого начала есть аккаунт — открытого bootstrap-режима "первый
   аккаунт на сервере" на практике не бывает. Вместо самостоятельной
   регистрации первого пользователя тут: логинимся дефолтным admin,
   заводим через него 'atlant' как второго admin, затем УДАЛЯЕМ дефолтный
   admin (это заодно прямая проверка сценария "что будет, если в админке
   удалить учётку admin" — см. также отдельный test/default-admin.test.js
   с более подробным разбором этого сценария). После этого шага в системе
   остаётся только 'atlant' — и весь дальнейший код теста работает ровно
   так же, как до появления сидирования. */

test('дефолтный admin/admin0000 существует с самого начала — hasAccount=true', async ()=>{
  const c = makeClient();
  const r = await c.get('/api/auth/status');
  assert.equal(r.data.hasAccount, true);
  assert.equal(r.data.loggedIn, false);
});

test('слишком короткий пароль отклоняется при регистрации приглашённого (нужны права admin)', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'admin', password: 'admin0000' });
  const r = await c.post('/api/auth/register', { username: 'tester', password: 'ab' });
  assert.equal(r.status, 400);
});

test('пароль короче 8 символов отклоняется (граница)', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'admin', password: 'admin0000' });
  const r = await c.post('/api/auth/register', { username: 'tester', password: '1234567' }); // 7 символов
  assert.equal(r.status, 400);
});

test('некорректное имя пользователя отклоняется', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'admin', password: 'admin0000' });
  const r = await c.post('/api/auth/register', { username: 'ab', password: 'correcthorsebattery' }); // короче 3 символов
  assert.equal(r.status, 400);
});

test('дефолтный admin создаёт "atlant" вторым admin, затем удаляет сам дефолтный аккаунт', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'admin', password: 'admin0000' });
  const reg = await c.post('/api/auth/register', { username: 'atlant', password: 'correcthorsebattery', role: 'admin' });
  assert.equal(reg.status, 200);

  const users = await c.get('/api/auth/users');
  const defaultAdmin = users.data.find(u=>u.username==='admin');
  assert.ok(defaultAdmin);

  // удаляем дефолтный admin сам через себя же — не последний, atlant уже есть
  const del = await c.del('/api/auth/users/'+defaultAdmin.id);
  assert.equal(del.status, 200);
  assert.equal(del.data.selfDeleted, true);

  const loginDeleted = await makeClient().post('/api/auth/login', { username: 'admin', password: 'admin0000' });
  assert.equal(loginDeleted.status, 401, 'дефолтного admin больше не существует');

  // atlant остался единственным аккаунтом, с этого момента — дальнейшие
  // тесты в этом файле продолжают ровно с тем состоянием, что и раньше
  const usersAfter = await makeClient();
  await usersAfter.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  const list = await usersAfter.get('/api/auth/users');
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].username, 'atlant');
});

test('регистрация нового пользователя без входа -> 401', async ()=>{
  const c = makeClient(); // новый клиент, не залогинен
  const r = await c.post('/api/auth/register', { username: 'someone-else', password: 'anotherpassword1' });
  assert.equal(r.status, 401);
});

test('вошедший пользователь может пригласить второго редактора', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  const r = await c.post('/api/auth/register', { username: 'second-editor', password: 'anotherpassword1' });
  assert.equal(r.status, 200);
  // но сессия первого клиента остаётся его собственной, а не переключается на нового
  const status = await c.get('/api/auth/status');
  assert.equal(status.data.username, 'atlant');
});

test('повторная регистрация того же имени пользователя -> 409', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  const r = await c.post('/api/auth/register', { username: 'Atlant', password: 'yetanotherpass1' }); // регистр не важен
  assert.equal(r.status, 409);
});

test('то же самое, но кириллицей — регистр не должен позволять завести дубль (регрессия)', async ()=>{
  // SQLite COLLATE NOCASE регистронезависимость для кириллицы не работает
  // (только ASCII a-z/A-Z) — тест выше с латиницей эту проблему не ловит
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  const created = await c.post('/api/auth/register', { username: 'Смотритель', password: 'watchtowerpass1' });
  assert.equal(created.status, 200);
  const dup = await c.post('/api/auth/register', { username: 'смотритель', password: 'anotherpass123' });
  assert.equal(dup.status, 409);

  // не оставляем след в общем списке аккаунтов — на него завязаны другие тесты дальше по файлу
  await c.del('/api/auth/users/' + created.data.user.id);
});

test('вход кириллическим именем в другом регистре, чем при регистрации, всё равно работает (регрессия)', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  const created = await c.post('/api/auth/register', { username: 'Хранитель', password: 'guardianpass1' });

  const login = await makeClient().post('/api/auth/login', { username: 'ХРАНИТЕЛЬ', password: 'guardianpass1' });
  assert.equal(login.status, 200, 'логин не должен зависеть от регистра даже для кириллицы');

  await c.del('/api/auth/users/' + created.data.user.id);
});

test('новый клиент (без cookie) не залогинен, пока сам не войдёт', async ()=>{
  const c = makeClient();
  const status = await c.get('/api/auth/status');
  assert.equal(status.data.hasAccount, true); // аккаунты уже есть с прошлых тестов
  assert.equal(status.data.loggedIn, false);  // но этот конкретный клиент не входил
});

test('вход с неверным паролем -> 401', async ()=>{
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username: 'atlant', password: 'totallywrong' });
  assert.equal(r.status, 401);
});

test('вход с несуществующим именем пользователя -> тоже 401 (не палим, что аккаунта нет)', async ()=>{
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username: 'no-such-user', password: 'whatever12' });
  assert.equal(r.status, 401);
});

test('вход с верным паролем -> 200 и логинит клиента', async ()=>{
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  assert.equal(r.status, 200);
  const status = await c.get('/api/auth/status');
  assert.equal(status.data.loggedIn, true);
});

test('второй редактор тоже может войти под своим именем', async ()=>{
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username: 'second-editor', password: 'anotherpassword1' });
  assert.equal(r.status, 200);
});

test('logout снимает вход у этого клиента', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  await c.post('/api/auth/logout', {});
  const status = await c.get('/api/auth/status');
  assert.equal(status.data.loggedIn, false);
});

test('список редакторов виден только вошедшим и содержит обоих', async ()=>{
  const anon = makeClient();
  const anonR = await anon.get('/api/auth/users');
  assert.equal(anonR.status, 401);

  const c = makeClient();
  await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  const r = await c.get('/api/auth/users');
  assert.equal(r.status, 200);
  const names = r.data.map(u=>u.username).sort();
  assert.deepEqual(names, ['atlant', 'second-editor']);
});

test('смена собственного пароля: неверный текущий пароль -> 401', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'second-editor', password: 'anotherpassword1' });
  const r = await c.post('/api/auth/password', { currentPassword: 'wrong', newPassword: 'brandnewpassword1' });
  assert.equal(r.status, 401);
});

test('смена собственного пароля: успешно, старый пароль больше не подходит', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'second-editor', password: 'anotherpassword1' });
  const r = await c.post('/api/auth/password', { currentPassword: 'anotherpassword1', newPassword: 'brandnewpassword1' });
  assert.equal(r.status, 200);

  const oldLogin = await makeClient().post('/api/auth/login', { username: 'second-editor', password: 'anotherpassword1' });
  assert.equal(oldLogin.status, 401);
  const newLogin = await makeClient().post('/api/auth/login', { username: 'second-editor', password: 'brandnewpassword1' });
  assert.equal(newLogin.status, 200);
});

test('удалить чужой аккаунт может любой вошедший редактор', async ()=>{
  // добавляем третьего специально, чтобы удалить и не мешать остальным тестам
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  await c.post('/api/auth/register', { username: 'to-be-deleted', password: 'temporarypass1' });

  const usersBefore = await c.get('/api/auth/users');
  const victim = usersBefore.data.find(u=>u.username==='to-be-deleted');
  assert.ok(victim, 'третий аккаунт должен был создаться');

  const del = await c.del('/api/auth/users/'+victim.id);
  assert.equal(del.status, 200);
  assert.equal(del.data.selfDeleted, false);

  const login = await makeClient().post('/api/auth/login', { username: 'to-be-deleted', password: 'temporarypass1' });
  assert.equal(login.status, 401, 'удалённым аккаунтом больше нельзя войти');
});

test('удалить последнего оставшегося редактора нельзя', async ()=>{
  // на этом этапе в системе остались только atlant и second-editor — удаляем
  // одного, а второго пытаемся удалить и получаем отказ
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  const users = await c.get('/api/auth/users');
  assert.equal(users.data.length, 2);

  const second = users.data.find(u=>u.username==='second-editor');
  const first = users.data.find(u=>u.username==='atlant');

  const delSecond = await c.del('/api/auth/users/'+second.id);
  assert.equal(delSecond.status, 200);

  const delLast = await c.del('/api/auth/users/'+first.id);
  assert.equal(delLast.status, 400, 'нельзя оставить сайт совсем без аккаунтов через API');

  const usersAfter = await c.get('/api/auth/users');
  assert.equal(usersAfter.data.length, 1, 'единственный оставшийся аккаунт должен уцелеть');
});

test('удаление собственного аккаунта сразу разлогинивает клиента (админ)', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  await c.post('/api/auth/register', { username: 'self-deleter-admin', password: 'goawaypass1', role: 'admin' });

  const c2 = makeClient();
  await c2.post('/api/auth/login', { username: 'self-deleter-admin', password: 'goawaypass1' });
  const users = await c2.get('/api/auth/users');
  const me = users.data.find(u=>u.username==='self-deleter-admin');

  const del = await c2.del('/api/auth/users/'+me.id);
  assert.equal(del.status, 200);
  assert.equal(del.data.selfDeleted, true);

  const status = await c2.get('/api/auth/status');
  assert.equal(status.data.loggedIn, false);
});

test('роли: приглашённый без явной роли становится editor, а не admin', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  const reg = await c.post('/api/auth/register', { username: 'plain-editor', password: 'goawaypass1' });
  assert.equal(reg.data.user.role, 'editor');
});

test('роли: editor не может смотреть /users, удалять аккаунты, чужие настройки/бэкапы/О системе', async ()=>{
  const admin = makeClient();
  await admin.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  await admin.post('/api/auth/register', { username: 'limited-editor', password: 'goawaypass1', role: 'editor' });

  const editor = makeClient();
  await editor.post('/api/auth/login', { username: 'limited-editor', password: 'goawaypass1' });

  assert.equal((await editor.get('/api/auth/users')).status, 403);
  assert.equal((await editor.del('/api/auth/users/1')).status, 403);
  assert.equal((await editor.patch('/api/settings', { title: 'Взлом' })).status, 403);
  assert.equal((await editor.get('/api/backup/download')).status, 403);
  assert.equal((await editor.get('/api/system')).status, 403);
  // но контент редактировать по-прежнему можно
  assert.equal((await editor.post('/api/allods', { id:'edtest', name:'Тест роли' })).status, 200);
});

test('роли: editor не может приглашать новых пользователей — только admin', async ()=>{
  const admin = makeClient();
  await admin.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  await admin.post('/api/auth/register', { username: 'inviter-editor', password: 'goawaypass1', role: 'editor' });

  const editor = makeClient();
  await editor.post('/api/auth/login', { username: 'inviter-editor', password: 'goawaypass1' });
  const attempt = await editor.post('/api/auth/register', { username: 'should-not-exist', password: 'goawaypass1' });
  assert.equal(attempt.status, 403);
});

test('роли: нельзя удалить последнего оставшегося admin, даже если editor-аккаунты ещё есть', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username: 'atlant', password: 'correcthorsebattery' });
  const users = await c.get('/api/auth/users');
  const onlyAdmin = users.data.find(u=>u.username==='atlant');
  const del = await c.del('/api/auth/users/'+onlyAdmin.id);
  assert.equal(del.status, 400);
  assert.match(del.data.error, /последнего оставшегося администратора/);
});

test('rate-limit: после 5 неверных попыток 6-я даёт 429, а не 401', async ()=>{
  const c = makeClient();
  let statuses = [];
  for(let i=0;i<6;i++){
    const r = await c.post('/api/auth/login', { username: 'atlant', password: 'wrong-'+i });
    statuses.push(r.status);
  }
  assert.deepEqual(statuses.slice(0,5), [401,401,401,401,401]);
  assert.equal(statuses[5], 429);
});
