const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();

function archipelagoWithMembers(id){
  const arch = db.prepare('SELECT * FROM archipelagos WHERE id=?').get(id);
  if(!arch) return null;
  const members = db.prepare('SELECT id, name, icon_url, year_disappeared FROM allods WHERE archipelago_id=? ORDER BY name').all(id);
  return { ...arch, members };
}

// публично — список архипелагов текущего проекта, с составом
router.get('/archipelagos', (req, res)=>{
  const project = req.query.project || 'Аллоды Онлайн';
  const archs = db.prepare('SELECT * FROM archipelagos WHERE project=? ORDER BY name').all(project);
  const membersByArch = db.prepare('SELECT id, name, icon_url, year_disappeared, archipelago_id FROM allods WHERE archipelago_id IS NOT NULL').all()
    .reduce((acc, a)=>{ (acc[a.archipelago_id] ||= []).push(a); return acc; }, {});
  res.json(archs.map(a => ({ ...a, members: (membersByArch[a.id]||[]).sort((x,y)=>x.name.localeCompare(y.name,'ru')) })));
});

router.get('/archipelagos/:id', (req, res)=>{
  const arch = archipelagoWithMembers(req.params.id);
  if(!arch) return res.status(404).json({ error: 'Не найдено' });
  res.json(arch);
});

router.post('/archipelagos', requireAuth, (req, res)=>{
  const name = (req.body.name || '').trim();
  if(!name) return res.status(400).json({ error: 'Название архипелага не может быть пустым' });
  const project = req.body.project || 'Аллоды Онлайн';
  const id = 'arch_' + crypto.randomBytes(6).toString('hex');
  db.prepare('INSERT INTO archipelagos (id, project, name, created_at) VALUES (?,?,?,?)')
    .run(id, project, name, Date.now());
  res.json(archipelagoWithMembers(id));
});

router.patch('/archipelagos/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM archipelagos WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  if('name' in req.body){
    const name = (req.body.name || '').trim();
    if(!name) return res.status(400).json({ error: 'Название архипелага не может быть пустым' });
    db.prepare('UPDATE archipelagos SET name=? WHERE id=?').run(name, row.id);
  }
  res.json(archipelagoWithMembers(row.id));
});

// удаление архипелага НЕ удаляет острова — только открепляет (FK ON DELETE
// SET NULL сделает это сам, но явный UPDATE не помешает — на случай если у
// кого-то в базе foreign_keys=OFF на уровне соединения)
router.delete('/archipelagos/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM archipelagos WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  db.prepare('UPDATE allods SET archipelago_id=NULL WHERE archipelago_id=?').run(row.id);
  db.prepare('DELETE FROM archipelagos WHERE id=?').run(row.id);
  res.json({ ok: true });
});

// массовая привязка островов к архипелагу — используется после ctrl+клик
// выделения на карте. archipelagoId ИЛИ name (создать новый) — ровно один
// из двух.
router.post('/archipelagos/assign', requireAuth, (req, res)=>{
  const allodIds = Array.isArray(req.body.allodIds) ? req.body.allodIds.filter(Boolean) : [];
  if(!allodIds.length) return res.status(400).json({ error: 'Не выбрано ни одного острова' });

  let archipelagoId = (req.body.archipelagoId || '').trim();
  if(!archipelagoId){
    const name = (req.body.name || '').trim();
    if(!name) return res.status(400).json({ error: 'Укажите название архипелага или выберите существующий' });
    const firstAllod = db.prepare('SELECT project FROM allods WHERE id=?').get(allodIds[0]);
    const project = firstAllod ? firstAllod.project : 'Аллоды Онлайн';
    archipelagoId = 'arch_' + crypto.randomBytes(6).toString('hex');
    db.prepare('INSERT INTO archipelagos (id, project, name, created_at) VALUES (?,?,?,?)')
      .run(archipelagoId, project, name, Date.now());
  }else if(!db.prepare('SELECT id FROM archipelagos WHERE id=?').get(archipelagoId)){
    return res.status(404).json({ error: 'Архипелаг не найден' });
  }

  const placeholders = allodIds.map(()=>'?').join(',');
  const result = db.prepare(`UPDATE allods SET archipelago_id=? WHERE id IN (${placeholders})`).run(archipelagoId, ...allodIds);
  res.json({ archipelago: archipelagoWithMembers(archipelagoId), updated: result.changes });
});

// открепить один остров от архипелага (кнопка "×" в атласе/на странице острова)
router.post('/archipelagos/unassign', requireAuth, (req, res)=>{
  const allodId = (req.body.allodId || '').trim();
  if(!allodId) return res.status(400).json({ error: 'Не указан остров' });
  db.prepare('UPDATE allods SET archipelago_id=NULL WHERE id=?').run(allodId);
  res.json({ ok: true });
});

module.exports = router;
