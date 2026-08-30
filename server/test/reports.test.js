// Тесты обращений гостей ("сообщить об ошибке") — единственный публичный
// write-эндпоинт на весь сайт, поэтому отдельное внимание к тому, что
// незалогиненный клиент действительно может им пользоваться, а админ может
// их видеть/закрывать/удалять, и никто другой.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-reports-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';
process.env.ATLAS_REPORT_RATE_LIMIT_MAX = '20'; // маленький, но с запасом на все "нормальные" тесты этого файла — сам rate-limit проверяется отдельным тестом ниже, который специально досылает запросы до превышения

const { createApp } = require('../app');

let DEFAULT_PASSWORD;
function readBootstrapPassword(){
  const content = fs.readFileSync(path.join(TEST_DIR, '.bootstrap-password'), 'utf-8');
  const m = content.match(/admin \/ (\S+)/);
  if(!m) throw new Error('Не удалось распарсить .bootstrap-password: '+content);
  return m[1];
}

let server, baseUrl, allodId;

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  DEFAULT_PASSWORD = readBootstrapPassword();
  const admin = makeClient();
  await admin.post('/api/auth/login', { username:'admin', password:DEFAULT_PASSWORD });
  const created = await admin.post('/api/allods', { name:'Остров для репортов' });
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
  return { get:p=>request('GET',p), post:(p,b)=>request('POST',p,b), patch:(p,b)=>request('PATCH',p,b), del:p=>request('DELETE',p) };
}
async function loginAdmin(){
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username:'admin', password:DEFAULT_PASSWORD });
  assert.equal(r.status, 200);
  return c;
}

test('незалогиненный гость может отправить обращение', async ()=>{
  const guest = makeClient();
  const r = await guest.post('/api/reports', { message: 'На острове опечатка в описании', allodId });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

test('пустое сообщение отклоняется', async ()=>{
  const guest = makeClient();
  const r = await guest.post('/api/reports', { message: '   ' });
  assert.equal(r.status, 400);
});

test('слишком длинное сообщение отклоняется', async ()=>{
  const guest = makeClient();
  const r = await guest.post('/api/reports', { message: 'x'.repeat(2001) });
  assert.equal(r.status, 400);
});

test('несуществующий allodId не роняет запрос — просто сохраняется без привязки к острову', async ()=>{
  const guest = makeClient();
  const r = await guest.post('/api/reports', { message: 'Общий отзыв о сайте', allodId: 'no-such-id' });
  assert.equal(r.status, 200);
});

test('гость НЕ может посмотреть список обращений (эндпоинт админский)', async ()=>{
  const guest = makeClient();
  const r = await guest.get('/api/reports');
  assert.equal(r.status, 401);
});

test('rate limit: после нескольких обращений подряд с одного клиента — 429', async ()=>{
  // К этому моменту предыдущие тесты файла уже отправили несколько запросов
  // с того же IP (лимит общий на процесс, не на клиента/cookie) — с запасом
  // досылаем ещё, чтобы гарантированно перевалить за ATLAS_REPORT_RATE_LIMIT_MAX=20.
  const guest = makeClient();
  let lastStatus;
  for(let i=0;i<25;i++){
    const r = await guest.post('/api/reports', { message: 'спам-попытка №'+i });
    lastStatus = r.status;
    if(lastStatus === 429) break;
  }
  assert.equal(lastStatus, 429);
});

test('админ видит список обращений, включая привязку к острову по имени', async ()=>{
  const admin = await loginAdmin();
  const r = await admin.get('/api/reports?all=1');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data));
  const withAllod = r.data.find(x=> x.allodId === allodId);
  assert.ok(withAllod, 'обращение с привязкой к острову должно быть в списке');
  assert.equal(withAllod.allodName, 'Остров для репортов');
});

test('фильтр по умолчанию (?all не указан) показывает только нерешённые', async ()=>{
  const admin = await loginAdmin();
  const r = await admin.get('/api/reports');
  assert.equal(r.status, 200);
  assert.ok(r.data.every(x=> x.resolved === false));
});

test('админ может отметить обращение решённым, и оно пропадает из списка открытых', async ()=>{
  const admin = await loginAdmin();
  const all = await admin.get('/api/reports?all=1');
  const target = all.data[0];
  const patchRes = await admin.patch('/api/reports/'+target.id, { resolved: true });
  assert.equal(patchRes.status, 200);
  const openOnly = await admin.get('/api/reports');
  assert.ok(!openOnly.data.find(x=> x.id === target.id));
});

test('админ может удалить обращение', async ()=>{
  const admin = await loginAdmin();
  const all = await admin.get('/api/reports?all=1');
  const before = all.data.length;
  const target = all.data[0];
  const delRes = await admin.del('/api/reports/'+target.id);
  assert.equal(delRes.status, 200);
  const after = await admin.get('/api/reports?all=1');
  assert.equal(after.data.length, before-1);
});
