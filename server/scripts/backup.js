// Запуск: npm run backup — работает и при запущенном, и при остановленном сервере.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.ATLAS_DB_PATH || path.join(__dirname, '..', 'atlas.db');
const BACKUPS_DIR = process.env.ATLAS_BACKUPS_DIR || path.join(__dirname, '..', '..', 'backups');

if(!fs.existsSync(DB_PATH)){
  console.error('Файл базы не найден:', DB_PATH, '— сначала запустите сервер хотя бы раз.');
  process.exit(1);
}
if(!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

// база работает в режиме WAL: часть свежих записей может лежать в atlas.db-wal,
// а не в самом atlas.db. Открываем отдельное соединение и принудительно сбрасываем
// (checkpoint) их в основной файл перед копированием — иначе бэкап может быть неполным.
try{
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}catch(e){
  console.warn('Не удалось выполнить checkpoint перед копированием (продолжаю всё равно):', e.message);
}

const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const dest = path.join(BACKUPS_DIR, `atlas-backup-${stamp}.db`);
fs.copyFileSync(DB_PATH, dest);
console.log('Бэкап сохранён:', dest);
