// Проверяет robots.txt (закрыт от индексации по умолчанию, открывается через
// ATLAS_ALLOW_INDEXING=1) и sitemap.xml (см. routes/seo.js).

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-seo-'));
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
  delete process.env.ATLAS_ALLOW_INDEXING;
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('robots.txt по умолчанию закрывает сайт от индексации', async ()=>{
  const res = await fetch(baseUrl + '/robots.txt');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Disallow: \//);
});

test('robots.txt открывается через ATLAS_ALLOW_INDEXING=1 и указывает на sitemap', async ()=>{
  process.env.ATLAS_ALLOW_INDEXING = '1';
  const res = await fetch(baseUrl + '/robots.txt');
  const body = await res.text();
  assert.match(body, /Allow: \//);
  assert.match(body, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
  delete process.env.ATLAS_ALLOW_INDEXING;
});

test('sitemap.xml отдаёт валидный XML с главной страницей', async ()=>{
  const res = await fetch(baseUrl + '/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /xml/);
  const body = await res.text();
  assert.match(body, /<urlset/);
  assert.match(body, /<loc>http:\/\/127\.0\.0\.1:\d+\/<\/loc>/);
});
