const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();

// entity_type сущностей, к которым можно привязать источник — расширяется
// по мере появления новых разделов (например, 'event' для хронологии).
// Не CHECK-констрейнт в БД по той же причине, что и у map_annotations.type:
// список нельзя расширить ALTER-ом на лету для уже существующих баз.
const ENTITY_TYPES = new Set(['allod', 'location']);

function sourceWithRefs(id){
  const source = db.prepare('SELECT * FROM sources WHERE id=?').get(id);
  if(!source) return null;
  const refs = db.prepare('SELECT * FROM source_refs WHERE source_id=? ORDER BY created_at ASC').all(id);
  return { ...source, refs };
}

// публично — источники видны всем читателям вики, редактировать может
// только вошедший. Отдаём сразу со всеми привязками (refs) — их всегда
// немного (десятки, не тысячи), отдельный запрос на каждый источник был бы
// избыточным для страницы /sources, где нужны все сразу.
router.get('/sources', (req, res)=>{
  const sources = db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();
  const refsBySource = db.prepare('SELECT * FROM source_refs ORDER BY created_at ASC').all()
    .reduce((acc, r)=>{ (acc[r.source_id] ||= []).push(r); return acc; }, {});
  res.json(sources.map(s => ({ ...s, refs: refsBySource[s.id] || [] })));
});

// источники, привязанные к конкретной сущности (блок "Источники" на
// странице аллода/локации) — без разбора всего глобального списка на клиенте
router.get('/sources/for/:entityType/:entityId', (req, res)=>{
  const { entityType, entityId } = req.params;
  const refs = db.prepare('SELECT * FROM source_refs WHERE entity_type=? AND entity_id=? ORDER BY created_at ASC').all(entityType, entityId);
  if(refs.length === 0) return res.json([]);
  const ids = [...new Set(refs.map(r=>r.source_id))];
  const placeholders = ids.map(()=>'?').join(',');
  const sources = db.prepare(`SELECT * FROM sources WHERE id IN (${placeholders})`).all(...ids);
  const byId = Object.fromEntries(sources.map(s=>[s.id, s]));
  res.json(refs.map(r => ({ ref: r, source: byId[r.source_id] })).filter(x=>x.source));
});

router.post('/sources', requireAuth, (req, res)=>{
  const title = (req.body.title || '').trim();
  if(!title) return res.status(400).json({ error: 'Название источника не может быть пустым' });
  const url = (req.body.url || '').trim() || null;
  if(url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Ссылка должна начинаться с http:// или https://' });
  const note = (req.body.note || '').trim();
  const id = 'src_' + crypto.randomBytes(6).toString('hex');
  db.prepare('INSERT INTO sources (id, title, url, note, created_at) VALUES (?,?,?,?,?)')
    .run(id, title, url, note, Date.now());
  res.json(sourceWithRefs(id));
});

router.patch('/sources/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM sources WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  const updates = {};
  if('title' in req.body){
    const title = (req.body.title || '').trim();
    if(!title) return res.status(400).json({ error: 'Название источника не может быть пустым' });
    updates.title = title;
  }
  if('url' in req.body){
    const url = (req.body.url || '').trim() || null;
    if(url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Ссылка должна начинаться с http:// или https://' });
    updates.url = url;
  }
  if('note' in req.body) updates.note = (req.body.note || '').trim();
  const keys = Object.keys(updates);
  if(keys.length === 0) return res.json(sourceWithRefs(row.id));
  db.prepare(`UPDATE sources SET ${keys.map(k=>`${k}=@${k}`).join(', ')} WHERE id=@id`)
    .run({ ...updates, id: row.id });
  res.json(sourceWithRefs(row.id));
});

router.delete('/sources/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM sources WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  db.prepare('DELETE FROM sources WHERE id=?').run(row.id); // source_refs удалятся каскадом
  res.json({ ok: true });
});

// привязать источник (уже существующий) к сущности — со страницы аллода:
// "добавить существующий источник" или "создать новый и сразу привязать"
// (клиент сначала создаёт через POST /sources, затем зовёт это)
router.post('/source-refs', requireAuth, (req, res)=>{
  const sourceId = (req.body.sourceId || '').trim();
  const entityType = (req.body.entityType || '').trim();
  const entityId = (req.body.entityId || '').trim();
  if(!ENTITY_TYPES.has(entityType)) return res.status(400).json({ error: 'Неизвестный тип сущности' });
  if(!entityId) return res.status(400).json({ error: 'Не указана сущность' });
  const source = db.prepare('SELECT * FROM sources WHERE id=?').get(sourceId);
  if(!source) return res.status(404).json({ error: 'Источник не найден' });
  const note = (req.body.note || '').trim();
  const id = 'sref_' + crypto.randomBytes(6).toString('hex');
  db.prepare('INSERT INTO source_refs (id, source_id, entity_type, entity_id, note, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, source.id, entityType, entityId, note, Date.now());
  res.json(db.prepare('SELECT * FROM source_refs WHERE id=?').get(id));
});

router.patch('/source-refs/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM source_refs WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  if('note' in req.body){
    db.prepare('UPDATE source_refs SET note=? WHERE id=?').run((req.body.note || '').trim(), row.id);
  }
  res.json(db.prepare('SELECT * FROM source_refs WHERE id=?').get(row.id));
});

router.delete('/source-refs/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM source_refs WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  db.prepare('DELETE FROM source_refs WHERE id=?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
