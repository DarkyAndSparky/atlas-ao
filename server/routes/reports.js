const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('./auth');

// Единственный публичный write-эндпоинт на весь сайт — им может
// воспользоваться кто угодно без аккаунта, поэтому отдельный, гораздо более
// строгий лимитер поверх общего /api-лимитера (300/мин): 5 обращений за
// 10 минут с одного IP достаточно для настоящего человека, который
// заметил ошибку, и бесполезно для спам-скрипта.
const reportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.ATLAS_REPORT_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много обращений подряд — попробуйте позже.' },
});

router.post('/reports', reportLimiter, (req, res)=>{
  const message = (req.body.message || '').trim();
  if(!message) return res.status(400).json({ error: 'Опишите, что не так.' });
  if(message.length > 2000) return res.status(400).json({ error: 'Слишком длинное сообщение (макс. 2000 символов).' });
  const contact = (req.body.contact || '').trim().slice(0, 200) || null;
  let allodId = req.body.allodId || null;
  if(allodId){
    const exists = db.prepare('SELECT id FROM allods WHERE id=?').get(allodId);
    if(!exists) allodId = null; // остров могли удалить между открытием формы и отправкой — не роняем весь репорт из-за этого
  }
  const id = 'report_' + crypto.randomBytes(6).toString('hex');
  db.prepare('INSERT INTO reports (id, allod_id, message, contact, created_at) VALUES (?,?,?,?,?)')
    .run(id, allodId, message, contact, Date.now());
  res.json({ ok: true });
});

router.get('/reports', requireAdmin, (req, res)=>{
  const onlyOpen = req.query.all !== '1';
  const rows = db.prepare(
    `SELECT r.*, a.name as allod_name, a.slug as allod_slug FROM reports r
     LEFT JOIN allods a ON a.id = r.allod_id
     ${onlyOpen ? 'WHERE r.resolved = 0' : ''}
     ORDER BY r.created_at DESC LIMIT 200`
  ).all();
  res.json(rows.map(r=>({
    id: r.id, message: r.message, contact: r.contact, createdAt: r.created_at, resolved: !!r.resolved,
    allodId: r.allod_id, allodName: r.allod_name, allodSlug: r.allod_slug,
  })));
});

router.patch('/reports/:id', requireAdmin, (req, res)=>{
  const row = db.prepare('SELECT id FROM reports WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  if('resolved' in req.body){
    db.prepare('UPDATE reports SET resolved=? WHERE id=?').run(req.body.resolved ? 1 : 0, req.params.id);
  }
  res.json({ ok: true });
});

router.delete('/reports/:id', requireAdmin, (req, res)=>{
  db.prepare('DELETE FROM reports WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
