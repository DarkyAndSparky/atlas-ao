// Тесты простой истории правок (allod_snapshots) — см. обсуждение
// роадмапа: снимок пишется ДО применения каждого PATCH (чтобы можно было
// восстановить именно то, что было утрачено), без диффа/отката.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-history-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';

const { createApp } = require('../app');

let server, baseUrl, admin;

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  admin = makeClient();
  const r = await admin.post('/api/auth/login', { username:'admin', password:'admin0000' });
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

test('без входа история недоступна -> 401', async ()=>{
  const created = await admin.post('/api/allods', { name: 'Остров для проверки прав' });
  const anon = makeClient();
  const r = await anon.get(`/api/allods/${created.data.id}/history`);
  assert.equal(r.status, 401);
});

test('у только что созданного острова история пуста (снимок пишется на PATCH, не на создание)', async ()=>{
  const created = await admin.post('/api/allods', { name: 'Свежий остров без истории' });
  const r = await admin.get(`/api/allods/${created.data.id}/history`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, []);
});

test('PATCH без реальных изменений (пустое тело) не пишет снимок', async ()=>{
  const created = await admin.post('/api/allods', { name: 'Остров без правок' });
  await admin.patch(`/api/allods/${created.data.id}`, {});
  const r = await admin.get(`/api/allods/${created.data.id}/history`);
  assert.deepEqual(r.data, []);
});

test('каждый содержательный PATCH добавляет снимок, автор фиксируется', async ()=>{
  const created = await admin.post('/api/allods', { name: 'Остров с историей' });
  const id = created.data.id;
  await admin.patch(`/api/allods/${id}`, { description: 'Первое описание' });
  await admin.patch(`/api/allods/${id}`, { description: 'Второе описание' });

  const list = await admin.get(`/api/allods/${id}/history`);
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 2);
  assert.equal(list.data[0].changed_by, 'admin');
  // новые сверху
  assert.ok(list.data[0].created_at >= list.data[1].created_at);
});

test('снимок хранит состояние ДО правки — можно восстановить утраченное', async ()=>{
  const created = await admin.post('/api/allods', { name: 'Остров для восстановления' });
  const id = created.data.id;
  await admin.patch(`/api/allods/${id}`, { description: 'Ценный текст, который случайно сотрут' });

  // случайно стёрли описание
  await admin.patch(`/api/allods/${id}`, { description: '' });

  const list = await admin.get(`/api/allods/${id}/history`);
  assert.equal(list.data.length, 2); // снимок ДО первой правки (пустое->текст) и ДО второй (текст->пусто)
  const lastSnapshotId = list.data[0].id; // самый свежий = снимок прямо перед стиранием
  const snap = await admin.get(`/api/allod-snapshots/${lastSnapshotId}`);
  assert.equal(snap.status, 200);
  assert.equal(snap.data.snapshot.description, 'Ценный текст, который случайно сотрут');
});

test('несуществующий снимок -> 404', async ()=>{
  const r = await admin.get('/api/allod-snapshots/snap_nope');
  assert.equal(r.status, 404);
});

test('история переживает удаление самого острова', async ()=>{
  const created = await admin.post('/api/allods', { name: 'Остров на удаление с историей' });
  const id = created.data.id;
  await admin.patch(`/api/allods/${id}`, { description: 'Что-то' });
  const listBefore = await admin.get(`/api/allods/${id}/history`);
  const snapshotId = listBefore.data[0].id;

  await admin.del(`/api/allods/${id}`);

  const snap = await admin.get(`/api/allod-snapshots/${snapshotId}`);
  assert.equal(snap.status, 200);
  assert.equal(snap.data.allodName, 'Остров на удаление с историей');
});
