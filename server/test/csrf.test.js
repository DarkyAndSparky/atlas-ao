// CSRF-защита (roadmap #7): проверка Origin/Referer на POST/PATCH/DELETE.
// Отдельная изолированная временная БД — как и остальные файлы в test/.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-csrf-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';
process.env.ATLAS_ALLOW_HTTP = '1'; // secure-куки по умолчанию (roadmap #9) ломают set-cookie на обычном HTTP, каким тут гоняют тесты

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

function request(method, p, { origin, referer } = {}){
  const headers = { 'Content-Type': 'application/json' };
  if(origin !== undefined) headers['Origin'] = origin;
  if(referer !== undefined) headers['Referer'] = referer;
  return fetch(baseUrl + p, { method, headers, body: JSON.stringify({}) });
}

test('POST с чужим Origin отклоняется 403', async ()=>{
  const res = await request('POST', '/api/auth/login', { origin: 'https://evil.example.com' });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /другого источника/);
});

test('POST с чужим Referer (без Origin) тоже отклоняется 403', async ()=>{
  const res = await request('POST', '/api/auth/login', { referer: 'https://evil.example.com/attack.html' });
  assert.equal(res.status, 403);
});

test('POST с Origin, совпадающим с хостом сервера, проходит проверку CSRF (падает уже на неверном логине/пароле, не на 403)', async ()=>{
  const res = await request('POST', '/api/auth/login', { origin: baseUrl });
  assert.notEqual(res.status, 403);
});

test('POST вовсе без Origin/Referer (не браузерный клиент — curl, серверный скрипт) не блокируется', async ()=>{
  const res = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'nope', password: 'nope' }),
  });
  assert.notEqual(res.status, 403);
});

test('GET-запросы не проверяются вообще (не должны иметь побочных эффектов)', async ()=>{
  const res = await fetch(baseUrl + '/api/allods', { headers: { Origin: 'https://evil.example.com' } });
  assert.notEqual(res.status, 403);
});
