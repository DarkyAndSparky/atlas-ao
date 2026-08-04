const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('./auth');
const { upload, verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, deleteUploadedFile } = require('../upload');

const router = express.Router();

// см. подробный комментарий в routes/auth.js: SQLite COLLATE NOCASE не
// работает для кириллицы, регистронезависимое сравнение нужно делать в JS
function findFactionIcon(faction){
  const target = faction.toLowerCase();
  return db.prepare('SELECT * FROM faction_icons').all().find(f => f.faction.toLowerCase() === target);
}

// публично — иконки фракций видны всем на страницах островов/в вики, управлять — только вошедшим
router.get('/factions', (req, res)=>{
  res.json(db.prepare('SELECT * FROM faction_icons ORDER BY faction ASC').all());
});

router.post('/factions', requireAuth, upload.single('image'), verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, (req, res)=>{
  if(!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const faction = (req.body.faction || '').trim();
  if(!faction){
    deleteUploadedFile('/uploads/' + req.file.filename);
    return res.status(400).json({ error: 'Название фракции не может быть пустым' });
  }
  const existing = findFactionIcon(faction);
  if(existing){
    deleteUploadedFile('/uploads/' + req.file.filename);
    return res.status(409).json({ error: 'Для этой фракции иконка уже есть — удалите старую или отредактируйте её.' });
  }
  const id = 'fac_' + crypto.randomBytes(6).toString('hex');
  const url = '/uploads/' + req.file.filename;
  db.prepare('INSERT INTO faction_icons (id, faction, icon_url, created_at) VALUES (?,?,?,?)').run(id, faction, url, Date.now());
  res.json(db.prepare('SELECT * FROM faction_icons WHERE id=?').get(id));
});

// смена картинки у уже существующей записи (оставляя то же название фракции)
router.post('/factions/:id/icon', requireAuth, upload.single('image'), verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, (req, res)=>{
  const row = db.prepare('SELECT * FROM faction_icons WHERE id=?').get(req.params.id);
  if(!row){
    if(req.file) deleteUploadedFile('/uploads/' + req.file.filename);
    return res.status(404).json({ error: 'Не найдено' });
  }
  if(!req.file) return res.status(400).json({ error: 'Файл не получен' });
  if(row.icon_url.startsWith('/uploads/')) deleteUploadedFile(row.icon_url);
  const url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE faction_icons SET icon_url=? WHERE id=?').run(url, row.id);
  res.json(db.prepare('SELECT * FROM faction_icons WHERE id=?').get(row.id));
});

// переименование (какую фракцию обозначает иконка) без замены картинки
router.patch('/factions/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM faction_icons WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  const faction = (req.body.faction || '').trim();
  if(!faction) return res.status(400).json({ error: 'Название фракции не может быть пустым' });
  const dup = findFactionIcon(faction);
  if(dup && dup.id !== row.id) return res.status(409).json({ error: 'Для этой фракции иконка уже есть.' });
  db.prepare('UPDATE faction_icons SET faction=? WHERE id=?').run(faction, row.id);
  res.json(db.prepare('SELECT * FROM faction_icons WHERE id=?').get(row.id));
});

router.delete('/factions/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM faction_icons WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  // штатный набор (fac_*) лежит в public/assets/factions и раздаётся из
  // репозитория — файл не трогаем, в отличие от иконок, загруженных редакторами
  if(row.icon_url.startsWith('/uploads/')) deleteUploadedFile(row.icon_url);
  db.prepare('DELETE FROM faction_icons WHERE id=?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
