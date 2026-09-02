const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireProjectAccess } = require('./auth');
const { fullAllod, applyAllodFieldsUpdate } = require('./allods');

// Один черновик на остров (не на пользователя) — сознательное упрощение:
// если два редактора одновременно решат поработать над черновиком одного
// острова, второй перезапишет первого (последняя сохранённая версия
// побеждает). Это ниже по ставкам, чем конфликт на LIVE-полях (см.
// expectedRev в routes/allods.js) — черновик и так ещё не опубликован,
// ничего не потеряно необратимо, просто нужно будет пересогласовать
// текст между собой за пределами сайта. Полноценный per-user/conflict-
// aware черновик — избыточная сложность для этой задачи.

function draftRow(allodId){
  return db.prepare('SELECT * FROM allod_drafts WHERE allod_id=?').get(allodId);
}

router.get('/allods/:id/draft', requireAuth, (req, res)=>{
  const allod = db.prepare('SELECT id FROM allods WHERE id=?').get(req.params.id);
  if(!allod) return res.status(404).json({ error: 'Остров не найден' });
  const draft = draftRow(req.params.id);
  res.json(draft || null);
});

router.put('/allods/:id/draft', requireAuth, (req, res)=>{
  const allod = db.prepare('SELECT * FROM allods WHERE id=?').get(req.params.id);
  if(!allod) return res.status(404).json({ error: 'Остров не найден' });
  if(!requireProjectAccess(req, res, allod.project)) return;

  let draft = draftRow(req.params.id);
  if(!draft){
    // Первое редактирование "в режиме черновика" для этого острова — заводим
    // черновик, полной копией текущих live-значений (не только тех полей,
    // что сейчас меняются), чтобы рендер черновика не требовал слияния с
    // live для отсутствующих полей — draft.* самодостаточен.
    draft = { allod_id: allod.id, name: allod.name, description: allod.description, history: allod.history };
  }
  const next = { ...draft };
  ['name','description','history'].forEach(f=>{ if(f in req.body) next[f] = String(req.body[f] ?? ''); });
  if(!next.name.trim()) return res.status(400).json({ error: 'Название не может быть пустым.' });

  db.prepare(`
    INSERT INTO allod_drafts (allod_id, name, description, history, updated_at, updated_by)
    VALUES (@allod_id, @name, @description, @history, @updated_at, @updated_by)
    ON CONFLICT(allod_id) DO UPDATE SET
      name=excluded.name, description=excluded.description, history=excluded.history,
      updated_at=excluded.updated_at, updated_by=excluded.updated_by
  `).run({ ...next, updated_at: Date.now(), updated_by: req.session.username || null });

  res.json(draftRow(req.params.id));
});

router.delete('/allods/:id/draft', requireAuth, (req, res)=>{
  const allod = db.prepare('SELECT project FROM allods WHERE id=?').get(req.params.id);
  if(!allod) return res.status(404).json({ error: 'Остров не найден' });
  if(!requireProjectAccess(req, res, allod.project)) return;
  db.prepare('DELETE FROM allod_drafts WHERE allod_id=?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/allods/:id/draft/publish', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM allods WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Остров не найден' });
  if(!requireProjectAccess(req, res, row.project)) return;
  const draft = draftRow(req.params.id);
  if(!draft) return res.status(404).json({ error: 'Черновика нет — нечего публиковать.' });

  // Публикуем тем же путём кода, что и обычный PATCH /allods/:id — снимок
  // ДО правки в allod_snapshots, инкремент rev. Только реально изменившиеся
  // относительно live поля попадают в updates (пустой updates — валидный
  // случай: черновик мог совпасть с live после чужой правки, снимок тогда
  // не нужен).
  const updates = {};
  ['name','description','history'].forEach(f=>{ if(draft[f] !== row[f]) updates[f] = draft[f]; });
  const published = Object.keys(updates).length
    ? applyAllodFieldsUpdate(row, updates, req.session.username || null)
    : fullAllod(row);

  db.prepare('DELETE FROM allod_drafts WHERE allod_id=?').run(req.params.id);
  res.json(published);
});

module.exports = router;
