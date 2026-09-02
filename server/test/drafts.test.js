// Тесты черновиков острова — сохранение (upsert, не PATCH напрямую в live),
// публикация (через тот же путь кода, что и обычный PATCH — снимок+rev) и
// отклонение. Отдельный файл, не расширение allods.test.js — своя тема,
// свои сценарии.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-drafts-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';

const { createApp } = require('../app');

let DEFAULT_PASSWORD;
function readBootstrapPassword(){
  const content = fs.readFileSync(path.join(TEST_DIR, '.bootstrap-password'), 'utf-8');
  const m = content.match(/admin \/ (\S+)/);
  if(!m) throw new Error('Не удалось распарсить .bootstrap-password: '+content);
  return m[1];
}

let server, baseUrl, admin, allodId;

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  DEFAULT_PASSWORD = readBootstrapPassword();
  admin = makeClient();
  await admin.post('/api/auth/login', { username:'admin', password:DEFAULT_PASSWORD });
  const created = await admin.post('/api/allods', { name:'Остров для черновиков' });
  allodId = created.data.id;
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
  return { get:p=>request('GET',p), post:(p,b)=>request('POST',p,b), put:(p,b)=>request('PUT',p,b), patch:(p,b)=>request('PATCH',p,b), del:p=>request('DELETE',p) };
}

test('черновика изначально нет', async ()=>{
  const r = await admin.get(`/api/allods/${allodId}/draft`);
  assert.equal(r.status, 200);
  assert.equal(r.data, null);
});

test('первое сохранение черновика заводит его, семенится копией live-полей', async ()=>{
  const r = await admin.put(`/api/allods/${allodId}/draft`, { description: 'черновой текст описания' });
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'Остров для черновиков'); // не менялось — унаследовано от live
  assert.equal(r.data.description, 'черновой текст описания');
  assert.equal(r.data.history, ''); // live history было пустым

  // live остров при этом не тронут
  const live = await admin.get(`/api/allods/${allodId}`);
  assert.equal(live.data.description, '');
});

test('пустое название в черновике отклоняется', async ()=>{
  const r = await admin.put(`/api/allods/${allodId}/draft`, { name: '   ' });
  assert.equal(r.status, 400);
});

test('публикация применяет черновик к live тем же путём, что и обычный PATCH (снимок + rev)', async ()=>{
  const before = await admin.get(`/api/allods/${allodId}`);
  const revBefore = before.data.rev;

  const pub = await admin.post(`/api/allods/${allodId}/draft/publish`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.description, 'черновой текст описания');
  assert.equal(pub.data.rev, revBefore + 1);

  const live = await admin.get(`/api/allods/${allodId}`);
  assert.equal(live.data.description, 'черновой текст описания');

  // снимок ДО правки должен появиться в истории
  const history = await admin.get(`/api/allods/${allodId}/history`);
  assert.ok(history.data.length >= 1);
});

test('черновик удаляется после публикации', async ()=>{
  const r = await admin.get(`/api/allods/${allodId}/draft`);
  assert.equal(r.data, null);
});

test('публиковать нечего — 404', async ()=>{
  const r = await admin.post(`/api/allods/${allodId}/draft/publish`);
  assert.equal(r.status, 404);
});

test('отклонение черновика не трогает live', async ()=>{
  await admin.put(`/api/allods/${allodId}/draft`, { description: 'этот текст никогда не опубликуется' });
  const del = await admin.del(`/api/allods/${allodId}/draft`);
  assert.equal(del.status, 200);

  const draftAfter = await admin.get(`/api/allods/${allodId}/draft`);
  assert.equal(draftAfter.data, null);

  const live = await admin.get(`/api/allods/${allodId}`);
  assert.equal(live.data.description, 'черновой текст описания'); // осталось от предыдущей публикации, не тронуто
});

test('публикация без реальных изменений (черновик совпал с live) не создаёт лишний снимок в истории, но проходит успешно', async ()=>{
  const live = await admin.get(`/api/allods/${allodId}`);
  await admin.put(`/api/allods/${allodId}/draft`, { description: live.data.description }); // совпадает с live дословно
  const historyBefore = await admin.get(`/api/allods/${allodId}/history`);

  const pub = await admin.post(`/api/allods/${allodId}/draft/publish`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.rev, live.data.rev); // rev не увеличился — реальных изменений не было

  const historyAfter = await admin.get(`/api/allods/${allodId}/history`);
  assert.equal(historyAfter.data.length, historyBefore.data.length);
});

test('гость (незалогиненный) не может ни посмотреть, ни сохранить черновик', async ()=>{
  const guest = makeClient();
  const getRes = await guest.get(`/api/allods/${allodId}/draft`);
  assert.equal(getRes.status, 401);
  const putRes = await guest.put(`/api/allods/${allodId}/draft`, { description: 'взлом' });
  assert.equal(putRes.status, 401);
});
