const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();

function validateBody(body, { partial=false } = {}){
  const out = {};
  if('title' in body || !partial){
    const title = (body.title || '').trim();
    if(!title) return { error: 'Название события не может быть пустым' };
    out.title = title;
  }
  if('description' in body || !partial) out.description = (body.description || '').trim();
  if('year' in body || !partial){
    const year = Number(body.year);
    if(!Number.isInteger(year)) return { error: 'Год должен быть целым числом' };
    out.year = year;
  }
  if('sortOrder' in body){
    const sortOrder = Number(body.sortOrder);
    out.sort_order = Number.isInteger(sortOrder) ? sortOrder : 0;
  }
  return { value: out };
}

// хронология мира текущего проекта (scope='world') — публично
router.get('/timeline/world', (req, res)=>{
  const project = req.query.project || 'Аллоды Онлайн';
  const rows = db.prepare(
    "SELECT * FROM timeline_events WHERE scope='world' AND project=? ORDER BY year ASC, sort_order ASC, created_at ASC"
  ).all(project);
  res.json(rows);
});

// хронология конкретного аллода — публично
router.get('/timeline/allod/:allodId', (req, res)=>{
  const rows = db.prepare(
    "SELECT * FROM timeline_events WHERE scope='allod' AND allod_id=? ORDER BY year ASC, sort_order ASC, created_at ASC"
  ).all(req.params.allodId);
  res.json(rows);
});

router.post('/timeline', requireAuth, (req, res)=>{
  const scope = req.body.scope === 'allod' ? 'allod' : 'world';
  let allodId = null;
  if(scope === 'allod'){
    allodId = (req.body.allodId || '').trim();
    const allod = db.prepare('SELECT id, project FROM allods WHERE id=?').get(allodId);
    if(!allod) return res.status(400).json({ error: 'Аллод не найден' });
  }
  const { value, error } = validateBody(req.body);
  if(error) return res.status(400).json({ error });
  const project = scope === 'allod'
    ? db.prepare('SELECT project FROM allods WHERE id=?').get(allodId).project || 'Аллоды Онлайн'
    : (req.body.project || 'Аллоды Онлайн');
  const id = 'evt_' + crypto.randomBytes(6).toString('hex');
  db.prepare(`INSERT INTO timeline_events (id, project, scope, allod_id, year, sort_order, title, description, created_at)
    VALUES (@id, @project, @scope, @allod_id, @year, @sort_order, @title, @description, @created_at)`)
    .run({ id, project, scope, allod_id: allodId, sort_order: 0, created_at: Date.now(), ...value });
  res.json(db.prepare('SELECT * FROM timeline_events WHERE id=?').get(id));
});

router.patch('/timeline/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM timeline_events WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  const { value, error } = validateBody(req.body, { partial: true });
  if(error) return res.status(400).json({ error });
  const keys = Object.keys(value);
  if(keys.length === 0) return res.json(row);
  db.prepare(`UPDATE timeline_events SET ${keys.map(k=>`${k}=@${k}`).join(', ')} WHERE id=@id`)
    .run({ ...value, id: row.id });
  res.json(db.prepare('SELECT * FROM timeline_events WHERE id=?').get(row.id));
});

router.delete('/timeline/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM timeline_events WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  db.prepare('DELETE FROM timeline_events WHERE id=?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
