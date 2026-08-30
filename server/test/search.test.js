// Тесты полнотекстового поиска (FTS5, routes/search.js): находит совпадения
// в description/history, не только в названии; безопасен на служебные
// FTS5-символы во вводе; синхронизация индекса через триггеры при
// создании/правке/удалении острова.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-search-'));
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
  const reg = await seedAdmin.post('/api/auth/register', { username:'searcheditor', password:'search-editor-pass1', role:'admin' });
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
  const r = await c.post('/api/auth/login', { username:'searcheditor', password:'search-editor-pass1' });
  assert.equal(r.status, 200);
  return c;
}

test('пустой запрос -> пустой массив, без 500', async ()=>{
  const c = makeClient();
  const r1 = await c.get('/api/search?q=');
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.data, []);
  const r2 = await c.get('/api/search');
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.data, []);
});

test('находит остров по слову внутри description, которого нет в названии', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/allods', { name: 'Совершенно другое имя' });
  await c.patch('/api/allods/' + created.data.id, { description: 'Здесь живут загадочные саламандры огня.' });

  const r = await c.get('/api/search?q=саламандры');
  assert.equal(r.status, 200);
  assert.ok(r.data.some(x => x.id === created.data.id));
  const hit = r.data.find(x => x.id === created.data.id);
  assert.equal(hit.name, 'Совершенно другое имя');
  assert.ok(hit.snippet.includes('саламандр'));
});

test('находит остров по слову в history', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/allods', { name: 'Остров для истории поиска' });
  await c.patch('/api/allods/' + created.data.id, { history: 'Когда-то здесь произошла легендарная битва грифонов.' });

  const r = await c.get('/api/search?q=грифонов');
  assert.ok(r.data.some(x => x.id === created.data.id));
});

test('префиксный поиск — незаконченное слово тоже находит', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/allods', { name: 'Остров для префиксного теста' });
  await c.patch('/api/allods/' + created.data.id, { description: 'Здесь растут гигантские мухоморы.' });

  const r = await c.get('/api/search?q=мухом');
  assert.ok(r.data.some(x => x.id === created.data.id));
});

test('служебные символы FTS5 во вводе не роняют запрос (400/500), просто ищут как текст', async ()=>{
  const c = makeClient();
  for(const q of ['"', '*', 'AND OR NOT', '((()))', 'слово" OR 1=1--', '   ']){
    const r = await c.get('/api/search?q=' + encodeURIComponent(q));
    assert.equal(r.status, 200, `запрос "${q}" не должен возвращать ошибку`);
    assert.ok(Array.isArray(r.data));
  }
});

test('удаление острова убирает его из результатов поиска (триггер allods_fts_ad)', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/allods', { name: 'Остров на удаление из поиска' });
  await c.patch('/api/allods/' + created.data.id, { description: 'Уникальнейшее-слово-для-теста-удаления.' });

  const before = await c.get('/api/search?q=уникальнейшее');
  assert.ok(before.data.some(x => x.id === created.data.id));

  await c.del('/api/allods/' + created.data.id);

  const after = await c.get('/api/search?q=уникальнейшее');
  assert.ok(!after.data.some(x => x.id === created.data.id));
});

test('правка description обновляет индекс (триггер allods_fts_au) — старое слово больше не находится, новое находится', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/allods', { name: 'Остров для теста обновления индекса' });
  await c.patch('/api/allods/' + created.data.id, { description: 'Старое-уникальное-слово-раз.' });
  const before = await c.get('/api/search?q=старое-уникальное-слово-раз');
  assert.ok(before.data.some(x => x.id === created.data.id));

  await c.patch('/api/allods/' + created.data.id, { description: 'Новое-уникальное-слово-два.' });

  const oldGone = await c.get('/api/search?q=старое-уникальное-слово-раз');
  assert.ok(!oldGone.data.some(x => x.id === created.data.id));
  const newFound = await c.get('/api/search?q=новое-уникальное-слово-два');
  assert.ok(newFound.data.some(x => x.id === created.data.id));
});

test('результат отсортирован по релевантности — совпадение в нескольких полях выше', async ()=>{
  const c = await loginClient();
  const weak = await c.post('/api/allods', { name: 'Слабое совпадение остров' });
  await c.patch('/api/allods/' + weak.data.id, { description: 'Тут иногда упоминается драконоящер один раз мельком.' });
  const strong = await c.post('/api/allods', { name: 'драконоящер' });
  await c.patch('/api/allods/' + strong.data.id, { description: 'драконоящер драконоящер драконоящер', history: 'драконоящер' });

  const r = await c.get('/api/search?q=драконоящер');
  const ids = r.data.map(x=>x.id);
  assert.ok(ids.indexOf(strong.data.id) < ids.indexOf(weak.data.id), 'более релевантный остров должен идти выше');
});
