// Проверяет миграцию со старой однопользовательской схемы (одна строка в
// таблице auth, без имени пользователя) на новую многопользовательскую
// (таблица users) — см. db.js. Запускается на отдельной, специально
// подготовленной "старой" базе, поэтому живёт в своём файле.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-migration-'));
const DB_PATH = path.join(TEST_DIR, 'legacy.db');

const LEGACY_PASSWORD = 'the-legacy-admin-password';

// Готовим "старую" базу вручную — до того, как её вообще увидит db.js —
// с единственной строкой в таблице auth (id=1), точно как хранил старый код.
function makeSalt(){ return crypto.randomBytes(16).toString('hex'); }
function hashPassword(password, salt){ return crypto.scryptSync(password, salt, 64).toString('hex'); }

const salt = makeSalt();
const hash = hashPassword(LEGACY_PASSWORD, salt);

const legacyDb = new DatabaseSync(DB_PATH);
legacyDb.exec(`CREATE TABLE auth (id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL, hash TEXT NOT NULL)`);
legacyDb.prepare('INSERT INTO auth (id, salt, hash) VALUES (1, ?, ?)').run(salt, hash);
legacyDb.close();

process.env.ATLAS_DB_PATH = DB_PATH;
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';

// require после подготовки файла — db.js увидит уже существующую базу и
// выполнит миграцию auth -> users прямо при загрузке модуля.
const { createApp } = require('../app');

let server, baseUrl;

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async ()=>{
  await new Promise(resolve => server.close(resolve));
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function post(path, body){
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(()=>null) };
}

test('старый аккаунт мигрирует в users под именем admin с тем же паролем', async ()=>{
  const login = await post('/api/auth/login', { username: 'admin', password: LEGACY_PASSWORD });
  assert.equal(login.status, 200);
});

test('старая таблица auth больше не используется (строка удалена после миграции)', ()=>{
  const db = new DatabaseSync(DB_PATH);
  const row = db.prepare('SELECT * FROM auth WHERE id=1').get();
  db.close();
  assert.equal(row, undefined);
});

test('после миграции это обычный многопользовательский аккаунт — можно пригласить второго', async ()=>{
  const loginRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ username: 'admin', password: LEGACY_PASSWORD }),
  });
  const cookie = (loginRes.headers.get('set-cookie')||'').split(';')[0];
  const reg = await fetch(baseUrl + '/api/auth/register', {
    method: 'POST', headers: {'Content-Type':'application/json', Cookie: cookie},
    body: JSON.stringify({ username: 'second-after-migration', password: 'freshpassword1' }),
  });
  assert.equal(reg.status, 200);
});
