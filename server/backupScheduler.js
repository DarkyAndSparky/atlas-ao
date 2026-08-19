// Автоматические бэкапы по расписанию — раньше `backup` делался только
// вручную (кнопкой в UI или `npm run backup`). Без внешних зависимостей
// (никакого node-cron) — достаточно раз в несколько минут проверять,
// не наступил ли ещё не пройденный сегодня целевой час.
//
// Включается переменной окружения ATLAS_AUTO_BACKUP=1 (по умолчанию — выключено,
// чтобы не менять поведение никому, кто уже развернул сервер и не просил
// автобэкапы). Настройки:
//   ATLAS_AUTO_BACKUP=1           — включить
//   ATLAS_AUTO_BACKUP_HOUR=3      — час запуска по серверному времени, 0-23 (по умолчанию 3 — ночь)
//   ATLAS_AUTO_BACKUP_KEEP=14     — сколько последних авто-бэкапов хранить (по умолчанию 14)
//
// Автоматические бэкапы кладутся в тот же backups/, что и ручные, но с
// отдельным префиксом имени файла (atlas-auto-backup-*) — так ротация
// (см. pruneOldAutoBackups) удаляет только свои же старые файлы и никогда
// не трогает ручные бэкапы или pre-restore снимки (у них другие префиксы).
const fs = require('fs');
const path = require('path');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // проверяем раз в 15 минут, этого достаточно
const AUTO_BACKUP_PREFIX = 'atlas-auto-backup-';

function isEnabled(){
  return process.env.ATLAS_AUTO_BACKUP === '1' || process.env.ATLAS_AUTO_BACKUP === 'true';
}

function getTargetHour(){
  if(!process.env.ATLAS_AUTO_BACKUP_HOUR) return 3; // пусто/не задано (в т.ч. docker-compose ${VAR:-} даёт "", а не undefined)
  const h = Number(process.env.ATLAS_AUTO_BACKUP_HOUR);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 3;
}

function getKeepCount(){
  if(!process.env.ATLAS_AUTO_BACKUP_KEEP) return 14;
  const n = Number(process.env.ATLAS_AUTO_BACKUP_KEEP);
  return Number.isInteger(n) && n > 0 ? n : 14;
}

// Чистая функция (без обращения к Date.now() внутри) — решает, пора ли
// запускать бэкап, зная текущий час и дату последнего запуска (в форме
// YYYY-MM-DD, или null, если ещё не запускался с момента старта процесса).
// Вынесена отдельно специально ради тестируемости без реальных таймеров.
function shouldRunNow(currentHour, targetHour, lastRunDateStr, todayDateStr){
  if(currentHour !== targetHour) return false;
  return lastRunDateStr !== todayDateStr;
}

function dateStr(d){
  return d.toISOString().slice(0, 10); // YYYY-MM-DD, серверный часовой пояс не важен — только для сравнения "уже сегодня запускали или нет"
}

// Собственно бэкап: checkpoint + копирование .db под именем с префиксом
// atlas-auto-backup-, плюс ротация старых. Использует УЖЕ открытое
// соединение сервера (require('../db')), а не поднимает второе — в отличие
// от scripts/backup.js, который запускается отдельным процессом и поэтому
// вынужден открывать своё собственное.
function runScheduledBackup({ dbPath, backupsDir, db, keep = getKeepCount() } = {}){
  if(!fs.existsSync(dbPath)){
    console.warn('[auto-backup] файл базы не найден, пропускаю:', dbPath);
    return null;
  }
  if(!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  try{ db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
  catch(e){ console.warn('[auto-backup] не удалось выполнить checkpoint (продолжаю всё равно):', e.message); }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupsDir, `${AUTO_BACKUP_PREFIX}${stamp}.db`);
  fs.copyFileSync(dbPath, dest);
  console.log('[auto-backup] сохранён:', dest);

  pruneOldAutoBackups(backupsDir, keep);
  return dest;
}

// Оставляет только keep самых свежих atlas-auto-backup-*.db файлов, старше —
// удаляет. Файлы других префиксов (ручные бэкапы, pre-restore снимки) не
// трогает вообще — фильтр по имени применяется до сортировки/удаления.
function pruneOldAutoBackups(backupsDir, keep){
  let files;
  try{ files = fs.readdirSync(backupsDir); }
  catch(e){ return; }

  const autoBackups = files
    .filter(f => f.startsWith(AUTO_BACKUP_PREFIX) && f.endsWith('.db'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // новые сначала

  const toDelete = autoBackups.slice(keep);
  for(const f of toDelete){
    try{ fs.unlinkSync(path.join(backupsDir, f.name)); }
    catch(e){ console.warn('[auto-backup] не удалось удалить старый файл', f.name, e.message); }
  }
  if(toDelete.length){
    console.log(`[auto-backup] удалено старых копий: ${toDelete.length} (оставлено ${keep})`);
  }
}

// Запускает периодическую проверку. Возвращает функцию остановки (для тестов —
// сервер в проде её не вызывает, интервал живёт всё время работы процесса).
function startBackupScheduler({ dbPath, backupsDir, db } = {}){
  if(!isEnabled()){
    console.log('[auto-backup] выключен (ATLAS_AUTO_BACKUP не установлен) — бэкапы только вручную.');
    return ()=>{};
  }
  const targetHour = getTargetHour();
  console.log(`[auto-backup] включён: ежедневно около ${String(targetHour).padStart(2,'0')}:00, хранить последних ${getKeepCount()}.`);

  let lastRunDateStr = null;
  const tick = ()=>{
    const now = new Date();
    if(shouldRunNow(now.getHours(), targetHour, lastRunDateStr, dateStr(now))){
      lastRunDateStr = dateStr(now);
      runScheduledBackup({ dbPath, backupsDir, db });
    }
  };
  const interval = setInterval(tick, CHECK_INTERVAL_MS);
  if(interval.unref) interval.unref(); // не держит процесс живым сам по себе — например, в тестах
  return ()=> clearInterval(interval);
}

module.exports = {
  isEnabled, getTargetHour, getKeepCount, shouldRunNow, dateStr,
  runScheduledBackup, pruneOldAutoBackups, startBackupScheduler,
  AUTO_BACKUP_PREFIX,
};
