// Тесты server/backupScheduler.js. Реальные таймеры (setInterval) тут не
// тестируются напрямую — вместо этого проверяются вынесенные наружу чистые
// функции (shouldRunNow, pruneOldAutoBackups) и одноразовый прогон самого
// бэкапа (runScheduledBackup), что покрывает всю содержательную логику
// без необходимости ждать реальные минуты/часы в тестах.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const {
  shouldRunNow, dateStr, runScheduledBackup, pruneOldAutoBackups,
  isEnabled, getTargetHour, getKeepCount, AUTO_BACKUP_PREFIX,
} = require('../backupScheduler');

test('shouldRunNow: срабатывает только в целевой час и только один раз за день', ()=>{
  assert.equal(shouldRunNow(3, 3, null, '2026-08-18'), true, 'целевой час, ещё не запускался ни разу');
  assert.equal(shouldRunNow(3, 3, '2026-08-17', '2026-08-18'), true, 'целевой час, последний раз был вчера');
  assert.equal(shouldRunNow(3, 3, '2026-08-18', '2026-08-18'), false, 'уже запускался сегодня — повторно не надо');
  assert.equal(shouldRunNow(4, 3, null, '2026-08-18'), false, 'не тот час');
  assert.equal(shouldRunNow(2, 3, '2026-08-17', '2026-08-18'), false, 'ещё не наступил целевой час');
});

test('dateStr отдаёт формат YYYY-MM-DD', ()=>{
  const d = new Date('2026-08-18T14:30:00Z');
  assert.equal(dateStr(d), '2026-08-18');
});

test('isEnabled/getTargetHour/getKeepCount читают переменные окружения с разумными дефолтами', ()=>{
  const prevEnabled = process.env.ATLAS_AUTO_BACKUP;
  const prevHour = process.env.ATLAS_AUTO_BACKUP_HOUR;
  const prevKeep = process.env.ATLAS_AUTO_BACKUP_KEEP;
  try{
    delete process.env.ATLAS_AUTO_BACKUP;
    delete process.env.ATLAS_AUTO_BACKUP_HOUR;
    delete process.env.ATLAS_AUTO_BACKUP_KEEP;
    assert.equal(isEnabled(), false, 'по умолчанию выключено');
    assert.equal(getTargetHour(), 3, 'дефолтный час — 3 (ночь)');
    assert.equal(getKeepCount(), 14, 'дефолтное хранение — 14 копий');

    process.env.ATLAS_AUTO_BACKUP = '1';
    process.env.ATLAS_AUTO_BACKUP_HOUR = '17';
    process.env.ATLAS_AUTO_BACKUP_KEEP = '3';
    assert.equal(isEnabled(), true);
    assert.equal(getTargetHour(), 17);
    assert.equal(getKeepCount(), 3);

    process.env.ATLAS_AUTO_BACKUP_HOUR = '99'; // вне диапазона 0-23 — откатываемся на дефолт
    assert.equal(getTargetHour(), 3);

    // docker-compose ${VAR:-} подставляет ПУСТУЮ строку, если .env не задаёт
    // переменную явно — это не то же самое, что переменная вообще не установлена
    // (Number('') === 0, что раньше давало 0 вместо дефолтного часа 3)
    process.env.ATLAS_AUTO_BACKUP_HOUR = '';
    assert.equal(getTargetHour(), 3, 'пустая строка (как из docker-compose ${VAR:-}) должна давать дефолт, а не 0');
    process.env.ATLAS_AUTO_BACKUP_KEEP = '';
    assert.equal(getKeepCount(), 14, 'пустая строка должна давать дефолт для keep тоже');
  }finally{
    if(prevEnabled===undefined) delete process.env.ATLAS_AUTO_BACKUP; else process.env.ATLAS_AUTO_BACKUP=prevEnabled;
    if(prevHour===undefined) delete process.env.ATLAS_AUTO_BACKUP_HOUR; else process.env.ATLAS_AUTO_BACKUP_HOUR=prevHour;
    if(prevKeep===undefined) delete process.env.ATLAS_AUTO_BACKUP_KEEP; else process.env.ATLAS_AUTO_BACKUP_KEEP=prevKeep;
  }
});

test('runScheduledBackup создаёт файл с префиксом atlas-auto-backup- и реальным содержимым БД', ()=>{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-scheduler-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const backupsDir = path.join(tmpDir, 'backups');

  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');

  const dest = runScheduledBackup({ dbPath, backupsDir, db, keep: 14 });
  assert.ok(dest);
  assert.ok(path.basename(dest).startsWith(AUTO_BACKUP_PREFIX));
  assert.ok(fs.existsSync(dest));

  const restored = new DatabaseSync(dest);
  const row = restored.prepare('SELECT v FROM t WHERE id=1').get();
  assert.equal(row.v, 'hello');
  restored.close();

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('runScheduledBackup: отсутствующий файл БД не падает, просто пропускает', ()=>{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-scheduler-missing-'));
  const dest = runScheduledBackup({
    dbPath: path.join(tmpDir, 'does-not-exist.db'),
    backupsDir: path.join(tmpDir, 'backups'),
    db: { exec(){} },
  });
  assert.equal(dest, null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('pruneOldAutoBackups: оставляет только keep самых свежих auto-бэкапов, не трогает файлы других префиксов', ()=>{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-prune-'));
  const backupsDir = path.join(tmpDir, 'backups');
  fs.mkdirSync(backupsDir);

  const names = [];
  for(let i=0; i<5; i++){
    const name = `${AUTO_BACKUP_PREFIX}2026-08-1${i}T00-00-00-000Z.db`;
    fs.writeFileSync(path.join(backupsDir, name), 'x');
    names.push(name);
    // разносим mtime по времени, чтобы порядок "новизны" был однозначным
    const t = new Date(2026, 7, 10+i);
    fs.utimesSync(path.join(backupsDir, name), t, t);
  }
  // файлы других типов — не должны пострадать
  fs.writeFileSync(path.join(backupsDir, 'atlas-backup-2026-08-01T00-00-00-000Z.db'), 'manual');
  fs.writeFileSync(path.join(backupsDir, 'pre-restore-2026-08-01T00-00-00-000Z.db'), 'prerestore');

  pruneOldAutoBackups(backupsDir, 2);

  const remaining = fs.readdirSync(backupsDir);
  const remainingAuto = remaining.filter(f=>f.startsWith(AUTO_BACKUP_PREFIX));
  assert.equal(remainingAuto.length, 2, 'должно остаться ровно 2 auto-бэкапа');
  // самые новые (i=3, i=4) — должны быть среди оставшихся
  assert.ok(remainingAuto.includes(names[4]));
  assert.ok(remainingAuto.includes(names[3]));
  // старые (i=0,1,2) — должны быть удалены
  assert.ok(!remainingAuto.includes(names[0]));

  assert.ok(remaining.includes('atlas-backup-2026-08-01T00-00-00-000Z.db'), 'ручной бэкап не должен быть тронут');
  assert.ok(remaining.includes('pre-restore-2026-08-01T00-00-00-000Z.db'), 'pre-restore снимок не должен быть тронут');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('pruneOldAutoBackups: пустая/несуществующая папка не падает', ()=>{
  assert.doesNotThrow(()=> pruneOldAutoBackups('/tmp/does-not-exist-atlas-scheduler-test', 5));
});
