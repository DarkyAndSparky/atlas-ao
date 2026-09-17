// Роадмап п.14: self-service запрос на сброс пароля (без email — админ
// подтверждает через панель «Настройки»). Отдельный файл — своя чистая БД,
// не зависит от порядка тестов в auth.test.js.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-reset-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';
process.env.ATLAS_ALLOW_HTTP = '1';
// Тест намеренно шлёт несколько /reset-request подряд с одного и того же
// логина (проверка дедупликации/лимита) — без этого общий rate-limiter
// (см. security/rateLimiter.js) заблокировал бы IP на 5 минут задолго до
// конца файла, ломая последующие тесты.
process.env.ATLAS_DISABLE_RATE_LIMIT = '1';

const { createApp } = require('../app');

let DEFAULT_PASSWORD;
function readBootstrapPassword(){
  const content = fs.readFileSync(path.join(TEST_DIR, '.bootstrap-password'), 'utf-8');
  const m = content.match(/admin \/ (\S+)/);
  if(!m) throw new Error('Не удалось распарсить .bootstrap-password: '+content);
  return m[1];
}

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
  };
}

let server, baseUrl;

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  DEFAULT_PASSWORD = readBootstrapPassword();

  // ещё один пользователь, помимо дефолтного admin, чтобы проверить сброс
  // чужого (не своего) пароля — реалистичный сценарий
  const admin = makeClient();
  await admin.post('/api/auth/login', { username:'admin', password: DEFAULT_PASSWORD });
  await admin.post('/api/auth/register', { username:'ivan-editor', password:'ivan-original-pass1', role:'editor' });
});

after(async ()=>{
  await new Promise(resolve => server.close(resolve));
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('reset-request отвечает одинаковым generic-сообщением и для существующего, и для несуществующего логина', async ()=>{
  const anon = makeClient();
  const r1 = await anon.post('/api/auth/reset-request', { username: 'ivan-editor' });
  const r2 = await anon.post('/api/auth/reset-request', { username: 'no-such-user-at-all' });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r1.data.message, r2.data.message);
});

test('reset-request без пароля/логина не роняет сервер и всё равно отвечает generic-сообщением', async ()=>{
  const anon = makeClient();
  const r = await anon.post('/api/auth/reset-request', {});
  assert.equal(r.status, 200);
  assert.ok(r.data.message);
});

test('reset-request требует входа только для просмотра списка — обычный посетитель не видит /reset-requests', async ()=>{
  const anon = makeClient();
  const r = await anon.get('/api/auth/reset-requests');
  assert.equal(r.status, 401);
});

test('редактор (не админ) тоже не может смотреть список запросов', async ()=>{
  const editor = makeClient();
  await editor.post('/api/auth/login', { username:'ivan-editor', password:'ivan-original-pass1' });
  const r = await editor.get('/api/auth/reset-requests');
  assert.equal(r.status, 403);
});

test('после reset-request для существующего пользователя запрос появляется в списке у админа', async ()=>{
  const admin = makeClient();
  await admin.post('/api/auth/login', { username:'admin', password: DEFAULT_PASSWORD });
  const list = await admin.get('/api/auth/reset-requests');
  assert.equal(list.status, 200);
  assert.ok(list.data.some(r => r.username === 'ivan-editor'));
});

test('повторный reset-request для того же логина не плодит дубликаты в списке', async ()=>{
  const anon = makeClient();
  await anon.post('/api/auth/reset-request', { username: 'ivan-editor' });
  await anon.post('/api/auth/reset-request', { username: 'ivan-editor' });

  const admin = makeClient();
  await admin.post('/api/auth/login', { username:'admin', password: DEFAULT_PASSWORD });
  const list = await admin.get('/api/auth/reset-requests');
  const matching = list.data.filter(r => r.username === 'ivan-editor');
  assert.equal(matching.length, 1);
});

test('approve выдаёт новый пароль, старый перестаёт работать, новый требует смены при входе', async ()=>{
  const admin = makeClient();
  await admin.post('/api/auth/login', { username:'admin', password: DEFAULT_PASSWORD });
  const list = await admin.get('/api/auth/reset-requests');
  const req = list.data.find(r => r.username === 'ivan-editor');
  assert.ok(req, 'запрос от ivan-editor должен быть в списке к этому моменту');

  const approve = await admin.post(`/api/auth/reset-requests/${req.id}/approve`);
  assert.equal(approve.status, 200);
  assert.equal(approve.data.username, 'ivan-editor');
  assert.ok(approve.data.newPassword && approve.data.newPassword.length >= 12);

  // список запросов для этого пользователя должен опустеть — approve разгребает все дубликаты разом
  const listAfter = await admin.get('/api/auth/reset-requests');
  assert.ok(!listAfter.data.some(r => r.username === 'ivan-editor'));

  // старый пароль больше не работает
  const oldLogin = await makeClient().post('/api/auth/login', { username:'ivan-editor', password:'ivan-original-pass1' });
  assert.equal(oldLogin.status, 401);

  // новый пароль работает и требует смены пароля при входе
  const newLogin = await makeClient().post('/api/auth/login', { username:'ivan-editor', password: approve.data.newPassword });
  assert.equal(newLogin.status, 200);
  assert.equal(newLogin.data.user.mustChangePassword, true);
});

test('approve неизвестного id — 404', async ()=>{
  const admin = makeClient();
  await admin.post('/api/auth/login', { username:'admin', password: DEFAULT_PASSWORD });
  const r = await admin.post('/api/auth/reset-requests/999999/approve');
  assert.equal(r.status, 404);
});

test('dismiss убирает запрос из списка, не трогая пароль', async ()=>{
  const anon = makeClient();
  await anon.post('/api/auth/reset-request', { username: 'ivan-editor' });

  const admin = makeClient();
  await admin.post('/api/auth/login', { username:'admin', password: DEFAULT_PASSWORD });
  const list = await admin.get('/api/auth/reset-requests');
  const req = list.data.find(r => r.username === 'ivan-editor');
  assert.ok(req);

  const dismiss = await admin.post(`/api/auth/reset-requests/${req.id}/dismiss`);
  assert.equal(dismiss.status, 200);

  const listAfter = await admin.get('/api/auth/reset-requests');
  assert.ok(!listAfter.data.some(r => r.username === 'ivan-editor'));
});

test('dismiss неизвестного id — 404', async ()=>{
  const admin = makeClient();
  await admin.post('/api/auth/login', { username:'admin', password: DEFAULT_PASSWORD });
  const r = await admin.post('/api/auth/reset-requests/999999/dismiss');
  assert.equal(r.status, 404);
});
