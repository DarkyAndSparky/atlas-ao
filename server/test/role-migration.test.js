// Проверяет миграцию с многопользовательской схемы БЕЗ ролей (то есть той,
// что реально сейчас на проде — таблица users уже есть, колонки role нет) —
// это более вероятный практический сценарий апгрейда, чем миграция с самой
// старой однопользовательской auth-схемы (та проверяется в migration.test.js).
// Ожидание: существующие аккаунты становятся 'admin', а не тихо теряют
// доступ к настройкам/бэкапам/управлению пользователями.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-role-migration-'));
const DB_PATH = path.join(TEST_DIR, 'pre-role.db');

const PASSWORD_ONE = 'existing-admin-password';
const PASSWORD_TWO = 'existing-second-password';

function makeSalt(){ return crypto.randomBytes(16).toString('hex'); }
function hashPassword(password, salt){ return crypto.scryptSync(password, salt, 64).toString('hex'); }

// Собираем "старую" (пред-ролевую) базу вручную — до того, как её вообще
// увидит db.js — с таблицей users без колонки role, точно как хранил код
// до введения ролей. Два существующих аккаунта — чтобы убедиться, что ОБА
// получают 'admin', а не только первый.
const s1 = makeSalt(), h1 = hashPassword(PASSWORD_ONE, s1);
const s2 = makeSalt(), h2 = hashPassword(PASSWORD_TWO, s2);

const legacyDb = new DatabaseSync(DB_PATH);
legacyDb.exec(`CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
legacyDb.prepare('INSERT INTO users (username, salt, hash, created_at) VALUES (?,?,?,?)')
  .run('firstuser', s1, h1, Date.now());
legacyDb.prepare('INSERT INTO users (username, salt, hash, created_at) VALUES (?,?,?,?)')
  .run('seconduser', s2, h2, Date.now());
legacyDb.close();

process.env.ATLAS_DB_PATH = DB_PATH;
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';

// require после подготовки файла — db.js увидит уже существующую базу без
// колонки role и выполнит ALTER TABLE прямо при загрузке модуля.
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
  try{ require('../db').close(); }catch(e){}
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function post(path, body){
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(()=>null);
  return { status: res.status, data, cookie: (res.headers.get('set-cookie')||'').split(';')[0] };
}

test('оба существующих (до миграции) аккаунта становятся admin, не editor', async ()=>{
  const login1 = await post('/api/auth/login', { username: 'firstuser', password: PASSWORD_ONE });
  assert.equal(login1.status, 200);
  assert.equal(login1.data.user.role, 'admin');

  const login2 = await post('/api/auth/login', { username: 'seconduser', password: PASSWORD_TWO });
  assert.equal(login2.status, 200);
  assert.equal(login2.data.user.role, 'admin');
});

test('после миграции существующий аккаунт сохраняет доступ к admin-only ручкам (не понижен молча)', async ()=>{
  const login = await post('/api/auth/login', { username: 'firstuser', password: PASSWORD_ONE });
  const res = await fetch(baseUrl + '/api/auth/users', { headers: { Cookie: login.cookie } });
  assert.equal(res.status, 200);
});
