// Проверяет весь цикл "скачать базу целиком -> восстановить из файла" сквозь
// реальный HTTP-эндпоинт, а не только то, что скачивание отдаёт валидный SQLite
// (это уже проверяется в data.test.js). Отдельный файл — специально, потому что
// восстановление в реальности перезапускает процесс (см. routes/backup.js), и
// тут это эмулируется через отдельное приложение "после рестарта", а не через
// общий сервер, которым пользуются другие тестовые файлы.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-restore-'));
const DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_DB_PATH = DB_PATH;
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';
// без этого сервер после /backup/restore завершает process.exit() (как в реальной
// жизни) — здесь мы это тестируем без убийства тестового процесса
process.env.ATLAS_TEST_NO_EXIT = '1';

const { createApp } = require('../app');

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
    return { status: res.status, data, res };
  }
  return { get:p=>request('GET',p), post:(p,b)=>request('POST',p,b) };
}

let server, baseUrl;
let snapshotBuffer;

after(async ()=>{
  await new Promise(resolve => server.close(resolve));
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта восстановлением */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const c = makeClient();
  // с седированным дефолтным admin/admin0000 (см. db.js) на свежей БД уже
  // есть аккаунт — регистрация нового пользователя требует входа как admin;
  // restore-tester нужна роль admin — дальше по файлу дёргает /backup/*
  await c.post('/api/auth/login', { username:'admin', password:'admin0000' });
  await c.post('/api/auth/register', { username:'restore-tester', password:'restore-tester-pass1', role:'admin' });
  await c.post('/api/allods', { name: 'Остров До Бэкапа' });

  const dl = await c.get('/api/backup/download');
  assert.equal(dl.status, 200);
  snapshotBuffer = Buffer.from(await dl.res.arrayBuffer());
  assert.ok(snapshotBuffer.toString('utf-8', 0, 16).startsWith('SQLite format 3'));

  // эта запись "теряется" при восстановлении из снимка выше — так мы докажем,
  // что после restore база реально откатилась к состоянию на момент скачивания
  await c.post('/api/allods', { name: 'Остров После Бэкапа (должен исчезнуть)' });
});

test('файл без сигнатуры SQLite отклоняется при восстановлении', async ()=>{
  const c = makeClient();
  await c.post('/api/auth/login', { username:'restore-tester', password:'restore-tester-pass1' });
  const fd = new FormData();
  fd.append('database', new Blob([Buffer.from('это не база данных')], { type:'application/octet-stream' }), 'fake.db');
  const r = await c.post('/api/backup/restore', fd);
  assert.equal(r.status, 400);
});

test('восстановление без входа -> 401', async ()=>{
  const c = makeClient();
  const fd = new FormData();
  fd.append('database', new Blob([snapshotBuffer]), 'atlas.db');
  const r = await c.post('/api/backup/restore', fd);
  assert.equal(r.status, 401);
});

test('перед восстановлением текущая база сохраняется в backups/ как pre-restore-снимок', async ()=>{
  const files = fs.readdirSync(process.env.ATLAS_BACKUPS_DIR);
  assert.ok(!files.some(f=>f.startsWith('pre-restore-')), 'до восстановления такого файла ещё быть не должно');

  const c = makeClient();
  await c.post('/api/auth/login', { username:'restore-tester', password:'restore-tester-pass1' });
  const fd = new FormData();
  fd.append('database', new Blob([snapshotBuffer]), 'atlas.db');
  const r = await c.post('/api/backup/restore', fd);
  assert.equal(r.status, 200);
  assert.match(r.data.message, /перезапустите/i);

  const filesAfter = fs.readdirSync(process.env.ATLAS_BACKUPS_DIR);
  assert.ok(filesAfter.some(f=>f.startsWith('pre-restore-')), 'снимок "на всякий случай" должен был появиться');
});

test('на диске лежит именно содержимое снимка (без хвостов старого -wal/-shm)', ()=>{
  assert.equal(fs.existsSync(DB_PATH + '-wal'), false);
  assert.equal(fs.existsSync(DB_PATH + '-shm'), false);
  const onDisk = fs.readFileSync(DB_PATH);
  assert.equal(Buffer.compare(onDisk, snapshotBuffer), 0, 'файл на диске должен побайтово совпадать со скачанным снимком');
});

function freshApp(){
  // require() кэширует модули — просто вызвать createApp() второй раз означало
  // бы получить ТУ ЖЕ (уже закрытую restore-эндпоинтом) db-коннекцию, а не
  // честную имитацию нового процесса. Чистим кэш всех серверных модулей,
  // кроме самих тестов, и требуем app.js заново — так же, как это происходит
  // при настоящем перезапуске node server.js.
  const serverDir = path.join(__dirname, '..') + path.sep;
  const testDir = path.join(__dirname) + path.sep;
  Object.keys(require.cache).forEach(key=>{
    if(key.startsWith(serverDir) && !key.startsWith(testDir)) delete require.cache[key];
  });
  return require('../app').createApp();
}

test('"перезапуск" (новый процесс/приложение поверх того же файла) видит откаченные данные', async ()=>{
  // имитация реального рестарта после restore: поднимаем НОВОЕ приложение поверх
  // того же файла базы (в проде это происходит после process.exit + перезапуск
  // start.sh/докер-контейнера) — сборка (код) осталась той же, база — тот самый файл
  const app2 = freshApp();
  const server2 = app2.listen(0);
  await new Promise(resolve => server2.once('listening', resolve));
  const base2 = `http://127.0.0.1:${server2.address().port}`;

  try{
    const c2 = makeClient();
    const login = await fetch(base2 + '/api/auth/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username:'restore-tester', password:'restore-tester-pass1' }),
    });
    assert.equal(login.status, 200, 'аккаунт из снимка должен быть на месте после отката');
    const cookie = (login.headers.get('set-cookie')||'').split(';')[0];

    const allodsRes = await fetch(base2 + '/api/allods', { headers: { Cookie: cookie } });
    const allods = await allodsRes.json();
    const names = allods.map(a=>a.name);

    assert.ok(names.includes('Остров До Бэкапа'), 'данные на момент снимка должны сохраниться');
    assert.ok(!names.includes('Остров После Бэкапа (должен исчезнуть)'),
      'данные, созданные ПОСЛЕ снимка, должны были исчезнуть после восстановления');
  }finally{
    await new Promise(resolve => server2.close(resolve));
  }
});
