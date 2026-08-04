const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('./auth');
const { upload, verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, deleteUploadedFile } = require('../upload');

const router = express.Router();

// публично — слой рисования на карте виден всем, управлять набором могут только вошедшие
router.get('/decorations', (req, res)=>{
  res.json(db.prepare('SELECT * FROM decoration_icons ORDER BY created_at ASC').all());
});

router.post('/decorations', requireAuth, upload.single('image'), verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, (req, res)=>{
  if(!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const name = (req.body.name || '').trim();
  if(!name){
    deleteUploadedFile('/uploads/' + req.file.filename);
    return res.status(400).json({ error: 'Название украшения не может быть пустым' });
  }
  const id = 'dec_' + crypto.randomBytes(6).toString('hex');
  const url = '/uploads/' + req.file.filename;
  db.prepare('INSERT INTO decoration_icons (id, name, url, created_at) VALUES (?,?,?,?)').run(id, name, url, Date.now());
  res.json(db.prepare('SELECT * FROM decoration_icons WHERE id=?').get(id));
});

router.delete('/decorations/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM decoration_icons WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  // штатный набор (dec_*) лежит в public/assets/decorations и раздаётся из
  // репозитория — удалять с диска нечего и не нужно (не /uploads/), в отличие
  // от иконок, добавленных редакторами через POST выше
  if(row.url.startsWith('/uploads/')) deleteUploadedFile(row.url);
  db.prepare('DELETE FROM decoration_icons WHERE id=?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
