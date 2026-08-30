// Тесты общего журнала изменений (GET /api/recent-changes) — та же
// таблица allod_snapshots, что и per-island история, но без фильтра по
// allod_id, курсорная пагинация по created_at.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-recent-changes-'));
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
  const r = await anon.get('/api/recent-changes');
  assert.equal(r.status, 401);
});

test('собирает правки с РАЗНЫХ островов в одну ленту, новые сверху', async ()=>{
  const a = await admin.post('/api/allods', { name: 'Журнал остров А' });
  const b = await admin.post('/api/allods', { name: 'Журнал остров Б' });
  await admin.patch(`/api/allods/${a.data.id}`, { description: 'правка А1' });
  await admin.patch(`/api/allods/${b.data.id}`, { description: 'правка Б1' });
  await admin.patch(`/api/allods/${a.data.id}`, { description: 'правка А2' });

  const r = await admin.get('/api/recent-changes?limit=3');
  assert.equal(r.status, 200);
  assert.equal(r.data.length, 3);
  assert.equal(r.data[0].allod_name, 'Журнал остров А'); // самая свежая правка
  const names = r.data.map(x=>x.allod_name);
  assert.ok(names.includes('Журнал остров Б'));
});

test('limit ограничен сверху (не больше 200); limit=0 откатывается на дефолт, не роняет запрос', async ()=>{
  const r1 = await admin.get('/api/recent-changes?limit=99999');
  assert.equal(r1.status, 200);
  assert.ok(r1.data.length <= 200);
  const r2 = await admin.get('/api/recent-changes?limit=0');
  assert.equal(r2.status, 200);
  assert.ok(Array.isArray(r2.data));
});

test('журнал переживает удаление острова — запись остаётся с прежним allod_name', async ()=>{
  const created = await admin.post('/api/allods', { name: 'Журнал: остров будет удалён' });
  await admin.patch(`/api/allods/${created.data.id}`, { description: 'последняя правка перед удалением' });
  await admin.del(`/api/allods/${created.data.id}`);

  const r = await admin.get('/api/recent-changes?limit=5');
  assert.ok(r.data.some(x => x.allod_name === 'Журнал: остров будет удалён'));
});

test('курсорная пагинация через before не повторяет уже выданные записи', async ()=>{
  const a = await admin.post('/api/allods', { name: 'Пагинация остров' });
  for(let i=0;i<5;i++){
    await admin.patch(`/api/allods/${a.data.id}`, { description: 'правка номер ' + i });
  }

  const firstPage = await admin.get('/api/recent-changes?limit=2');
  assert.equal(firstPage.data.length, 2);
  const cursor = firstPage.data[firstPage.data.length-1].created_at;

  const secondPage = await admin.get(`/api/recent-changes?limit=2&before=${cursor}`);
  assert.equal(secondPage.status, 200);
  const firstIds = new Set(firstPage.data.map(x=>x.id));
  assert.ok(secondPage.data.every(x => !firstIds.has(x.id)));
  secondPage.data.forEach(x => assert.ok(x.created_at < cursor));
});
