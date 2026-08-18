// Тесты данных API: острова, локации, галерея, импорт/экспорт, бэкап.
// Один тестовый аккаунт создаётся один раз в before() и переиспользуется —
// в системе всего один аккаунт редактора, повторная регистрация невозможна.
// Своя изолированная БД/папки — реальные данные проекта не трогает.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-data-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';

const { createApp } = require('../app');

let server, baseUrl;
const TEST_USERNAME = 'data-test-editor';
const TEST_PASSWORD = 'the-one-and-only-test-password';

function makeClient(){
  let cookie = '';
  async function request(method, path, body){
    const opts = { method, headers: {} };
    if(cookie) opts.headers['Cookie'] = cookie;
    if(body !== undefined){
      if(body instanceof FormData){
        opts.body = body;
      }else{
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(baseUrl + path, opts);
    const setCookie = res.headers.get('set-cookie');
    if(setCookie) cookie = setCookie.split(';')[0];
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if(ct.includes('application/json')) data = await res.json().catch(()=>null);
    return { status: res.status, data, res };
  }
  return {
    get: p=>request('GET',p),
    post: (p,b)=>request('POST',p,b),
    patch: (p,b)=>request('PATCH',p,b),
    del: p=>request('DELETE',p),
    getRaw: async p=>{ const res = await fetch(baseUrl + p); return res.text(); },
  };
}

// клиент, уже вошедший под единственным тестовым аккаунтом редактора
async function loginClient(){
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username: TEST_USERNAME, password: TEST_PASSWORD });
  assert.equal(r.status, 200, 'логин тестовым паролем должен проходить');
  return c;
}

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  // с седированным дефолтным admin/admin0000 (см. db.js) на свежей БД уже
  // есть аккаунт — регистрация нового тестового пользователя теперь требует
  // прав admin, а не открытого bootstrap-режима "первый аккаунт на сервере".
  // Этому файлу конкретно нужна роль admin — тесты дёргают /settings,
  // /backup, /import (все admin-only).
  const seedAdmin = makeClient();
  await seedAdmin.post('/api/auth/login', { username:'admin', password:'admin0000' });
  const reg = await seedAdmin.post('/api/auth/register', { username: TEST_USERNAME, password: TEST_PASSWORD, role:'admin' });
  assert.equal(reg.status, 200);
});

after(async ()=>{
  await new Promise(resolve => server.close(resolve));
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/* ================= СТАТИКА ================= */
test('отдаёт index.html и статику', async ()=>{
  const c = makeClient();
  assert.equal((await c.get('/')).status, 200);
  assert.equal((await c.get('/style.css')).status, 200);
  assert.equal((await c.get('/js/main.js')).status, 200);
  assert.equal((await c.get('/js/wikiView.js')).status, 200);
  assert.equal((await c.get('/js/projects.js')).status, 200);
});

/* ================= ALLODS: чтение ================= */
test('GET /api/allods отдаёт список из 318 засеянных островов', async ()=>{
  const c = makeClient();
  const r = await c.get('/api/allods');
  assert.equal(r.status, 200);
  assert.equal(r.data.length, 318);
  const first = r.data[0];
  assert.ok('id' in first && 'name' in first && 'locations' in first && 'gallery' in first);
  assert.equal(first.project, 'Аллоды Онлайн', 'все острова по умолчанию в проекте "Аллоды Онлайн"');
});

test('GET /api/allods/:id отдаёт один остров, 404 для несуществующего', async ()=>{
  const c = makeClient();
  const ok = await c.get('/api/allods/a001');
  assert.equal(ok.status, 200);
  assert.equal(ok.data.id, 'a001');
  const missing = await c.get('/api/allods/does-not-exist');
  assert.equal(missing.status, 404);
});

/* ================= ALLODS: правка ================= */
test('PATCH без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.patch('/api/allods/a001', { description: 'hack attempt' });
  assert.equal(r.status, 401);
});

test('PATCH с входом сохраняет поля и реально пишется в БД', async ()=>{
  const c = await loginClient();
  const r = await c.patch('/api/allods/a001', {
    description: 'Тестовое описание', history: 'Тестовая история',
    mapX: 123.5, mapY: 456.25,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.description, 'Тестовое описание');
  assert.equal(r.data.mapX, 123.5);

  const fresh = await c.get('/api/allods/a001');
  assert.equal(fresh.data.description, 'Тестовое описание');
  assert.equal(fresh.data.history, 'Тестовая история');
});

test('PATCH несуществующего острова -> 404', async ()=>{
  const c = await loginClient();
  const r = await c.patch('/api/allods/does-not-exist', { description: 'x' });
  assert.equal(r.status, 404);
});

test('project можно переназначить и это фильтрует остров в другой раздел', async ()=>{
  const c = await loginClient();
  const before = await c.get('/api/allods/a002');
  assert.equal(before.data.project, 'Аллоды Онлайн');
  const patched = await c.patch('/api/allods/a002', { project: 'Пираты Штурм Небес' });
  assert.equal(patched.data.project, 'Пираты Штурм Небес');
});

test('icon_url и location_map_url можно задать и очистить', async ()=>{
  const c = await loginClient();
  const set = await c.patch('/api/allods/a006', { icon_url: 'https://example.com/icon.png', hasMap: true, location_map_url: 'https://example.com/map.jpg' });
  assert.equal(set.data.icon_url, 'https://example.com/icon.png');
  assert.equal(set.data.hasMap, true);
  const cleared = await c.patch('/api/allods/a006', { icon_url: null });
  assert.equal(cleared.data.icon_url, null);
});

test('создание острова без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.post('/api/allods', { name: 'Новый остров' });
  assert.equal(r.status, 401);
});

test('создание острова без названия -> 400', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/allods', { name: '  ' });
  assert.equal(r.status, 400);
});

