// Проверяет разовую авто-миграцию текстового поля allods.archipelago в
// полноценные записи archipelagos (+ простановку archipelago_id) — см. db.js.
// Запускается на специально подготовленной "старой" базе (без колонки
// archipelago_id), поэтому живёт в своём файле, как и migration.test.js.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-archipelago-migration-'));
const DB_PATH = path.join(TEST_DIR, 'legacy.db');

// собираем "старую" базу вручную — схема до появления archipelago_id,
// с двумя островами на один и тот же текстовый архипелаг в одном project,
// и одним островом с архипелагом в другом project (не должны схлопнуться
// в одну запись — миграция группирует по (project, archipelago))
const legacyDb = new DatabaseSync(DB_PATH);
legacyDb.exec(`
CREATE TABLE allods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  climate TEXT,
  size TEXT,
  holder TEXT,
  faction TEXT,
  hasMap INTEGER DEFAULT 0,
  type TEXT,
  category TEXT,
  plot TEXT,
  expansion TEXT,
  archipelago TEXT,
  description TEXT DEFAULT '',
  history TEXT DEFAULT '',
  mapX REAL,
  mapY REAL,
  project TEXT DEFAULT 'Аллоды Онлайн'
);
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin'
);
`);
legacyDb.prepare("INSERT INTO allods (id, name, archipelago, project) VALUES (?,?,?,?)")
  .run('allod_a', 'Остров А', 'Северный архипелаг', 'Аллоды Онлайн');
legacyDb.prepare("INSERT INTO allods (id, name, archipelago, project) VALUES (?,?,?,?)")
  .run('allod_b', 'Остров Б', 'Северный архипелаг', 'Аллоды Онлайн');
legacyDb.prepare("INSERT INTO allods (id, name, archipelago, project) VALUES (?,?,?,?)")
  .run('allod_c', 'Остров В (другой проект)', 'Северный архипелаг', 'Другой проект');
legacyDb.prepare("INSERT INTO allods (id, name, archipelago, project) VALUES (?,?,?,?)")
  .run('allod_d', 'Остров без архипелага', null, 'Аллоды Онлайн');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('legacy-admin-password-1', salt, 64).toString('hex');
legacyDb.prepare("INSERT INTO users (username, salt, hash, role) VALUES (?,?,?,?)").run('admin', salt, hash, 'admin');
legacyDb.close();

process.env.ATLAS_DB_PATH = DB_PATH;
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';

// require после подготовки файла — db.js увидит уже существующую базу без
// archipelago_id и выполнит миграцию прямо при загрузке модуля.
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

test('одинаковый текст архипелага в одном project схлопывается в одну запись', async ()=>{
  const res = await fetch(baseUrl + '/api/archipelagos?project=' + encodeURIComponent('Аллоды Онлайн'));
  const data = await res.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].name, 'Северный архипелаг');
  assert.equal(data[0].members.length, 2);
  assert.deepEqual(data[0].members.map(m=>m.id).sort(), ['allod_a','allod_b']);
});

test('тот же текст в другом project — отдельная запись, не смешивается', async ()=>{
  const res = await fetch(baseUrl + '/api/archipelagos?project=' + encodeURIComponent('Другой проект'));
  const data = await res.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].members.length, 1);
  assert.equal(data[0].members[0].id, 'allod_c');
});

test('остров без текста архипелага не попал ни в один', async ()=>{
  const res = await fetch(baseUrl + '/api/archipelagos?project=' + encodeURIComponent('Аллоды Онлайн'));
  const data = await res.json();
  assert.ok(!data[0].members.some(m=>m.id==='allod_d'));
});

test('archipelago_id у мигрировавших островов реально проставлен (доступен через /allods)', async ()=>{
  const res = await fetch(baseUrl + '/api/allods');
  const data = await res.json();
  const a = data.find(x=>x.id==='allod_a');
  const b = data.find(x=>x.id==='allod_b');
  const d = data.find(x=>x.id==='allod_d');
  assert.ok(a.archipelago_id);
  assert.equal(a.archipelago_id, b.archipelago_id);
  assert.equal(d.archipelago_id, null);
});
