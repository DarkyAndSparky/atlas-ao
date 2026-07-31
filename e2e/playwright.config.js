const fs = require('fs');
const path = require('path');
const os = require('os');
const { defineConfig, devices } = require('@playwright/test');

// изолированная тестовая БД/папки — реальные данные проекта e2e-тесты не трогают
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-e2e-'));
const PORT = 4199;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false, // общий сервер с общей БД — тесты идут последовательно
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: require.resolve('./global-setup.js'),
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  expect: { timeout: 10_000 },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node ../server/server.js',
    url: `http://localhost:${PORT}/api/allods`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      PORT: String(PORT),
      ATLAS_DB_PATH: path.join(TEST_DIR, 'test.db'),
      ATLAS_UPLOAD_DIR: path.join(TEST_DIR, 'uploads'),
      ATLAS_BACKUPS_DIR: path.join(TEST_DIR, 'backups'),
      SESSION_SECRET: 'e2e-test-secret',
    },
  },
});