test('создание острова с входом добавляет его в список', async ()=>{
  const c = await loginClient();
  const before = await c.get('/api/allods');
  const created = await c.post('/api/allods', { name: 'Плавучий Тестовый Остров', project: 'Пираты Штурм Небес' });
  assert.equal(created.status, 200);
  assert.equal(created.data.name, 'Плавучий Тестовый Остров');
  assert.equal(created.data.project, 'Пираты Штурм Небес');
  assert.equal(created.data.mapX, null); // новый остров не размещён на карте
  assert.deepEqual(created.data.locations, []);
  const after = await c.get('/api/allods');
  assert.equal(after.data.length, before.data.length + 1);
  await c.del(`/api/allods/${created.data.id}`); // не оставляем след в общей базе — на неё завязаны другие тесты
});

test('PATCH острова с пустым названием отклоняется, старое название сохраняется', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/allods', { name: 'Остров С Именем' });
  const id = created.data.id;

  const bad = await c.patch(`/api/allods/${id}`, { name: '   ' });
  assert.equal(bad.status, 400);

  const check = await c.get(`/api/allods/${id}`);
  assert.equal(check.data.name, 'Остров С Именем', 'название не должно было измениться на пустое');

  await c.del(`/api/allods/${id}`);
});

test('PATCH острова обрезает пробелы по краям названия', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/allods', { name: 'Остров' });
  const id = created.data.id;

  const r = await c.patch(`/api/allods/${id}`, { name: '  Новое Имя  ' });
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'Новое Имя');

  await c.del(`/api/allods/${id}`);
});

test('PATCH локации с пустым названием отклоняется', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/allods', { name: 'Остров С Локацией' });
  const id = created.data.id;
  const withLoc = await c.post(`/api/allods/${id}/locations`, { name: 'Локация' });
  const locId = withLoc.data.locations[0].id;

  const bad = await c.patch(`/api/locations/${locId}`, { name: '' });
  assert.equal(bad.status, 400);

  const check = await c.get(`/api/allods/${id}`);
  assert.equal(check.data.locations[0].name, 'Локация');

  await c.del(`/api/allods/${id}`);
});

