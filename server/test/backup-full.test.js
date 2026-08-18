// Проверяет полный архив сайта (/backup/download-full и /backup/restore-full):
// база И загруженные файлы одним .zip, а не только .db, как в обычном
// /backup/download. Каждый успешный restore-full закрывает соединение с БД
// (см. routes/backup.js) — как и в проде, после него нужен "перезапуск"
// (freshApp()) прежде, чем делать что-то ещё; поэтому оба успешных restore
// в этом файле идут последними и каждый сразу сопровождается своим
// перезапуском, а не выполняются подряд на одном живом соединении.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-full-restore-'));
const DB_PATH = path.join(TEST_DIR, 'test.db');
const UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_DB_PATH = DB_PATH;
process.env.ATLAS_UPLOAD_DIR = UPLOAD_DIR;
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';
process.env.ATLAS_TEST_NO_EXIT = '1';

const { createApp } = require('../app');

function makeClient(base){
  let cookie = '';
  async function request(method, p, body){
    const opts = { method, headers: {} };
    if(cookie) opts.headers['Cookie'] = cookie;
    if(body !== undefined){
      if(body instanceof FormData){ opts.body = body; }
      else{ opts.headers['Content-Type']='application/json'; opts.body = JSON.stringify(body); }
    }
    const res = await fetch(base + p, opts);
    const setCookie = res.headers.get('set-cookie');
    if(setCookie) cookie = setCookie.split(';')[0];
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if(ct.includes('application/json')) data = await res.json().catch(()=>null);
    return { status: res.status, data, res };
  }
  return { get:p=>request('GET',p), post:(p,b)=>request('POST',p,b) };
}

let server, baseUrl;
let fullBackupBuffer;

after(async ()=>{
  await new Promise(resolve => server.close(resolve));
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

function freshApp(){
  // require() кэширует модули — просто продолжать пользоваться старым app
  // означало бы дёргать УЖЕ закрытое (restore-full его закрывает) соединение
  // с БД. Чистим кэш всех серверных модулей и требуем app.js заново — так
  // же, как при настоящем перезапуске node server.js.
  const serverDir = path.join(__dirname, '..') + path.sep;
  const testDir = path.join(__dirname) + path.sep;
  Object.keys(require.cache).forEach(key=>{
    if(key.startsWith(serverDir) && !key.startsWith(testDir)) delete require.cache[key];
  });
  const app2 = require('../app').createApp();
  const server2 = app2.listen(0);
  return server2;
}

async function withServer(srv, fn){
  await new Promise(resolve => srv.once('listening', resolve));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try{ await fn(base); }
  finally{ await new Promise(resolve => srv.close(resolve)); }
}

test('без входа -> 401 на обоих новых эндпоинтах', async ()=>{
  const c = makeClient(baseUrl);
  assert.equal((await c.get('/api/backup/download-full')).status, 401);
  const fd = new FormData();
  fd.append('archive', new Blob([Buffer.from('irrelevant')]), 'x.zip');
  assert.equal((await c.post('/api/backup/restore-full', fd)).status, 401);
});

test('редактор (не admin) не может скачать/восстановить полный архив', async ()=>{
  const admin = makeClient(baseUrl);
  // с седированным дефолтным admin/admin0000 (см. db.js) на свежей БД уже
  // есть аккаунт — регистрация нового пользователя требует входа как admin
  await admin.post('/api/auth/login', { username:'admin', password:'admin0000' });
  await admin.post('/api/auth/register', { username:'full-admin', password:'full-admin-pass1', role:'admin' });
  await admin.post('/api/auth/register', { username:'full-editor', password:'full-editor-pass1', role:'editor' });

  const editor = makeClient(baseUrl);
  await editor.post('/api/auth/login', { username:'full-editor', password:'full-editor-pass1' });
  assert.equal((await editor.get('/api/backup/download-full')).status, 403);
});

test('download-full: собирает .db + все файлы из uploads/ (включая вложенные папки) в один .zip', async ()=>{
  const c = makeClient(baseUrl);
  await c.post('/api/auth/login', { username:'full-admin', password:'full-admin-pass1' });
  await c.post('/api/allods', { name: 'Остров для полного бэкапа' });

  fs.mkdirSync(path.join(UPLOAD_DIR, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, 'pic1.jpg'), 'fake-jpg-bytes');
  fs.writeFileSync(path.join(UPLOAD_DIR, 'sub', 'pic2.png'), 'fake-png-bytes');

  const r = await c.get('/api/backup/download-full');
  assert.equal(r.status, 200);
  assert.equal(r.res.headers.get('content-type'), 'application/zip');

  fullBackupBuffer = Buffer.from(await r.res.arrayBuffer());
  const zip = new AdmZip(fullBackupBuffer);
  const names = zip.getEntries().map(e=>e.entryName);
  assert.ok(names.includes('atlas.db'));
  assert.ok(names.includes('uploads/pic1.jpg'));
  assert.ok(names.includes('uploads/sub/pic2.png'));
});

test('в архиве нет atlas.db -> 400 (соединение с БД не закрывается, ничего не восстановлено)', async ()=>{
  const c = makeClient(baseUrl);
  await c.post('/api/auth/login', { username:'full-admin', password:'full-admin-pass1' });
  const badZip = new AdmZip();
  badZip.addFile('uploads/whatever.jpg', Buffer.from('x'));
  const fd = new FormData();
  fd.append('archive', new Blob([badZip.toBuffer()]), 'bad.zip');
  const r = await c.post('/api/backup/restore-full', fd);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /atlas\.db/);
});

test('atlas.db внутри архива не похож на SQLite -> 400 (соединение не закрывается)', async ()=>{
  const c = makeClient(baseUrl);
  await c.post('/api/auth/login', { username:'full-admin', password:'full-admin-pass1' });
  const badZip = new AdmZip();
  badZip.addFile('atlas.db', Buffer.from('not a real sqlite file'));
  const fd = new FormData();
  fd.append('archive', new Blob([badZip.toBuffer()]), 'bad.zip');
  const r = await c.post('/api/backup/restore-full', fd);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /SQLite/);
});

