// Проверяет, что сервер никогда не отдаёт "сырую" HTML-страницу с Node.js
// стектрейсом (включая абсолютные пути на диске сервера) — ни на битый JSON
// в теле запроса, ни на несуществующий /api-путь, ни анонимному пользователю.
// См. app.js — единый обработчик ошибок в самом низу цепочки middleware.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-errors-'));
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
});

after(async ()=>{
  await new Promise(resolve => server.close(resolve));
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('битый JSON в теле запроса -> аккуратный JSON 400, не HTML со стектрейсом', async ()=>{
  const res = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{сломанный json',
  });
  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const text = await res.text();
  assert.ok(!text.includes('node_modules'), 'в ответе не должно быть путей на диске сервера');
  assert.ok(!text.includes('at ') || !text.includes('.js:'), 'в ответе не должно быть JS-стектрейса');
});

test('несуществующий /api-путь -> JSON 404, не HTML index.html с кодом 200', async ()=>{
  const res = await fetch(baseUrl + '/api/this-route-does-not-exist');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
});

test('несуществующий обычный (не /api) путь всё ещё отдаёт SPA index.html', async ()=>{
  const res = await fetch(baseUrl + '/some/client-side/route');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
});
