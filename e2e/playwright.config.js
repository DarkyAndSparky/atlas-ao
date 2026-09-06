const fs = require('fs');
const path = require('path');
const os = require('os');
const { defineConfig, devices } = require('@playwright/test');

// изолированная тестовая БД/папки — реальные данные проекта e2e-тесты не трогают.
// desktop-chrome и mobile-iphone гоняют ОДИН И ТОТ ЖЕ набор тестов с
// хардкоженными ID островов (a001, a020...) — если оба проекта бьют по
// одному серверу/БД, второй проход задваивает данные (галерея 1→2,
// локации 2→4 и т.д.), поэтому у каждого проекта — полностью свой сервер,
// своя временная БД и свой порт.
const TEST_DIR_DESKTOP = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-e2e-desktop-'));
const TEST_DIR_MOBILE = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-e2e-mobile-'));
const PORT_DESKTOP = 4199;
const PORT_MOBILE = 4200;

function serverEnv(dir, port){
  return {
    PORT: String(port),
    ATLAS_DB_PATH: path.join(dir, 'test.db'),
    ATLAS_UPLOAD_DIR: path.join(dir, 'uploads'),
    ATLAS_BACKUPS_DIR: path.join(dir, 'backups'),
    SESSION_SECRET: 'e2e-test-secret',
    // фиксирует bootstrap-пароль дефолтного admin, чтобы global-setup.js
    // мог логиниться детерминированно (см. db.js) — только тестовое
    // окружение, в проде эта переменная не ставится.
    ATLAS_BOOTSTRAP_PASSWORD: 'e2e-bootstrap-password-123',
    // сьют намеренно гоняет много "неверный пароль" тестов подряд с
    // одного IP — без этого 5-минутная блокировка после 5 неудачных
    // попыток (см. server/security/rateLimiter.js) валит все
    // последующие тесты, которым нужен реальный логин.
    ATLAS_DISABLE_RATE_LIMIT: '1',
    // secure-куки теперь true по умолчанию (см. roadmap #9) — без этого
    // флага браузер не отправит сессионную куку обратно по обычному
    // http://localhost, и вообще ни один тест с логином не пройдёт.
    ATLAS_ALLOW_HTTP: '1',
  };
}

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false, // общий сервер с общей БД внутри каждого проекта — тесты идут последовательно
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: require.resolve('./global-setup.js'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  expect: { timeout: 10_000 },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT_DESKTOP}` } },
    { name: 'mobile-iphone', use: { ...devices['iPhone 13'], baseURL: `http://localhost:${PORT_MOBILE}` } },
  ],
  webServer: [
    {
      command: 'node ../server/server.js',
      url: `http://localhost:${PORT_DESKTOP}/api/allods`,
      reuseExistingServer: false,
      timeout: 20_000,
      env: serverEnv(TEST_DIR_DESKTOP, PORT_DESKTOP),
    },
    {
      command: 'node ../server/server.js',
      url: `http://localhost:${PORT_MOBILE}/api/allods`,
      reuseExistingServer: false,
      timeout: 20_000,
      env: serverEnv(TEST_DIR_MOBILE, PORT_MOBILE),
    },
  ],
});
