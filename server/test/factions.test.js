// Тесты библиотеки иконок фракций (управляемая, не хардкод) — сопоставление
// по точному названию фракции (без учёта регистра).

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-factions-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';

const { createApp } = require('../app');

let server, baseUrl;
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
  'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082', 'hex');

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const c = makeClient();
  const reg = await c.post('/api/auth/register', { username:'factioneditor', password:'faction-editor-pass1' });
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
    if(body !== undefined){
      if(body instanceof FormData){ opts.body = body; }
      else{ opts.headers['Content-Type']='application/json'; opts.body = JSON.stringify(body); }
    }
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
  const r = await c.post('/api/auth/login', { username:'factioneditor', password:'faction-editor-pass1' });
  assert.equal(r.status, 200);
  return c;
}

test('стартовый набор иконок фракций засеян (8 штук) и виден без входа', async ()=>{
  const c = makeClient();
  const r = await c.get('/api/factions');
  assert.equal(r.status, 200);
  assert.equal(r.data.length, 8);
  assert.ok(r.data.every(f => f.icon_url.startsWith('/assets/factions/')));
  assert.ok(r.data.some(f => f.faction === 'Гиберлинги'));
  assert.ok(r.data.some(f => f.faction === 'Кания'));
});

test('добавление иконки фракции без входа -> 401', async ()=>{
  const c = makeClient();
  const fd = new FormData();
  fd.append('faction', 'Новая фракция');
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const r = await c.post('/api/factions', fd);
  assert.equal(r.status, 401);
});

test('добавление иконки без названия фракции отклоняется, файл не остаётся сиротой', async ()=>{
  const c = await loginClient();
  const { UPLOAD_DIR } = require('../upload');
  const before = fs.readdirSync(UPLOAD_DIR).length;
  const fd = new FormData();
  fd.append('faction', '   ');
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const r = await c.post('/api/factions', fd);
  assert.equal(r.status, 400);
  assert.equal(fs.readdirSync(UPLOAD_DIR).length, before);
});

test('добавление иконки для новой фракции — реально расширяет библиотеку, не хардкод', async ()=>{
  const c = await loginClient();
  const fd = new FormData();
  fd.append('faction', 'Империя');
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'empire.png');
  const r = await c.post('/api/factions', fd);
  assert.equal(r.status, 200);
  assert.equal(r.data.faction, 'Империя');
  assert.ok(r.data.icon_url.startsWith('/uploads/'));

  const list = await c.get('/api/factions');
  assert.equal(list.data.length, 9);
});

test('повторное добавление той же фракции (без учёта регистра) отклоняется -> 409', async ()=>{
  const c = await loginClient();
  const fd = new FormData();
  fd.append('faction', 'империя'); // тот же "Империя", другой регистр
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'dup.png');
  const r = await c.post('/api/factions', fd);
  assert.equal(r.status, 409);
});

test('замена картинки существующей записи через /factions/:id/icon', async ()=>{
  const c = await loginClient();
  const list = await c.get('/api/factions');
  const empire = list.data.find(f => f.faction === 'Империя');
  const { UPLOAD_DIR } = require('../upload');
  const oldPath = path.join(UPLOAD_DIR, path.basename(empire.icon_url));
  assert.ok(fs.existsSync(oldPath));

  const fd = new FormData();
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'empire-v2.png');
  const r = await c.post(`/api/factions/${empire.id}/icon`, fd);
  assert.equal(r.status, 200);
  assert.equal(r.data.faction, 'Империя'); // название не поменялось
  assert.notEqual(r.data.icon_url, empire.icon_url);
  assert.equal(fs.existsSync(oldPath), false, 'старая картинка должна быть удалена при замене');
});

test('удаление своей иконки убирает файл; штатная (fac_*) удаляется без затрагивания файла в assets', async ()=>{
  const c = await loginClient();
  const list = await c.get('/api/factions');
  const empire = list.data.find(f => f.faction === 'Империя');
  const { UPLOAD_DIR } = require('../upload');
  const filePath = path.join(UPLOAD_DIR, path.basename(empire.icon_url));
  assert.ok(fs.existsSync(filePath));

  const del = await c.del(`/api/factions/${empire.id}`);
  assert.equal(del.status, 200);
  assert.equal(fs.existsSync(filePath), false);

  const delStock = await c.del('/api/factions/fac_kania');
  assert.equal(delStock.status, 200);
  assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'public', 'assets', 'factions', 'kania.png')),
    'файл штатной иконки в public/assets НЕ должен удаляться с диска');
});

test('PATCH переименование: пустое имя отклоняется', async ()=>{
  const c = await loginClient();
  const fd = new FormData();
  fd.append('faction', 'E2E Тест Фракция А');
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'a.png');
  const created = await c.post('/api/factions', fd);
  const r = await c.patch(`/api/factions/${created.data.id}`, { faction: '   ' });
  assert.equal(r.status, 400);
});

test('PATCH переименование в уже занятое (регистронезависимо) имя -> 409', async ()=>{
  const c = await loginClient();
  const fdA = new FormData();
  fdA.append('faction', 'E2E Тест Фракция Б1');
  fdA.append('image', new Blob([PNG], { type: 'image/png' }), 'b1.png');
  const a = await c.post('/api/factions', fdA);

  const fdB = new FormData();
  fdB.append('faction', 'E2E Тест Фракция Б2');
  fdB.append('image', new Blob([PNG], { type: 'image/png' }), 'b2.png');
  const b = await c.post('/api/factions', fdB);

  const r = await c.patch(`/api/factions/${b.data.id}`, { faction: 'e2e тест фракция б1' }); // другой регистр занятого имени
  assert.equal(r.status, 409);
});

test('PATCH успешно переименовывает, картинка остаётся прежней', async ()=>{
  const c = await loginClient();
  const fd = new FormData();
  fd.append('faction', 'E2E Тест Фракция В (до)');
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'v.png');
  const created = await c.post('/api/factions', fd);

  const r = await c.patch(`/api/factions/${created.data.id}`, { faction: 'E2E Тест Фракция В (после)' });
  assert.equal(r.status, 200);
  assert.equal(r.data.faction, 'E2E Тест Фракция В (после)');
  assert.equal(r.data.icon_url, created.data.icon_url);
});

test('PATCH без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.patch('/api/factions/fac_kania', { faction: 'x' });
  assert.equal(r.status, 401);
});

test('PATCH несуществующей записи -> 404', async ()=>{
  const c = await loginClient();
  const r = await c.patch('/api/factions/does-not-exist', { faction: 'x' });
  assert.equal(r.status, 404);
});

test('удаление несуществующей записи -> 404', async ()=>{
  const c = await loginClient();
  const r = await c.del('/api/factions/does-not-exist');
  assert.equal(r.status, 404);
});
