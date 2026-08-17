const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { requireAdmin } = require('./auth');
const { UPLOAD_DIR } = require('../upload');

const DB_PATH = process.env.ATLAS_DB_PATH || path.join(__dirname, '..', 'atlas.db');
const BACKUPS_DIR = process.env.ATLAS_BACKUPS_DIR || path.join(__dirname, '..', '..', 'backups');
if(!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const router = express.Router();

// скачать текущий файл базы целиком — требует входа, т.к. внутри лежит и хэш пароля
router.get('/download', requireAdmin, (req, res)=>{
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

router.post('/restore', requireAdmin, uploadDb.single('database'), (req, res)=>{
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

// Полный архив сайта: БД + все загруженные файлы одним .zip — в отличие от
// /download (только .db), это то, что реально нужно при переезде на новую
// машину. Без uploads/ восстановленная база ссылается на картинки,
// которых физически нет — резервная копия только БД для миграции неполна.
router.get('/download-full', requireAdmin, (req, res)=>{
  if(!fs.existsSync(DB_PATH)) return res.status(404).json({ error: 'Файл базы не найден' });
  try{
    require('../db').exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }catch(e){ console.warn('Не удалось выполнить checkpoint перед полным бэкапом:', e.message); }

  const zip = new AdmZip();
  zip.addLocalFile(DB_PATH, '', 'atlas.db');
  if(fs.existsSync(UPLOAD_DIR)){
    zip.addLocalFolder(UPLOAD_DIR, 'uploads');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const buffer = zip.toBuffer();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="atlas-full-backup-${stamp}.zip"`);
  res.send(buffer);
});

// восстановление из полного архива (.zip с atlas.db внутри и папкой uploads/) —
// тот же принцип осторожности, что и в /restore: снимок текущей базы перед
// перезаписью, явный рестарт процесса после успеха
const memStorageZip = multer.memoryStorage();
const uploadZip = multer({ storage: memStorageZip, limits: { fileSize: 500*1024*1024 } });

router.post('/restore-full', requireAdmin, uploadZip.single('archive'), (req, res)=>{
  if(!req.file) return res.status(400).json({ error: 'Файл не получен' });

  let zip;
  try{ zip = new AdmZip(req.file.buffer); }
  catch(e){ return res.status(400).json({ error: 'Файл не похож на .zip-архив.' }); }

  const entries = zip.getEntries();
  const dbEntry = entries.find(e => e.entryName === 'atlas.db');
  if(!dbEntry) return res.status(400).json({ error: 'В архиве не найден atlas.db — это не полный бэкап Атласа.' });
  const dbBuffer = dbEntry.getData();
  const header = dbBuffer.slice(0, 16).toString('utf-8');
  if(!header.startsWith('SQLite format 3')){
    return res.status(400).json({ error: 'atlas.db внутри архива повреждён или не является базой SQLite.' });
  }

  // снимок текущего состояния (БД + uploads) перед перезаписью — на всякий случай,
  // тем же способом, что и обычный /restore, плюс копия текущей папки uploads
  if(fs.existsSync(DB_PATH)){
    try{ require('../db').exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    catch(e){ console.warn('Не удалось выполнить checkpoint перед pre-restore снимком:', e.message); }
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    fs.copyFileSync(DB_PATH, path.join(BACKUPS_DIR, `pre-restore-${stamp}.db`));
    if(fs.existsSync(UPLOAD_DIR)){
      const preRestoreUploadsZip = new AdmZip();
      preRestoreUploadsZip.addLocalFolder(UPLOAD_DIR, 'uploads');
      preRestoreUploadsZip.writeZip(path.join(BACKUPS_DIR, `pre-restore-uploads-${stamp}.zip`));
    }
  }

  const db = require('../db');
  try{ db.close(); }catch(e){ /* уже могла быть закрыта */ }
  for(const ext of ['-wal', '-shm']){
    try{ fs.unlinkSync(DB_PATH + ext); }catch(e){ /* файла и не было — это нормально */ }
  }
  fs.writeFileSync(DB_PATH, dbBuffer);

  // uploads/: полностью заменяем содержимым архива — старые файлы, которых
  // в архиве нет, удаляются, иначе после восстановления на диске накопится
  // мусор от файлов, удалённых уже после того бэкапа, из которого архив
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const uploadEntries = entries.filter(e => e.entryName.startsWith('uploads/') && !e.isDirectory);
  let restoredCount = 0;
  for(const entry of uploadEntries){
    const relPath = entry.entryName.slice('uploads/'.length);
    // защита от zip-slip: имя файла внутри архива не должно уметь выйти за
    // пределы uploads/ через ../ — на всякий случай, хотя архив создаём сами
    if(relPath.includes('..') || path.isAbsolute(relPath)) continue;
    const destPath = path.join(UPLOAD_DIR, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, entry.getData());
    restoredCount++;
  }

  res.json({
    ok: true,
    uploadsRestored: restoredCount,
    message: 'Сайт восстановлен из полного архива (база + файлы). Перезапустите сервер (Ctrl+C, затем снова node server.js / start.sh / start.bat).',
  });
  if(process.env.ATLAS_TEST_NO_EXIT !== '1'){
    setTimeout(()=> process.exit(0), 300);
  }
});

module.exports = router;
