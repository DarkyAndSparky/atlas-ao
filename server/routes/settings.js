const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const { upload, verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, deleteUploadedFile } = require('../upload');

const router = express.Router();

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function getSettings(){
  return db.prepare('SELECT * FROM site_settings WHERE id=1').get();
}

// публично — читает вся страница на загрузке, чтобы применить брендинг
router.get('/', (req, res)=>{
  res.json(getSettings());
});

router.patch('/', requireAuth, (req, res)=>{
  const updates = {};
  if('title' in req.body){
    const title = (req.body.title || '').toString().trim();
    if(!title) return res.status(400).json({ error: 'Название не может быть пустым' });
    if(title.length > 60) return res.status(400).json({ error: 'Название слишком длинное (максимум 60 символов)' });
    updates.title = title;
  }
  if('accent_light' in req.body){
    if(!HEX_COLOR_RE.test(req.body.accent_light)) return res.status(400).json({ error: 'accent_light должен быть цветом вида #rrggbb' });
    updates.accent_light = req.body.accent_light;
  }
  if('accent_dark' in req.body){
    if(!HEX_COLOR_RE.test(req.body.accent_dark)) return res.status(400).json({ error: 'accent_dark должен быть цветом вида #rrggbb' });
    updates.accent_dark = req.body.accent_dark;
  }
  if(Object.keys(updates).length === 0) return res.json(getSettings());

  const setSql = Object.keys(updates).map(k=>`${k}=@${k}`).join(', ');
  db.prepare(`UPDATE site_settings SET ${setSql} WHERE id=1`).run(updates);
  res.json(getSettings());
});

router.post('/logo', requireAuth, upload.single('logo'), verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, (req, res)=>{
  if(!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const current = getSettings();
  if(current.logo_url) deleteUploadedFile(current.logo_url);
  const url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE site_settings SET logo_url=? WHERE id=1').run(url);
  res.json(getSettings());
});

router.delete('/logo', requireAuth, (req, res)=>{
  const current = getSettings();
  if(current.logo_url) deleteUploadedFile(current.logo_url);
  db.prepare('UPDATE site_settings SET logo_url=NULL WHERE id=1').run();
  res.json(getSettings());
});

module.exports = router;