test('удаление острова чистит файлы icon_url и location_map_url, не только галерею (регрессия)', async ()=>{
  const c = await loginClient();
  const { UPLOAD_DIR } = require('../upload');
  const created = await c.post('/api/allods', { name: 'Остров Со Своими Файлами' });
  const id = created.data.id;

  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082',
    'hex'
  );
  const fdIcon = new FormData();
  fdIcon.append('image', new Blob([validPng], { type: 'image/png' }), 'icon.png');
  const icon = await c.post(`/api/allods/${id}/icon`, fdIcon);
  const iconPath = path.join(UPLOAD_DIR, path.basename(icon.data.icon_url));

  const fdMap = new FormData();
  fdMap.append('image', new Blob([validPng], { type: 'image/png' }), 'locmap.png');
  const locmap = await c.post(`/api/allods/${id}/location-map`, fdMap);
  const locmapPath = path.join(UPLOAD_DIR, path.basename(locmap.data.location_map_url));

  assert.ok(fs.existsSync(iconPath));
  assert.ok(fs.existsSync(locmapPath));

  await c.del(`/api/allods/${id}`);

  assert.equal(fs.existsSync(iconPath), false, 'файл иконки должен удалиться вместе с островом');
  assert.equal(fs.existsSync(locmapPath), false, 'файл карты локаций должен удалиться вместе с островом');
});

test('удаление острова без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.del('/api/allods/a004');
  assert.equal(r.status, 401);
});

test('удаление несуществующего острова -> 404', async ()=>{
  const c = await loginClient();
  const r = await c.del('/api/allods/does-not-exist');
  assert.equal(r.status, 404);
});

test('удаление острова убирает его вместе с локациями и галереей', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/allods', { name: 'Остров на снос' });
  const id = created.data.id;
  const loc = await c.post(`/api/allods/${id}/locations`, { name: 'Локация' });
  const locId = loc.data.locations[0].id;
  await c.post('/api/gallery', { ownerType: 'allod', ownerId: id, url: 'https://example.com/a.png' });
  await c.post('/api/gallery', { ownerType: 'location', ownerId: locId, url: 'https://example.com/b.png' });

  const del = await c.del(`/api/allods/${id}`);
  assert.equal(del.status, 200);
  assert.equal(del.data.ok, true);

  const check = await c.get(`/api/allods/${id}`);
  assert.equal(check.status, 404);
});

/* ================= LOCATIONS ================= */
test('локации без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.post('/api/allods/a003/locations', { name: 'X' });
  assert.equal(r.status, 401);
});

