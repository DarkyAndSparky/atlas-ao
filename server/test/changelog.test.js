// Тесты на парсер CHANGELOG.md (readChangelog в routes/system.js). Это
// регрессия против молчаливой поломки формата: если кто-то поменяет
// структуру заголовков в CHANGELOG.md не так, как ожидает парсер, раздел
// «Последние изменения» на странице «О системе» просто молча опустеет —
// лучше поймать это тестом.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.ATLAS_DB_PATH = process.env.ATLAS_DB_PATH
  || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-changelog-')), 'test.db');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-not-for-production';

const { readChangelog } = require('../routes/system');

test('CHANGELOG.md существует и парсится хотя бы в один релиз', ()=>{
  const releases = readChangelog();
  assert.ok(Array.isArray(releases), 'должен быть массивом');
  assert.ok(releases.length > 0, 'должен быть распарсен хотя бы один релиз');
  const withItems = releases.find(r => r.items.length > 0);
  assert.ok(withItems, 'хотя бы у одного релиза должны быть пункты изменений');
});

test('readChangelog(limit) не возвращает больше limit релизов', ()=>{
  const releases = readChangelog(1);
  assert.ok(releases.length <= 1);
});

// Подменяем ATLAS_CHANGELOG_PATH на временный файл и заставляем модуль
// перечитаться (require.cache), чтобы прогнать реальный парсер на
// контролируемом формате — не дублируя его regex в тесте.
test('парсер собирает пункты из всех подсекций (### Добавлено/Изменено/...) в один плоский список', ()=>{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-changelog-fmt-'));
  const changelogPath = path.join(tmpDir, 'CHANGELOG.md');
  fs.writeFileSync(changelogPath, [
    '# Changelog',
    '',
    '## [v1.0.0] — 2026-01-01',
    '',
    '### Добавлено',
    '- Пункт раз',
    '',
    '### Исправлено',
    '- Пункт два',
    '',
    '## [Unreleased]',
    '',
    '### Добавлено',
    '- Черновой пункт',
  ].join('\n'));

  const prevPath = process.env.ATLAS_CHANGELOG_PATH;
  process.env.ATLAS_CHANGELOG_PATH = changelogPath;
  delete require.cache[require.resolve('../routes/system')];
  try{
    const { readChangelog: reread } = require('../routes/system');
    const releases = reread();
    assert.equal(releases.length, 2);
    assert.equal(releases[0].version, 'v1.0.0');
    assert.equal(releases[0].date, '2026-01-01');
    assert.deepEqual(releases[0].items, ['Пункт раз', 'Пункт два']);
    assert.equal(releases[1].version, 'Unreleased');
    assert.equal(releases[1].date, null);
  }finally{
    if(prevPath === undefined) delete process.env.ATLAS_CHANGELOG_PATH;
    else process.env.ATLAS_CHANGELOG_PATH = prevPath;
    delete require.cache[require.resolve('../routes/system')];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('парсер не падает и возвращает [], если CHANGELOG.md отсутствует', ()=>{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-changelog-missing-'));
  const missingPath = path.join(tmpDir, 'does-not-exist.md');

  const prevPath = process.env.ATLAS_CHANGELOG_PATH;
  process.env.ATLAS_CHANGELOG_PATH = missingPath;
  delete require.cache[require.resolve('../routes/system')];
  try{
    const { readChangelog: reread } = require('../routes/system');
    assert.deepEqual(reread(), []);
  }finally{
    if(prevPath === undefined) delete process.env.ATLAS_CHANGELOG_PATH;
    else process.env.ATLAS_CHANGELOG_PATH = prevPath;
    delete require.cache[require.resolve('../routes/system')];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
