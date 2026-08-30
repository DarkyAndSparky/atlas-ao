// Тесты хронологии: общемировые события (scope='world') и события
// конкретного аллода (scope='allod'), сортировка year -> sort_order.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-timeline-'));
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
  const reg = await seedAdmin.post('/api/auth/register', { username:'timelineeditor', password:'timeline-editor-pass1', role:'admin' });
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
  const r = await c.post('/api/auth/login', { username:'timelineeditor', password:'timeline-editor-pass1' });
  assert.equal(r.status, 200);
  return c;
}

test('создание мирового события без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.post('/api/timeline', { scope:'world', year:100, title:'X' });
  assert.equal(r.status, 401);
});

test('создание без title/year отклоняется', async ()=>{
  const c = await loginClient();
  const r1 = await c.post('/api/timeline', { scope:'world', year:100 });
  assert.equal(r1.status, 400);
  const r2 = await c.post('/api/timeline', { scope:'world', title:'Без года' });
  assert.equal(r2.status, 400);
  const r3 = await c.post('/api/timeline', { scope:'world', year:'не число', title:'X' });
  assert.equal(r3.status, 400);
});

test('мировая хронология: события сортируются по year, затем sort_order', async ()=>{
  const c = await loginClient();
  await c.post('/api/timeline', { scope:'world', year:50, title:'Позже в 50 году', sortOrder:1 });
  await c.post('/api/timeline', { scope:'world', year:50, title:'Раньше в 50 году', sortOrder:0 });
  await c.post('/api/timeline', { scope:'world', year:10, title:'Год 10' });

  const r = await c.get('/api/timeline/world');
  assert.equal(r.status, 200);
  const titles = r.data.map(e=>e.title);
  assert.deepEqual(titles, ['Год 10', 'Раньше в 50 году', 'Позже в 50 году']);
});

test('мировая хронология скоуплена по project — разные проекты не пересекаются', async ()=>{
  const c = await loginClient();
  await c.post('/api/timeline', { scope:'world', year:1, title:'Событие в дефолтном проекте' });
  await c.post('/api/timeline', { scope:'world', year:1, title:'Событие в другом проекте', project:'Другой проект' });

  const def = await c.get('/api/timeline/world');
  assert.ok(def.data.some(e=>e.title==='Событие в дефолтном проекте'));
  assert.ok(!def.data.some(e=>e.title==='Событие в другом проекте'));

  const other = await c.get('/api/timeline/world?project=' + encodeURIComponent('Другой проект'));
  assert.ok(other.data.some(e=>e.title==='Событие в другом проекте'));
});

test('событие аллода: создание с несуществующим allodId отклоняется', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/timeline', { scope:'allod', allodId:'nope', year:1, title:'X' });
  assert.equal(r.status, 400);
});

test('событие аллода: наследует project от аллода, видно в /timeline/allod/:id', async ()=>{
  const c = await loginClient();
  const allod = await c.post('/api/allods', { name:'Аллод для хронологии', project:'Тестовый проект' });
  assert.equal(allod.status, 200);
  const allodId = allod.data.id;

  const created = await c.post('/api/timeline', { scope:'allod', allodId, year:5, title:'Основание аллода' });
  assert.equal(created.status, 200);
  assert.equal(created.data.project, 'Тестовый проект');

  const list = await c.get('/api/timeline/allod/' + allodId);
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].title, 'Основание аллода');

  // и не протекает в мировую хронологию того же проекта
  const world = await c.get('/api/timeline/world?project=' + encodeURIComponent('Тестовый проект'));
  assert.ok(!world.data.some(e=>e.title==='Основание аллода'));
});

test('редактирование и удаление события', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/timeline', { scope:'world', year:7, title:'Черновое название' });
  const id = created.data.id;

  const patched = await c.patch('/api/timeline/' + id, { title:'Финальное название', description:'подробности' });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.title, 'Финальное название');
  assert.equal(patched.data.description, 'подробности');
  assert.equal(patched.data.year, 7); // не тронуто

  const del = await c.del('/api/timeline/' + id);
  assert.equal(del.status, 200);
  const world = await c.get('/api/timeline/world');
  assert.ok(!world.data.some(e=>e.id===id));
});

test('удаление аллода каскадом удаляет его события хронологии (настоящий FK)', async ()=>{
  const c = await loginClient();
  const allod = await c.post('/api/allods', { name:'Аллод для удаления с хронологией' });
  const allodId = allod.data.id;
  await c.post('/api/timeline', { scope:'allod', allodId, year:1, title:'Событие, которое должно исчезнуть' });

  await c.del('/api/allods/' + allodId);
  const list = await c.get('/api/timeline/allod/' + allodId);
  assert.equal(list.data.length, 0);
});