test('создание, правка, сортировка и удаление локаций острова', async ()=>{
  const c = await loginClient();

  const add1 = await c.post('/api/allods/a003/locations', { name: 'Локация A' });
  assert.equal(add1.status, 200);
  assert.equal(add1.data.locations.length, 1);

  const add2 = await c.post('/api/allods/a003/locations', { name: 'Локация B' });
  assert.equal(add2.data.locations.length, 2);
  const [locA, locB] = add2.data.locations;

  const patched = await c.patch(`/api/locations/${locA.id}`, { description: 'Описание А' });
  const patchedLoc = patched.data.locations.find(l=>l.id===locA.id);
  assert.equal(patchedLoc.description, 'Описание А');

  const badAdd = await c.post('/api/allods/a003/locations', { name: '' });
  assert.equal(badAdd.status, 400);

  const reordered = await c.post('/api/allods/a003/locations/reorder', { order: [locB.id, locA.id] });
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.data.locations.map(l=>l.id), [locB.id, locA.id]);

  const withMapPos = await c.patch(`/api/locations/${locA.id}`, {}); // no-op patch still returns full allod
  assert.equal(withMapPos.status, 200);

  const del = await c.del(`/api/locations/${locA.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.data.locations.length, 1);
  assert.equal(del.data.locations[0].id, locB.id);
});

test('локация на несуществующем острове -> 404', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/allods/does-not-exist/locations', { name: 'X' });
  assert.equal(r.status, 404);
});

/* ================= GALLERY ================= */
test('добавление, подпись и удаление картинки по ссылке', async ()=>{
  const c = await loginClient();

  const add = await c.post('/api/gallery', { ownerType:'allod', ownerId:'a004', url:'https://example.com/pic.jpg' });
  assert.equal(add.status, 200);
  assert.equal(add.data.caption, '');

  const withCaption = await c.patch(`/api/gallery/${add.data.id}`, { caption: 'Подпись к фото' });
  assert.equal(withCaption.data.caption, 'Подпись к фото');

  const fresh = await c.get('/api/allods/a004');
  assert.equal(fresh.data.gallery.length, 1);
  assert.equal(fresh.data.gallery[0].caption, 'Подпись к фото');

  const del = await c.del(`/api/gallery/${add.data.id}`);
  assert.equal(del.status, 200);
  const fresh2 = await c.get('/api/allods/a004');
  assert.equal(fresh2.data.gallery.length, 0);
});

test('некорректный ownerType в галерее отклоняется', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/gallery', { ownerType:'not-a-real-type', ownerId:'a004', url:'https://x.com/1.jpg' });
  assert.equal(r.status, 400);
});

test('загрузка файла: валидный PNG проходит, подделка отклоняется', async ()=>{
  const c = await loginClient();

  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082',
    'hex'
  );
  const fd1 = new FormData();
  fd1.append('ownerType', 'allod');
  fd1.append('ownerId', 'a005');
  fd1.append('image', new Blob([validPng], { type: 'image/png' }), 'test.png');
  const okUpload = await c.post('/api/gallery/upload', fd1);
  assert.equal(okUpload.status, 200);
  assert.ok(okUpload.data.url.startsWith('/uploads/'));

  const fakePng = Buffer.from('это не картинка, а обычный текст');
  const fd2 = new FormData();
  fd2.append('ownerType', 'allod');
  fd2.append('ownerId', 'a005');
  fd2.append('image', new Blob([fakePng], { type: 'image/png' }), 'fake.png');
  const badUpload = await c.post('/api/gallery/upload', fd2);
  assert.equal(badUpload.status, 400);
});

test('загрузка SVG вырезает <script> и обработчики on*', async ()=>{
  const c = await loginClient();
  const evilSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><circle cx="5" cy="5" r="4"/></svg>'
  );
  const fd = new FormData();
  fd.append('ownerType', 'allod');
  fd.append('ownerId', 'a005');
  fd.append('image', new Blob([evilSvg], { type: 'image/svg+xml' }), 'evil.svg');
  const uploaded = await c.post('/api/gallery/upload', fd);
  assert.equal(uploaded.status, 200);

  const stored = await c.getRaw(uploaded.data.url);
  assert.ok(!stored.includes('<script'), 'script-тег должен быть вырезан');
  assert.ok(!stored.includes('onload'), 'обработчик onload должен быть вырезан');
  assert.ok(stored.includes('<circle'), 'безопасное содержимое SVG должно остаться');
});

test('загрузка иконки острова не создаёт лишнюю запись в галерее (регрессия)', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/allods', { name: 'Остров Для Иконки' });
  const id = created.data.id;
  assert.equal(created.data.gallery.length, 0);

  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082',
    'hex'
  );
  const fd = new FormData();
  fd.append('image', new Blob([validPng], { type: 'image/png' }), 'icon.png');
  const r = await c.post(`/api/allods/${id}/icon`, fd);
  assert.equal(r.status, 200);
  assert.ok(r.data.icon_url, 'icon_url должен быть выставлен');
  // раньше загрузка иконки шла через /gallery/upload и попадала в обычную
  // галерею острова — теперь у него всё ещё должно быть 0 фото в галерее
  assert.equal(r.data.gallery.length, 0, 'иконка не должна дублироваться как фото в галерее');

  await c.del(`/api/allods/${id}`);
});

test('замена иконки острова удаляет старый файл с диска (регрессия)', async ()=>{
  const c = await loginClient();
  const { UPLOAD_DIR } = require('../upload');
  const created = await c.post('/api/allods', { name: 'Остров Для Смены Иконки' });
  const id = created.data.id;

  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082',
    'hex'
  );
  const fd1 = new FormData();
  fd1.append('image', new Blob([validPng], { type: 'image/png' }), 'icon1.png');
  const first = await c.post(`/api/allods/${id}/icon`, fd1);
  const firstPath = path.join(UPLOAD_DIR, path.basename(first.data.icon_url));
  assert.ok(fs.existsSync(firstPath), 'первая иконка должна реально появиться на диске');

  const fd2 = new FormData();
  fd2.append('image', new Blob([validPng], { type: 'image/png' }), 'icon2.png');
  const second = await c.post(`/api/allods/${id}/icon`, fd2);
  assert.equal(second.status, 200);
  assert.notEqual(second.data.icon_url, first.data.icon_url);
  assert.equal(fs.existsSync(firstPath), false, 'старый файл иконки должен быть удалён при замене');

  // и очистка (сброс на заготовку) через обычный PATCH тоже должна подчищать файл
  const secondPath = path.join(UPLOAD_DIR, path.basename(second.data.icon_url));
  await c.patch(`/api/allods/${id}`, { icon_url: null });
  assert.equal(fs.existsSync(secondPath), false, 'файл иконки должен удалиться при сбросе на заготовку через PATCH');

  await c.del(`/api/allods/${id}`);
});

test('загрузка карты локаций острова не создаёт лишнюю запись в галерее', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/allods', { name: 'Остров Для Карты Локаций' });
  const id = created.data.id;

  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082',
    'hex'
  );
  const fd = new FormData();
  fd.append('image', new Blob([validPng], { type: 'image/png' }), 'locmap.png');
  const r = await c.post(`/api/allods/${id}/location-map`, fd);
  assert.equal(r.status, 200);
  assert.ok(r.data.location_map_url);
  assert.equal(r.data.gallery.length, 0);

  await c.del(`/api/allods/${id}`);
});

test('загрузка с некорректным owner всё равно не оставляет файл-сироту на диске', async ()=>{
  const c = await loginClient();
  const { UPLOAD_DIR } = require('../upload');
  const before = fs.readdirSync(UPLOAD_DIR).length;

  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082',
    'hex'
  );
  const fd = new FormData();
  fd.append('ownerType', 'не-существующий-тип');
  fd.append('ownerId', 'a005');
  fd.append('image', new Blob([validPng], { type: 'image/png' }), 'orphan-test.png');
  const r = await c.post('/api/gallery/upload', fd);
  assert.equal(r.status, 400);

  const after = fs.readdirSync(UPLOAD_DIR).length;
  assert.equal(after, before, 'файл не должен был остаться в uploads/ после отклонённой загрузки');
});

test('удаление картинки без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.del('/api/gallery/1');
  assert.equal(r.status, 401);
});

/* ================= BACKUP: скачивание целиком (до импорта, который меняет данные) ================= */
test('скачивание бэкапа требует авторизации и отдаёт настоящий файл SQLite', async ()=>{
  const anon = makeClient();
  assert.equal((await anon.get('/api/backup/download')).status, 401);

  const c = await loginClient();
  const r = await c.get('/api/backup/download');
  assert.equal(r.status, 200);
  const buf = await r.res.arrayBuffer();
  assert.ok(buf.byteLength > 1000, 'файл бэкапа не должен быть пустым/крошечным');
  const header = Buffer.from(buf.slice(0,16)).toString('utf-8');
  assert.ok(header.startsWith('SQLite format 3'));
});

/* ================= SITE SETTINGS (название/логотип/акцент) ================= */
test('настройки сайта: дефолты доступны без входа', async ()=>{
  const c = makeClient();
  const r = await c.get('/api/settings');
  assert.equal(r.status, 200);
  assert.equal(r.data.title, 'Атлас Аллодов');
  assert.match(r.data.accent_light, /^#[0-9a-f]{6}$/i);
  assert.match(r.data.accent_dark, /^#[0-9a-f]{6}$/i);
});

test('PATCH настроек без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.patch('/api/settings', { title: 'Хак' });
  assert.equal(r.status, 401);
});

test('PATCH настроек с входом меняет название и цвета', async ()=>{
  const c = await loginClient();
  const r = await c.patch('/api/settings', { title: 'Мой Атлас', accent_light: '#112233', accent_dark: '#aabbcc' });
  assert.equal(r.status, 200);
  assert.equal(r.data.title, 'Мой Атлас');
  assert.equal(r.data.accent_light, '#112233');
  assert.equal(r.data.accent_dark, '#aabbcc');

  const fresh = await c.get('/api/settings');
  assert.equal(fresh.data.title, 'Мой Атлас');
});

test('пустое название и некорректный цвет отклоняются', async ()=>{
  const c = await loginClient();
  const emptyTitle = await c.patch('/api/settings', { title: '   ' });
  assert.equal(emptyTitle.status, 400);
  const badColor = await c.patch('/api/settings', { accent_light: 'not-a-color' });
  assert.equal(badColor.status, 400);
});

test('загрузка и удаление логотипа', async ()=>{
  const c = await loginClient();
  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082',
    'hex'
  );
  const fd = new FormData();
  fd.append('logo', new Blob([validPng], { type: 'image/png' }), 'logo.png');
  const upload = await c.post('/api/settings/logo', fd);
  assert.equal(upload.status, 200);
  assert.ok(upload.data.logo_url.startsWith('/uploads/'));

  const fresh = await c.get('/api/settings');
  assert.equal(fresh.data.logo_url, upload.data.logo_url);

  const removed = await c.del('/api/settings/logo');
  assert.equal(removed.status, 200);
  assert.equal(removed.data.logo_url, null);
});

/* ================= IMPORT / EXPORT (идут последними — меняют всю базу) ================= */
test('экспорт отдаёт JSON-массив всех островов без авторизации', async ()=>{
  const c = makeClient();
  const r = await c.get('/api/export');
  assert.equal(r.status, 200);
  assert.equal(r.data.length, 318);
});

test('импорт требует авторизации', async ()=>{
  const anon = makeClient();
  const r = await anon.post('/api/import', [{ id:'x1', name:'Тест' }]);
  assert.equal(r.status, 401);
});

test('импорт заменяет содержимое базы полностью', async ()=>{
  const c = await loginClient();
  const customData = [{
    id: 'custom1', name: 'Кастомный остров', slug: 'custom-1', climate: 'Умеренный',
    size: 'Малый аллод', holder: null, faction: null, hasMap: false, type: null,
    category: null, plot: null, expansion: null, archipelago: null,
    description: 'd', history: 'h', mapX: 10, mapY: 20, project: 'Аллоды Онлайн',
    locations: [], gallery: []
  }];
  const imp = await c.post('/api/import', customData);
  assert.equal(imp.status, 200);
  assert.equal(imp.data.count, 1);

  const list = await c.get('/api/allods');
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].id, 'custom1');
  assert.equal(list.data[0].name, 'Кастомный остров');
});

test('импорт острова без id/name отклоняется с понятной ошибкой (не 500)', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/import', [{ name: 'Без id' }]);
  assert.equal(r.status, 400);
  assert.ok(r.data.error);
});

test('импорт острова с необязательными полями, которых просто нет в JSON, не падает', async ()=>{
  const c = await loginClient();
  // сознательно НЕ указываем climate/size/holder/faction/type/... — раньше это
  // приводило к undefined-параметрам и 500 от node:sqlite
  const r = await c.post('/api/import', [{
    id: 'minimal-1', name: 'Минимальный остров', locations: [{ id: 'loc-1', name: 'Локация' }],
  }]);
  assert.equal(r.status, 200);
  const list = await c.get('/api/allods');
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].locations.length, 1);
});

test('импорт подчищает файлы в uploads/, на которые новые данные больше не ссылаются', async ()=>{
  const c = await loginClient();
  const { UPLOAD_DIR } = require('../upload');

  // сначала реально загружаем файл в галерею острова, оставшегося от предыдущего теста
  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
    'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082',
    'hex'
  );
  const fd = new FormData();
  fd.append('ownerType', 'allod');
  fd.append('ownerId', 'minimal-1');
  fd.append('image', new Blob([validPng], { type: 'image/png' }), 'will-be-orphaned.png');
  const uploaded = await c.post('/api/gallery/upload', fd);
  assert.equal(uploaded.status, 200);
  const uploadedPath = path.join(UPLOAD_DIR, path.basename(uploaded.data.url));
  assert.ok(fs.existsSync(uploadedPath), 'файл должен реально появиться на диске после загрузки');

  // импортируем данные, где этого острова (и файла) больше нет вообще
  const imp = await c.post('/api/import', [{
    id: 'other-island', name: 'Другой остров', description: '', history: '',
    project: 'Аллоды Онлайн', locations: [], gallery: [],
  }]);
  assert.equal(imp.status, 200);
  assert.equal(imp.data.cleanedFiles, 1, 'ровно один осиротевший файл должен был подчиститься');
  assert.equal(fs.existsSync(uploadedPath), false, 'файл должен быть физически удалён с диска');
});
