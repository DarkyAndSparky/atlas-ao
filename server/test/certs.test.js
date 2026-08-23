// Проверяет разрешение HTTPS-сертификата (см. certs.js): внешний готовый
// сертификат (ATLAS_CERT_FILE/ATLAS_KEY_FILE, путь для настоящего Let's
// Encrypt через certbot) имеет приоритет над локальным самоподписанным;
// самоподписанный кэшируется на диске и переиспользуется; нормализация
// переводов строк (важно на Windows).

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { resolveHttpsCert, normalizePem, isValidPem } = require('../certs');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-certs-'));

afterEach(()=>{
  delete process.env.ATLAS_CERT_FILE;
  delete process.env.ATLAS_KEY_FILE;
});

after(()=>{
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('normalizePem убирает \\r\\n и гарантирует завершающий перевод строки', ()=>{
  const withCrlf = '-----BEGIN CERTIFICATE-----\r\nABC\r\nDEF\r\n-----END CERTIFICATE-----';
  const normalized = normalizePem(withCrlf);
  assert.ok(!normalized.includes('\r'));
  assert.ok(normalized.endsWith('\n'));
});

test('isValidPem отличает похожее на PEM от мусора', ()=>{
  assert.equal(isValidPem('-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----\n'), true);
  assert.equal(isValidPem('это не сертификат'), false);
  assert.equal(isValidPem(null), false);
});

test('без ATLAS_CERT_FILE/KEY_FILE — самоподписанный сертификат генерируется и кэшируется', ()=>{
  const certDir = path.join(TEST_DIR, 'self-signed');
  const first = resolveHttpsCert(certDir);
  assert.ok(first);
  assert.match(first.source, /^self-signed/);
  assert.ok(isValidPem(first.key));
  assert.ok(isValidPem(first.cert));
  assert.ok(fs.existsSync(path.join(certDir, 'key.pem')));
  assert.ok(fs.existsSync(path.join(certDir, 'cert.pem')));

  const second = resolveHttpsCert(certDir);
  assert.equal(second.source, 'self-signed-cached');
  assert.equal(second.cert, first.cert);
});

test('внешний сертификат (ATLAS_CERT_FILE/KEY_FILE) имеет приоритет над самоподписанным', ()=>{
  const externalDir = path.join(TEST_DIR, 'external');
  fs.mkdirSync(externalDir, { recursive: true });
  const { generateKeyPairSync } = crypto;
  // валидный self-signed через openssl-независимый путь недоступен тут напрямую
  // (у нас нет x509 генератора без selfsigned/openssl) — используем сначала
  // resolveHttpsCert на отдельный certDir, чтобы получить настоящий валидный
  // PEM-сертификат, и "подставляем" его как будто это внешний файл от certbot
  const generated = resolveHttpsCert(path.join(TEST_DIR, 'external-source'));
  const certFile = path.join(externalDir, 'fullchain.pem');
  const keyFile = path.join(externalDir, 'privkey.pem');
  fs.writeFileSync(certFile, generated.cert);
  fs.writeFileSync(keyFile, generated.key);

  process.env.ATLAS_CERT_FILE = certFile;
  process.env.ATLAS_KEY_FILE = keyFile;

  const resolved = resolveHttpsCert(path.join(TEST_DIR, 'unused-self-signed-dir'));
  assert.equal(resolved.source, 'external');
  assert.equal(resolved.cert.trim(), generated.cert.trim());
  // самоподписанный каталог не должен был тронуться — внешний сертификат
  // имеет приоритет и до генерации самоподписанного даже не доходит
  assert.ok(!fs.existsSync(path.join(TEST_DIR, 'unused-self-signed-dir', 'cert.pem')));
});

test('ATLAS_CERT_FILE указывает на несуществующий файл -> откат на самоподписанный, а не падение', ()=>{
  process.env.ATLAS_CERT_FILE = path.join(TEST_DIR, 'nope', 'fullchain.pem');
  process.env.ATLAS_KEY_FILE = path.join(TEST_DIR, 'nope', 'privkey.pem');
  const certDir = path.join(TEST_DIR, 'fallback-after-missing-external');
  const resolved = resolveHttpsCert(certDir);
  assert.ok(resolved);
  assert.match(resolved.source, /^self-signed/);
});
