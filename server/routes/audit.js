const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('./auth');

// Роадмап п.20: сам факт логирования бесполезен без способа его посмотреть —
// только чтение, только админ. limit ограничен сверху, чтобы случайный
// ?limit=1000000 не утянул всю таблицу в один ответ.
router.get('/', requireAdmin, (req, res)=>{
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json(rows.map(r => ({
    id: r.id,
    createdAt: r.created_at,
    actorId: r.actor_id,
    actorUsername: r.actor_username,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    targetLabel: r.target_label,
    details: r.details ? JSON.parse(r.details) : null,
  })));
});

module.exports = router;
