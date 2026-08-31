// Целевые тесты на двухфакторный rate-limit логина (по IP И по аккаунту,
// см. security/rateLimiter.js). Отдельный файл от auth.test.js — там уже
// есть базовый тест "5 попыток -> 429" (тот же IP, тот же логин), здесь —
// именно тот сценарий, ради которого сделан второй ключ: атакующий
// перебирает пароль к ОДНОМУ аккаунту, меняя IP между попытками (VPN-
// ротация/ботнет) — раньше это обходило лимит тривиально, каждый IP
// честно получал свою отдельную квоту.
//
// ATLAS_TRUST_PROXY=1 — чтобы X-Forwarded-For реально подменял req.ip
// (иначе все запросы теста шли бы с одного 127.0.0.1 независимо от
// заголовка, и сценарий "разные IP" нечем было бы сымитировать).

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-ratelimit-account-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';
process.env.ATLAS_TRUST_PROXY = '1';

const { createApp } = require('../app');

let DEFAULT_PASSWORD;
function readBootstrapPassword(){
  const content = fs.readFileSync(path.join(TEST_DIR, '.bootstrap-password'), 'utf-8');
  const m = content.match(/admin \/ (\S+)/);
  if(!m) throw new Error('Не удалось распарсить .bootstrap-password: '+content);
  return m[1];
}

let server, baseUrl;

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  DEFAULT_PASSWORD = readBootstrapPassword();
});

after(async ()=>{
  await new Promise(resolve => server.close(resolve));
  delete process.env.ATLAS_TRUST_PROXY;
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

// login с явно заданным "исходным IP" через X-Forwarded-For — без cookie-
// персистентности между вызовами (каждый — чистый fetch, как отдельная
// попытка с этого IP).
async function loginFrom(fakeIp, username, password){
  const res = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'X-Forwarded-For': fakeIp },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, data: await res.json().catch(()=>null) };
}

test('подбор пароля к ОДНОМУ аккаунту с разных IP всё равно ловится (по аккаунту)', async ()=>{
  const statuses = [];
  // 5 неудачных попыток к одному и тому же аккаунту, каждая — с НОВОГО IP
  for(let i=0;i<5;i++){
    const r = await loginFrom(`10.0.0.${i+1}`, 'admin', 'wrong-password-'+i);
    statuses.push(r.status);
  }
  assert.deepEqual(statuses, [401,401,401,401,401], 'первые 5 попыток — обычный неверный пароль, IP у каждой свой, лимит по IP ни разу не исчерпан');

  // 6-я попытка — снова с НОВОГО (шестого) IP, которым мы ещё ни разу не
  // пользовались — по IP лимит точно не должен сработать. Если сработает
  // 429 — значит сработала именно защита по аккаунту.
  const sixth = await loginFrom('10.0.0.99', 'admin', 'wrong-password-final');
  assert.equal(sixth.status, 429, 'шестая попытка с ещё не использованного IP должна быть заблокирована по аккаунту');
  assert.match(sixth.data.error, /попыт/i);
});

test('после блокировки по аккаунту даже ПРАВИЛЬНЫЙ пароль с нового IP не пускает, пока блокировка не истечёт', async ()=>{
  // Аккаунт уже заблокирован предыдущим тестом — проверяем, что это не
  // "блокировка неверных попыток", а настоящая временная блокировка входа
  // в аккаунт целиком, независимо от корректности пароля и от того, что
  // IP опять новый.
  const r = await loginFrom('10.0.0.123', 'admin', DEFAULT_PASSWORD);
  assert.equal(r.status, 429);
});

test('атака на один IP разными логинами по-прежнему ловится (защита по IP не сломалась при добавлении защиты по аккаунту)', async ()=>{
  const sameIp = '203.0.113.7';
  const statuses = [];
  for(let i=0;i<6;i++){
    const r = await loginFrom(sameIp, 'no-such-user-'+i, 'whatever');
    statuses.push(r.status);
  }
  assert.deepEqual(statuses.slice(0,5), [401,401,401,401,401]);
  assert.equal(statuses[5], 429, 'шестая попытка с того же IP (пусть и с новым логином каждый раз) должна упереться в лимит по IP');
});
