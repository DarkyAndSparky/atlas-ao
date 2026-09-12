// Optimistic locking по rev (roadmap #8): PATCH /api/allods/:id с
// expectedRev должен отдавать 409 при устаревшем rev, и обновлять rev при
// успехе. Отдельно — конкретно поля mapX/mapY (перетаскивание маркера на
// карте), которые раньше сохранялись вообще без expectedRev на фронтенде
// (см. mapView.js) — сервер эту проверку всегда поддерживал корректно,
// пробел был только в том, какие вызовы фронтенда её используют.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-revlock-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';
process.env.ATLAS_ALLOW_HTTP = '1'; // secure-куки по умолчанию (roadmap #9) ломают set-cookie на обычном HTTP, каким тут гоняют тесты

const { createApp } = require('../app');

let server, baseUrl, c;

function readBootstrapPassword(){
  const content = fs.readFileSync(path.join(TEST_DIR, '.bootstrap-password'), 'utf-8');
  const m = content.match(/admin \/ (\S+)/);
  if(!m) throw new Error('Не удалось распарсить .bootstrap-password: '+content);
  return m[1];
}

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => setTimeout(resolve, 200)); // .bootstrap-password пишется чуть после старта
  c = makeClient();
  const login = await c.post('/api/auth/login', { username: 'admin', password: readBootstrapPassword() });
  if(login.status !== 200) throw new Error('Не удалось войти дефолтным admin в тесте: ' + login.status);
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

test('PATCH без expectedRev проходит как раньше (обратная совместимость)', async ()=>{
  const created = await c.post('/api/allods', { name: 'Остров без rev-проверки' });
  assert.equal(created.status, 200);
  const r = await c.patch(`/api/allods/${created.data.id}`, { description: 'правка без expectedRev' });
  assert.equal(r.status, 200);
});

test('PATCH с верным expectedRev проходит и увеличивает rev', async ()=>{
  const created = await c.post('/api/allods', { name: 'Остров с верным rev' });
  const revBefore = created.data.rev;
  const r = await c.patch(`/api/allods/${created.data.id}`, { description: 'first edit', expectedRev: revBefore });
  assert.equal(r.status, 200);
  assert.ok(r.data.rev > revBefore, 'rev должен увеличиться после успешного PATCH');
});

test('PATCH с устаревшим expectedRev -> 409, отдаёт актуальные данные', async ()=>{
  const created = await c.post('/api/allods', { name: 'Остров для конфликта' });
  const staleRev = created.data.rev;

  // "другой редактор" меняет остров первым
  const other = await c.patch(`/api/allods/${created.data.id}`, { description: 'кто-то другой успел раньше', expectedRev: staleRev });
  assert.equal(other.status, 200);

  // наша правка всё ещё думает, что rev — старый
  const conflict = await c.patch(`/api/allods/${created.data.id}`, { description: 'наша устаревшая правка', expectedRev: staleRev });
  assert.equal(conflict.status, 409);
  assert.ok(conflict.data.current, 'при 409 должны вернуться актуальные данные для отката UI');
  assert.equal(conflict.data.current.description, 'кто-то другой успел раньше');
});

test('mapX/mapY (перетаскивание на карте) тоже защищены expectedRev, а не только текстовые поля', async ()=>{
  const created = await c.post('/api/allods', { name: 'Остров для перетаскивания' });
  const staleRev = created.data.rev;

  const first = await c.patch(`/api/allods/${created.data.id}`, { mapX: 100, mapY: 200, expectedRev: staleRev });
  assert.equal(first.status, 200);

  // второй "игрок" тащит тот же маркер параллельно, опираясь на устаревший rev
  const conflict = await c.patch(`/api/allods/${created.data.id}`, { mapX: 999, mapY: 999, expectedRev: staleRev });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.current.mapX, 100);
  assert.equal(conflict.data.current.mapY, 200);
});

test('локации: expectedRev на PATCH локации тоже работает', async ()=>{
  const created = await c.post('/api/allods', { name: 'Остров с локацией' });
  const loc = await c.post(`/api/allods/${created.data.id}/locations`, { name: 'Точка на острове' });
  assert.equal(loc.status, 200);
  const locId = loc.data.locations[loc.data.locations.length-1].id;
  const staleLocRev = loc.data.locations[loc.data.locations.length-1].rev || 0;

  const ok = await c.patch(`/api/locations/${locId}`, { name: 'Переименовано', expectedRev: staleLocRev });
  assert.equal(ok.status, 200);

  const conflict = await c.patch(`/api/locations/${locId}`, { name: 'Опять переименовано', expectedRev: staleLocRev });
  assert.equal(conflict.status, 409);
});
