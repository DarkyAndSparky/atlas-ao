const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth } = require('./auth');

const DB_PATH = process.env.ATLAS_DB_PATH || path.join(__dirname, '..', 'atlas.db');
const BACKUPS_DIR = process.env.ATLAS_BACKUPS_DIR || path.join(__dirname, '..', '..', 'backups');
if(!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const router = express.Router();

// скачать текущий файл базы целиком — требует входа, т.к. внутри лежит и хэш пароля
router.get('/download', requireAuth, (req, res)=>{
  if(!fs.existsSync(DB_PATH)) return res.status(404).json({ error: 'Файл базы не найден' });
  try{
    // база работает в режиме WAL: часть свежих записей может ещё лежать в
    // atlas.db-wal, а не в самом atlas.db. Принудительно сбрасываем их в
    // основной файл перед копированием, иначе бэкап может оказаться неполным.
    require('../db').exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }catch(e){ console.warn('Не удалось выполнить checkpoint перед бэкапом:', e.message); }
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  res.download(DB_PATH, `atlas-backup-${stamp}.db`);
});

// загрузить .db файл и заменить текущую базу им
// ВАЖНО: после успешной загрузки сервер завершает процесс — его нужно перезапустить
// вручную (start.sh / start.bat), чтобы открыть базу заново. Это осознанное
// упрощение для локального однопользовательского инструмента: избегаем гонок
// с уже открытым соединением SQLite.
const memStorage = multer.memoryStorage();
const uploadDb = multer({ storage: memStorage, limits: { fileSize: 200*1024*1024 } });

router.post('/restore', requireAuth, uploadDb.single('database'), (req, res)=>{
  if(!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const header = req.file.buffer.slice(0, 16).toString('utf-8');
  if(!header.startsWith('SQLite format 3')){
    return res.status(400).json({ error: 'Файл не похож на базу SQLite (atlas.db).' });
  }
  // сохраняем копию текущей базы перед перезаписью — на всякий случай
  if(fs.existsSync(DB_PATH)){
    try{ require('../db').exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    catch(e){ console.warn('Не удалось выполнить checkpoint перед pre-restore снимком:', e.message); }
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    fs.copyFileSync(DB_PATH, path.join(BACKUPS_DIR, `pre-restore-${stamp}.db`));
  }
  const db = require('../db');
  try{ db.close(); }catch(e){ /* уже могла быть закрыта */ }
  // после db.close() WAL должен был смержиться в основной файл сам, но на
  // всякий случай явно подчищаем sidecar-файлы — иначе теоретически возможна
  // путаница, если новая база откроется с чужим -wal/-shm рядом
  for(const ext of ['-wal', '-shm']){
    try{ fs.unlinkSync(DB_PATH + ext); }catch(e){ /* файла и не было — это нормально */ }
  }
  fs.writeFileSync(DB_PATH, req.file.buffer);
  res.json({ ok: true, message: 'База восстановлена. Перезапустите сервер (Ctrl+C, затем снова node server.js / start.sh / start.bat).' });
  // сервер намеренно завершает процесс, чтобы гарантированно открыть восстановленный
  // файл с нуля (никаких гонок со старым соединением/кэшами) — в Docker-режиме
  // restart:unless-stopped поднимет контейнер обратно сам, вне Docker это описано
  // в ответе выше как "перезапустите вручную". ATLAS_TEST_NO_EXIT — только для
  // тестов, чтобы проверить сам факт записи файла, не убивая тестовый процесс.
  if(process.env.ATLAS_TEST_NO_EXIT !== '1'){
    setTimeout(()=> process.exit(0), 300);
  }
});

module.exports = router;
