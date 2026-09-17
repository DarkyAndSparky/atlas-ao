// Роадмап п.20: audit-логирование критических действий (BUG-006).
// Отдельный файл — своя чистая БД, не зависит от порядка тестов в других файлах.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-audit-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';
process.env.ATLAS_ALLOW_HTTP = '1';
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
    put: (p,b)=>request('PUT',p,b),
    patch: (p,b)=>request('PATCH',p,b),
    delete: p=>request('DELETE',p),
  };
}

let server, baseUrl, admin;

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  DEFAULT_PASSWORD = readBootstrapPassword();

  admin = makeClient();
  await admin.post('/api/auth/login', { username:'admin', password: DEFAULT_PASSWORD });
});

after(async ()=>{
  await new Promise(resolve => server.close(resolve));
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('обычный (не админ) пользователь не может читать audit-log', async ()=>{
  await admin.post('/api/auth/register', { username:'petr-editor', password:'petr-original-pass1', role:'editor' });
  const editor = makeClient();
  await editor.post('/api/auth/login', { username:'petr-editor', password:'petr-original-pass1' });
  const r = await editor.get('/api/audit-log');
  assert.equal(r.status, 403);
});

test('создание пользователя админом пишет запись user.create', async ()=>{
  await admin.post('/api/auth/register', { username:'olga-editor', password:'olga-original-pass1', role:'editor' });
  const log = await admin.get('/api/audit-log');
  assert.equal(log.status, 200);
  const entry = log.data.find(e => e.action === 'user.create' && e.targetLabel === 'olga-editor');
  assert.ok(entry, 'должна появиться запись user.create для olga-editor');
  assert.equal(entry.actorUsername, 'admin');
  assert.deepEqual(entry.details, { role: 'editor' });
});

test('смена роли пишет user.role_change с from/to в details', async ()=>{
  const list = await admin.get('/api/auth/users');
  const olga = list.data.find(u => u.username === 'olga-editor');
  await admin.patch('/api/auth/users/'+olga.id, { role: 'admin' });

  const log = await admin.get('/api/audit-log');
  const entry = log.data.find(e => e.action === 'user.role_change' && e.targetLabel === 'olga-editor');
  assert.ok(entry);
  assert.deepEqual(entry.details, { from: 'editor', to: 'admin' });

  // вернём как было, чтобы не мешать следующим тестам файла
  await admin.patch('/api/auth/users/'+olga.id, { role: 'editor' });
});

test('блокировка/разблокировка пишет user.disable и user.enable', async ()=>{
  const list = await admin.get('/api/auth/users');
  const olga = list.data.find(u => u.username === 'olga-editor');

  await admin.patch('/api/auth/users/'+olga.id, { disabled: true });
  await admin.patch('/api/auth/users/'+olga.id, { disabled: false });

  const log = await admin.get('/api/audit-log');
  assert.ok(log.data.find(e => e.action === 'user.disable' && e.targetLabel === 'olga-editor'));
  assert.ok(log.data.find(e => e.action === 'user.enable' && e.targetLabel === 'olga-editor'));
});

test('принудительный сброс пароля пишет user.force_password_reset', async ()=>{
  const list = await admin.get('/api/auth/users');
  const olga = list.data.find(u => u.username === 'olga-editor');
  await admin.patch('/api/auth/users/'+olga.id, { forcePasswordReset: true });

  const log = await admin.get('/api/audit-log');
  assert.ok(log.data.find(e => e.action === 'user.force_password_reset' && e.targetLabel === 'olga-editor'));
});

test('self-service сброс пароля (approve) пишет user.password_reset', async ()=>{
  const anon = makeClient();
  await anon.post('/api/auth/reset-request', { username: 'olga-editor' });
  const requests = await admin.get('/api/auth/reset-requests');
  const req = requests.data.find(r => r.username === 'olga-editor');
  await admin.post('/api/auth/reset-requests/'+req.id+'/approve');

  const log = await admin.get('/api/audit-log');
  assert.ok(log.data.find(e => e.action === 'user.password_reset' && e.targetLabel === 'olga-editor'));
});

test('удаление пользователя пишет user.delete с ролью в details', async ()=>{
  const list = await admin.get('/api/auth/users');
  const olga = list.data.find(u => u.username === 'olga-editor');
  await admin.delete('/api/auth/users/'+olga.id);

  const log = await admin.get('/api/audit-log');
  const entry = log.data.find(e => e.action === 'user.delete' && e.targetLabel === 'olga-editor');
  assert.ok(entry);
  assert.deepEqual(entry.details, { role: 'editor' });
});

test('публикация черновика острова пишет allod.publish_draft', async ()=>{
  const created = await admin.post('/api/allods', { name: 'Остров для публикации черновика' });
  assert.equal(created.status, 200);
  const allodId = created.data.id;

  const putRes = await admin.put('/api/allods/'+allodId+'/draft', { name: 'Остров, обновлённый в черновике' });
  assert.equal(putRes.status, 200);

  const pub = await admin.post('/api/allods/'+allodId+'/draft/publish');
  assert.equal(pub.status, 200);

  const log = await admin.get('/api/audit-log');
  const entry = log.data.find(e => e.action === 'allod.publish_draft' && e.targetId === allodId);
  assert.ok(entry, 'должна появиться запись allod.publish_draft для '+allodId);
  assert.equal(entry.targetLabel, 'Остров для публикации черновика'); // имя ДО применения черновика
});

test('лимит limit ограничен сверху и не падает на некорректном значении', async ()=>{
  const r1 = await admin.get('/api/audit-log?limit=999999');
  assert.equal(r1.status, 200);
  assert.ok(r1.data.length <= 500);

  const r2 = await admin.get('/api/audit-log?limit=not-a-number');
  assert.equal(r2.status, 200); // падает обратно на дефолт, не 500
});
