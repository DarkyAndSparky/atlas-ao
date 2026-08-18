// Тесты библиотеки украшений (декоративных иконок для слоя рисования на карте)
// и типа пометки "icon", который на них ссылается.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-decorations-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';

const { createApp } = require('../app');

let server, baseUrl;

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  // с седированным дефолтным admin/admin0000 (см. db.js) на свежей БД уже
  // есть аккаунт — регистрация нового тестового пользователя теперь требует
  // прав admin, а не открытого bootstrap-режима "первый аккаунт на сервере"
  const seedAdmin = makeClient();
  await seedAdmin.post('/api/auth/login', { username:'admin', password:'admin0000' });
  const reg = await seedAdmin.post('/api/auth/register', { username:'decoeditor', password:'decoeditor-pass1', role:'admin' });
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
  return { get:p=>request('GET',p), post:(p,b)=>request('POST',p,b), del:p=>request('DELETE',p) };
}
async function loginClient(){
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username:'decoeditor', password:'decoeditor-pass1' });
  assert.equal(r.status, 200);
  return c;
}

test('стартовый набор украшений засеян автоматически (10 штук) и виден без входа', async ()=>{
  const c = makeClient();
  const r = await c.get('/api/decorations');
  assert.equal(r.status, 200);
  assert.equal(r.data.length, 10);
  assert.ok(r.data.every(d => d.url.startsWith('/assets/decorations/')));
  assert.ok(r.data.some(d => d.name.includes('Астрал')));
});

test('добавление украшения без входа -> 401', async ()=>{
  const c = makeClient();
  const fd = new FormData();
  fd.append('name', 'Тест');
  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082', 'hex');
  fd.append('image', new Blob([validPng], { type: 'image/png' }), 'x.png');
  const r = await c.post('/api/decorations', fd);
  assert.equal(r.status, 401);
});

test('добавление украшения без названия отклоняется и не оставляет файл-сироту', async ()=>{
  const c = await loginClient();
  const { UPLOAD_DIR } = require('../upload');
  const before = fs.readdirSync(UPLOAD_DIR).length;
  const fd = new FormData();
  fd.append('name', '   ');
  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082', 'hex');
  fd.append('image', new Blob([validPng], { type: 'image/png' }), 'x.png');
  const r = await c.post('/api/decorations', fd);
  assert.equal(r.status, 400);
  assert.equal(fs.readdirSync(UPLOAD_DIR).length, before);
});

test('добавление своего украшения через настройки — не хардкод, реально расширяет библиотеку', async ()=>{
  const c = await loginClient();
  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082', 'hex');
  const fd = new FormData();
  fd.append('name', 'Мой самодельный маркер');
  fd.append('image', new Blob([validPng], { type: 'image/png' }), 'custom.png');
  const r = await c.post('/api/decorations', fd);
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'Мой самодельный маркер');
  assert.ok(r.data.url.startsWith('/uploads/'), 'загруженное украшение должно жить в uploads/, а не в bundled-ассетах');

  const list = await c.get('/api/decorations');
  assert.equal(list.data.length, 11);
});

test('удаление своего украшения убирает файл с диска; штатное (dec_*) удаляется, но файл не трогается', async ()=>{
  const c = await loginClient();
  const { UPLOAD_DIR } = require('../upload');
  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082', 'hex');
  const fd = new FormData();
  fd.append('name', 'Удалю меня');
  fd.append('image', new Blob([validPng], { type: 'image/png' }), 'del.png');
  const created = await c.post('/api/decorations', fd);
  const filePath = path.join(UPLOAD_DIR, path.basename(created.data.url));
  assert.ok(fs.existsSync(filePath));

  const del = await c.del('/api/decorations/'+created.data.id);
  assert.equal(del.status, 200);
  assert.equal(fs.existsSync(filePath), false);

  const list = await c.get('/api/decorations');
  const stock = list.data.find(d => d.id === 'dec_astral');
  assert.ok(stock, 'штатное украшение должно быть на месте');
  const delStock = await c.del('/api/decorations/dec_astral');
  assert.equal(delStock.status, 200); // разрешаем убрать из библиотеки, если не нужно
  assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'public', 'assets', 'decorations', 'astral.png')),
    'файл штатного украшения в public/assets НЕ должен удаляться с диска');
});

test('удаление несуществующего украшения -> 404', async ()=>{
  const c = await loginClient();
  const r = await c.del('/api/decorations/does-not-exist');
  assert.equal(r.status, 404);
});

test('пометка типа icon: неизвестный iconUrl отклоняется', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/annotations', {
    project: 'Аллоды Онлайн', type:'icon', x1:100, y1:100,
    iconUrl: 'https://evil.example.com/tracker.png',
  });
  assert.equal(r.status, 400);
});

test('пометка типа icon с известным iconUrl создаётся и попадает в список', async ()=>{
  const c = await loginClient();
  const decos = await c.get('/api/decorations');
  const wreckage = decos.data.find(d => d.id === 'dec_wreckage');
  const r = await c.post('/api/annotations', {
    project: 'Аллоды Онлайн', type:'icon', x1:150, y1:250, iconUrl: wreckage.url, r: 40,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.type, 'icon');
  assert.equal(r.data.iconUrl, wreckage.url);
  assert.equal(r.data.r, 40);

  const list = await c.get('/api/annotations?project=' + encodeURIComponent('Аллоды Онлайн'));
  assert.ok(list.data.some(a => a.id === r.data.id));
});

test('размер иконки (r) ограничивается разумными пределами', async ()=>{
  const c = await loginClient();
  const decos = await c.get('/api/decorations');
  const icon = decos.data[0];
  const tooSmall = await c.post('/api/annotations', { project: 'Аллоды Онлайн', type:'icon', x1:0, y1:0, iconUrl: icon.url, r: 1 });
  assert.equal(tooSmall.data.r, 12); // зажато снизу
  const tooBig = await c.post('/api/annotations', { project: 'Аллоды Онлайн', type:'icon', x1:0, y1:0, iconUrl: icon.url, r: 9999 });
  assert.equal(tooBig.data.r, 200); // зажато сверху
});
