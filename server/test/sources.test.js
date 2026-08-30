// Тесты глобального списка источников и привязок к сущностям (аллод/локация).

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-sources-'));
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


let server, baseUrl;

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  DEFAULT_PASSWORD = readBootstrapPassword();
  const seedAdmin = makeClient();
  await seedAdmin.post('/api/auth/login', { username:'admin', password:DEFAULT_PASSWORD });
  const reg = await seedAdmin.post('/api/auth/register', { username:'sourceeditor', password:'source-editor-pass1', role:'admin' });
  assert.equal(reg.status, 200);
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
async function loginClient(){
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username:'sourceeditor', password:'source-editor-pass1' });
  assert.equal(r.status, 200);
  return c;
}

test('стартовые 3 источника засеяны и видны без входа, с полем refs', async ()=>{
  const c = makeClient();
  const r = await c.get('/api/sources');
  assert.equal(r.status, 200);
  assert.equal(r.data.length, 3);
  assert.ok(r.data.every(s => Array.isArray(s.refs)));
  assert.ok(r.data.some(s => s.url === 'https://dtf.ru/games/1130550-vvedenie-v-istoriyu-vselennoi-allodov'));
});

test('создание источника без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.post('/api/sources', { title: 'X' });
  assert.equal(r.status, 401);
});

test('создание источника без title отклоняется', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/sources', { url: 'https://example.com' });
  assert.equal(r.status, 400);
});

test('создание источника с некорректным url (без http/https) отклоняется', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/sources', { title: 'Плохая ссылка', url: 'ftp://example.com' });
  assert.equal(r.status, 400);
});

test('источник можно создать без url (просто заметка/книга/оффлайн-источник)', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/sources', { title: 'Устное упоминание разработчика на стриме' });
  assert.equal(r.status, 200);
  assert.equal(r.data.url, null);
});

test('полный цикл: создать источник, привязать к аллоду, получить по entity, отвязать, удалить', async ()=>{
  const c = await loginClient();

  const created = await c.post('/api/sources', { title: 'Тестовая статья', url: 'https://example.com/article', note: 'заметка' });
  assert.equal(created.status, 200);
  const sourceId = created.data.id;

  const ref = await c.post('/api/source-refs', { sourceId, entityType: 'allod', entityId: 'allod_test_123', note: 'упоминание в разделе 2' });
  assert.equal(ref.status, 200);
  assert.equal(ref.data.entity_id, 'allod_test_123');

  const forEntity = await c.get('/api/sources/for/allod/allod_test_123');
  assert.equal(forEntity.status, 200);
  assert.equal(forEntity.data.length, 1);
  assert.equal(forEntity.data[0].source.title, 'Тестовая статья');
  assert.equal(forEntity.data[0].ref.note, 'упоминание в разделе 2');

  const listed = await c.get('/api/sources');
  const found = listed.data.find(s => s.id === sourceId);
  assert.equal(found.refs.length, 1);

  const delRef = await c.del('/api/source-refs/' + ref.data.id);
  assert.equal(delRef.status, 200);
  const forEntityAfter = await c.get('/api/sources/for/allod/allod_test_123');
  assert.equal(forEntityAfter.data.length, 0);

  const delSource = await c.del('/api/sources/' + sourceId);
  assert.equal(delSource.status, 200);
  const listedAfter = await c.get('/api/sources');
  assert.ok(!listedAfter.data.some(s => s.id === sourceId));
});

test('привязка к неизвестному типу сущности отклоняется', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/sources', { title: 'Ещё источник' });
  const r = await c.post('/api/source-refs', { sourceId: created.data.id, entityType: 'event', entityId: 'e1' });
  assert.equal(r.status, 400);
});

test('привязка к несуществующему источнику -> 404', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/source-refs', { sourceId: 'src_nope', entityType: 'allod', entityId: 'a1' });
  assert.equal(r.status, 404);
});

test('удаление источника каскадом удаляет его привязки', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/sources', { title: 'Каскадный источник' });
  const ref = await c.post('/api/source-refs', { sourceId: created.data.id, entityType: 'location', entityId: 'loc_1' });
  assert.equal(ref.status, 200);

  await c.del('/api/sources/' + created.data.id);
  const forEntity = await c.get('/api/sources/for/location/loc_1');
  assert.equal(forEntity.data.length, 0);
});

test('удаление аллода чистит его source_refs (без осиротевших записей)', async ()=>{
  const c = await loginClient();
  const allod = await c.post('/api/allods', { name: 'Аллод для теста источников' });
  assert.equal(allod.status, 200);
  const allodId = allod.data.id;

  const src = await c.post('/api/sources', { title: 'Источник для удаляемого аллода' });
  const ref = await c.post('/api/source-refs', { sourceId: src.data.id, entityType: 'allod', entityId: allodId });
  assert.equal(ref.status, 200);

  const delAllod = await c.del('/api/allods/' + allodId);
  assert.equal(delAllod.status, 200);

  const forEntity = await c.get('/api/sources/for/allod/' + allodId);
  assert.equal(forEntity.data.length, 0);
  // сам источник остаётся в глобальном списке — удалили только привязку
  const listed = await c.get('/api/sources');
  assert.ok(listed.data.some(s => s.id === src.data.id));
});
