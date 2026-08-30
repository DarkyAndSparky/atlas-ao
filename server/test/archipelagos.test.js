// Тесты архипелагов как контейнеров (не текстового тега): CRUD, массовая
// привязка островов (bulk-assign, используется после ctrl+клик выделения
// на карте) и открепление. Удаление архипелага не удаляет острова — только
// открепляет их (см. обсуждение роадмапа).

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-archipelagos-'));
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
  const reg = await seedAdmin.post('/api/auth/register', { username:'archeditor', password:'arch-editor-pass1', role:'admin' });
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
  const r = await c.post('/api/auth/login', { username:'archeditor', password:'arch-editor-pass1' });
  assert.equal(r.status, 200);
  return c;
}

test('пустой список архипелагов для нового project', async ()=>{
  const c = makeClient();
  const r = await c.get('/api/archipelagos?project=' + encodeURIComponent('Пустой проект'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, []);
});

test('создание архипелага без входа -> 401, без названия -> 400', async ()=>{
  const c = makeClient();
  const r1 = await c.post('/api/archipelagos', { name: 'X' });
  assert.equal(r1.status, 401);

  const authed = await loginClient();
  const r2 = await authed.post('/api/archipelagos', {});
  assert.equal(r2.status, 400);
});

test('bulk-assign: создаёт новый архипелаг и привязывает несколько островов сразу', async ()=>{
  const c = await loginClient();
  const a1 = await c.post('/api/allods', { name: 'Остров 1 для группы' });
  const a2 = await c.post('/api/allods', { name: 'Остров 2 для группы' });
  const a3 = await c.post('/api/allods', { name: 'Остров без группы' });

  const assigned = await c.post('/api/archipelagos/assign', {
    allodIds: [a1.data.id, a2.data.id],
    name: 'Выделенный на карте архипелаг',
  });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.data.updated, 2);
  assert.equal(assigned.data.archipelago.members.length, 2);

  const list = await c.get('/api/allods');
  const allods = list.data;
  assert.equal(allods.find(x=>x.id===a1.data.id).archipelago_id, assigned.data.archipelago.id);
  assert.equal(allods.find(x=>x.id===a2.data.id).archipelago_id, assigned.data.archipelago.id);
  assert.equal(allods.find(x=>x.id===a3.data.id).archipelago_id, null);
});

test('bulk-assign с пустым allodIds -> 400', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/archipelagos/assign', { allodIds: [], archipelagoId: 'whatever' });
  assert.equal(r.status, 400);
});

test('bulk-assign с несуществующим archipelagoId -> 404', async ()=>{
  const c = await loginClient();
  const a = await c.post('/api/allods', { name: 'Одинокий остров' });
  const r = await c.post('/api/archipelagos/assign', { allodIds: [a.data.id], archipelagoId: 'arch_nope' });
  assert.equal(r.status, 404);
});

test('unassign открепляет один остров', async ()=>{
  const c = await loginClient();
  const a = await c.post('/api/allods', { name: 'Остров для открепления' });
  const assigned = await c.post('/api/archipelagos/assign', { allodIds: [a.data.id], name: 'Временный архипелаг' });
  assert.equal(assigned.status, 200);

  const unassigned = await c.post('/api/archipelagos/unassign', { allodId: a.data.id });
  assert.equal(unassigned.status, 200);

  const list = await c.get('/api/allods');
  assert.equal(list.data.find(x=>x.id===a.data.id).archipelago_id, null);
});

test('удаление архипелага НЕ удаляет острова — только открепляет их', async ()=>{
  const c = await loginClient();
  const a1 = await c.post('/api/allods', { name: 'Остров переживёт удаление архипелага 1' });
  const a2 = await c.post('/api/allods', { name: 'Остров переживёт удаление архипелага 2' });
  const assigned = await c.post('/api/archipelagos/assign', { allodIds: [a1.data.id, a2.data.id], name: 'Архипелаг на снос' });
  const archId = assigned.data.archipelago.id;

  const del = await c.del('/api/archipelagos/' + archId);
  assert.equal(del.status, 200);

  const list = await c.get('/api/allods');
  assert.ok(list.data.some(x=>x.id===a1.data.id));
  assert.ok(list.data.some(x=>x.id===a2.data.id));
  assert.equal(list.data.find(x=>x.id===a1.data.id).archipelago_id, null);
  assert.equal(list.data.find(x=>x.id===a2.data.id).archipelago_id, null);

  const getDeleted = await c.get('/api/archipelagos/' + archId);
  assert.equal(getDeleted.status, 404);
});

test('переименование архипелага', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/archipelagos', { name: 'Старое имя' });
  const patched = await c.patch('/api/archipelagos/' + created.data.id, { name: 'Новое имя' });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.name, 'Новое имя');

  const emptyName = await c.patch('/api/archipelagos/' + created.data.id, { name: '' });
  assert.equal(emptyName.status, 400);
});
