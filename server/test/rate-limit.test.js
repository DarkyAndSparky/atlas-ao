// Проверяет общий rate limit на /api (см. app.js, apiLimiter) — не заменяет
// отдельный лимитер по попыткам логина (security/rateLimiter.js), а
// накрывает всё остальное API от примитивного скрапинга/DoS.
// Лимит переопределён в маленькое значение через env, чтобы тест не слал
// сотни запросов.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-ratelimit-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';
process.env.ATLAS_RATE_LIMIT_MAX = '5';
process.env.ATLAS_RATE_LIMIT_WINDOW_MS = '60000';

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
  delete process.env.ATLAS_RATE_LIMIT_MAX;
  delete process.env.ATLAS_RATE_LIMIT_WINDOW_MS;
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('после ATLAS_RATE_LIMIT_MAX запросов к /api отдаётся 429', async ()=>{
  const max = Number(process.env.ATLAS_RATE_LIMIT_MAX);
  let lastStatus;
  for(let i=0;i<max;i++){
    const res = await fetch(baseUrl + '/api/allods');
    lastStatus = res.status;
    assert.equal(lastStatus, 200);
  }
  const overLimit = await fetch(baseUrl + '/api/allods');
  assert.equal(overLimit.status, 429);
});

test('/api/health не считается в общий лимит', async ()=>{
  // лимит уже исчерпан предыдущим тестом (тот же процесс/IP), но health
  // должен быть исключён и продолжать отвечать 200
  const res = await fetch(baseUrl + '/api/health');
  assert.equal(res.status, 200);
});