// --- дальше идут ДВА успешных restore-full — оба закрывают соединение с БД,
// поэтому каждый выполняется на СВОЁМ "перезапущенном" сервере (freshApp),
// а не на общем baseUrl из before() выше.

test('попытка zip-slip (../../ в имени файла внутри uploads/) не выходит за пределы UPLOAD_DIR', async ()=>{
  const srv = freshApp();
  await withServer(srv, async (base)=>{
    const c = makeClient(base);
    await c.post('/api/auth/login', { username:'full-admin', password:'full-admin-pass1' });

    // AdmZip.addFile сам нормализует entryName при создании, поэтому вредоносный
    // путь собираем через низкоуровневый setEntryName после добавления — так
    // тест реально бьёт по защите в самом restore-коде, а не по защите adm-zip.
    const realDbBuffer = new AdmZip(fullBackupBuffer).getEntry('atlas.db').getData();
    const zip = new AdmZip();
    zip.addFile('atlas.db', realDbBuffer);
    const evilEntry = zip.addFile('uploads/placeholder.txt', Buffer.from('should not escape'));
    evilEntry.entryName = 'uploads/../../escaped-outside.txt';

    const fd = new FormData();
    fd.append('archive', new Blob([zip.toBuffer()]), 'evil.zip');
    const r = await c.post('/api/backup/restore-full', fd);
    assert.equal(r.status, 200);
    assert.equal(r.data.uploadsRestored, 0, 'вредоносная запись не должна засчитываться как восстановленный файл');

    const escapedPath = path.join(TEST_DIR, 'escaped-outside.txt');
    assert.equal(fs.existsSync(escapedPath), false, 'файл не должен был появиться за пределами uploads/');
  });
});

test('restore-full: полностью заменяет uploads/ (старые файлы, которых нет в архиве, удаляются)', async ()=>{
  // предварительно кладём "мусорный" файл, которого не было в исходном fullBackupBuffer
  // (после предыдущего теста в uploads/ сейчас лежит только placeholder.txt)
  fs.writeFileSync(path.join(UPLOAD_DIR, 'stale-file-not-in-backup.jpg'), 'stale');

  const srv = freshApp();
  await withServer(srv, async (base)=>{
    const c = makeClient(base);
    await c.post('/api/auth/login', { username:'full-admin', password:'full-admin-pass1' });

    const fd = new FormData();
    fd.append('archive', new Blob([fullBackupBuffer]), 'full.zip');
    const r = await c.post('/api/backup/restore-full', fd);
    assert.equal(r.status, 200);
    assert.equal(r.data.uploadsRestored, 2);
    assert.match(r.data.message, /перезапустите/i);

    assert.equal(fs.existsSync(path.join(UPLOAD_DIR, 'pic1.jpg')), true);
    assert.equal(fs.existsSync(path.join(UPLOAD_DIR, 'sub', 'pic2.png')), true);
    assert.equal(fs.existsSync(path.join(UPLOAD_DIR, 'stale-file-not-in-backup.jpg')), false,
      'файл, отсутствующий в архиве, должен быть удалён при полном восстановлении');
    assert.equal(fs.existsSync(path.join(UPLOAD_DIR, 'placeholder.txt')), false,
      'файл от предыдущего восстановления, отсутствующий в текущем архиве, тоже должен исчезнуть');

    const filesInBackupsDir = fs.readdirSync(process.env.ATLAS_BACKUPS_DIR);
    assert.ok(filesInBackupsDir.some(f=>f.startsWith('pre-restore-') && f.endsWith('.db')));
    assert.ok(filesInBackupsDir.some(f=>f.startsWith('pre-restore-uploads-') && f.endsWith('.zip')),
      'снимок uploads/ "на всякий случай" тоже должен был появиться');
  });
});

test('"перезапуск" поверх восстановленных файлов видит и базу, и uploads/ на месте', async ()=>{
  const srv = freshApp();
  await withServer(srv, async (base)=>{
    const login = await fetch(base + '/api/auth/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username:'full-admin', password:'full-admin-pass1' }),
    });
    assert.equal(login.status, 200);
    const cookie = (login.headers.get('set-cookie')||'').split(';')[0];

    const allodsRes = await fetch(base + '/api/allods', { headers: { Cookie: cookie } });
    const allods = await allodsRes.json();
    assert.ok(allods.some(a=>a.name==='Остров для полного бэкапа'));

    assert.equal(fs.existsSync(path.join(UPLOAD_DIR, 'pic1.jpg')), true);
    assert.equal(fs.existsSync(path.join(UPLOAD_DIR, 'sub', 'pic2.png')), true);
  });
});
