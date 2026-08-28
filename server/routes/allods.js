const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { upload, verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, deleteUploadedFile } = require('../upload');

const router = express.Router();

function fullAllod(row){
  const locations = db.prepare('SELECT * FROM locations WHERE allod_id=? ORDER BY sort_order').all(row.id)
    .map(loc=>({
      ...loc,
      gallery: db.prepare("SELECT id, url, caption FROM gallery WHERE owner_type='location' AND owner_id=? ORDER BY sort_order").all(loc.id)
    }));
  const gallery = db.prepare("SELECT id, url, caption FROM gallery WHERE owner_type='allod' AND owner_id=? ORDER BY sort_order").all(row.id);
  return { ...row, hasMap: !!row.hasMap, locations, gallery };
}

/* ---------------- allods ---------------- */
router.get('/allods', (req, res)=>{
  const rows = db.prepare('SELECT * FROM allods').all();
  res.json(rows.map(fullAllod));
});

router.get('/allods/:id', (req, res)=>{
  const row = db.prepare('SELECT * FROM allods WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  res.json(fullAllod(row));
});

router.post('/allods', requireAuth, (req, res)=>{
  const name = (req.body.name||'').trim();
  if(!name) return res.status(400).json({ error: 'Название обязательно' });
  const id = 'allod_' + crypto.randomBytes(6).toString('hex');
  const { uniqueSlug } = require('../slug');
  const existingSlugs = new Set(
    db.prepare("SELECT slug FROM allods WHERE slug IS NOT NULL AND TRIM(slug) <> ''").all().map(r=>r.slug)
  );
  const slug = uniqueSlug(name, existingSlugs);
  db.prepare(`INSERT INTO allods (id, name, slug, project, description, history)
    VALUES (@id, @name, @slug, @project, '', '')`)
    .run({ id, name, slug, project: req.body.project || 'Аллоды Онлайн' });
  res.json(fullAllod(db.prepare('SELECT * FROM allods WHERE id=?').get(id)));
});

router.delete('/allods/:id', requireAuth, (req, res)=>{
  const allod = db.prepare('SELECT * FROM allods WHERE id=?').get(req.params.id);
  if(!allod) return res.status(404).json({ error: 'Не найдено' });
  const locIds = db.prepare('SELECT id FROM locations WHERE allod_id=?').all(allod.id).map(l=>l.id);
  const gals = db.prepare("SELECT url FROM gallery WHERE (owner_type='allod' AND owner_id=?) OR (owner_type='location' AND owner_id IN (" + (locIds.map(()=>'?').join(',') || 'NULL') + "))")
    .all(allod.id, ...locIds);
  gals.forEach(g=> deleteUploadedFile(g.url));
  // icon_url/location_map_url живут прямо в таблице allods, а не в gallery —
  // выборка выше их не находит, поэтому чистим отдельно явно
  if(allod.icon_url && allod.icon_url.startsWith('/uploads/')) deleteUploadedFile(allod.icon_url);
  if(allod.location_map_url && allod.location_map_url.startsWith('/uploads/')) deleteUploadedFile(allod.location_map_url);
  db.prepare("DELETE FROM gallery WHERE owner_type='allod' AND owner_id=?").run(allod.id);
  if(locIds.length){
    const placeholders = locIds.map(()=>'?').join(',');
    db.prepare(`DELETE FROM gallery WHERE owner_type='location' AND owner_id IN (${placeholders})`).run(...locIds);
  }
  db.prepare('DELETE FROM locations WHERE allod_id=?').run(allod.id); // на всякий случай, хоть FK и каскадит
  // source_refs не через FK на allods/locations (entity_type/entity_id —
  // не настоящий внешний ключ, см. комментарий в db.js), поэтому каскад
  // руками, как и с gallery выше
  db.prepare("DELETE FROM source_refs WHERE entity_type='allod' AND entity_id=?").run(allod.id);
  if(locIds.length){
    const locPlaceholders = locIds.map(()=>'?').join(',');
    db.prepare(`DELETE FROM source_refs WHERE entity_type='location' AND entity_id IN (${locPlaceholders})`).run(...locIds);
  }
  db.prepare('DELETE FROM allods WHERE id=?').run(allod.id);
  res.json({ ok: true });
});

const ALLOD_FIELDS = ['name','climate','size','holder','faction','hasMap','type','category','plot','expansion','archipelago','description','history','mapX','mapY','location_map_url','icon_url','project','year_appeared','year_disappeared'];
router.patch('/allods/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM allods WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  if('name' in req.body && !(req.body.name||'').trim()){
    return res.status(400).json({ error: 'Название острова не может быть пустым.' });
  }
  // year_appeared/year_disappeared — целое число или null (сбросить статус
  // "уничтожен"/убрать год появления). "Уничтожен" сейчас — это просто факт
  // того, что year_disappeared задан; когда появится слайдер динамики, он
  // будет сравнивать со своим текущим годом вместо голого наличия значения.
  for(const f of ['year_appeared','year_disappeared']){
    if(f in req.body && req.body[f] !== null && req.body[f] !== ''){
      const n = Number(req.body[f]);
      if(!Number.isInteger(n)) return res.status(400).json({ error: 'Год должен быть целым числом' });
    }
  }
  const updates = {};
  ALLOD_FIELDS.forEach(f=>{ if(f in req.body) updates[f] = req.body[f]; });
  if('name' in updates) updates.name = updates.name.trim();
  for(const f of ['year_appeared','year_disappeared']){
    if(f in updates) updates[f] = (updates[f] === '' || updates[f] === undefined) ? null : (updates[f]===null ? null : Number(updates[f]));
  }
  if(Object.keys(updates).length===0) return res.json(fullAllod(row));
  // снимок ДО применения изменений — если правка что-то случайно стёрла,
  // именно предыдущее состояние (а не то, что получилось после) даёт шанс
  // восстановить потерянное. Снимаем только когда реально что-то меняется
  // (проверка выше) — иначе история заполнялась бы пустыми "изменениями".
  db.prepare('INSERT INTO allod_snapshots (id, allod_id, allod_name, snapshot_json, changed_by, created_at) VALUES (?,?,?,?,?,?)')
    .run('snap_' + crypto.randomBytes(6).toString('hex'), row.id, row.name, JSON.stringify(row), req.session.username || null, Date.now());
  if('hasMap' in updates) updates.hasMap = updates.hasMap ? 1 : 0;
  // icon_url/location_map_url можно сменить на другую ссылку или очистить —
  // если старое значение указывало на локально загруженный файл (а не внешний
  // URL) и меняется на что-то другое, старый файл иначе остался бы мусором
  // в uploads/ навсегда
  ['icon_url','location_map_url'].forEach(f=>{
    if(f in updates && row[f] && row[f].startsWith('/uploads/') && row[f] !== updates[f]){
      deleteUploadedFile(row[f]);
    }
  });
  const setSql = Object.keys(updates).map(k=>`${k}=@${k}`).join(', ');
  // better-sqlite3 бросает ошибку на лишние именованные параметры в .run(),
  // поэтому в объект биндинга кладём ровно те ключи, что есть в setSql, плюс id.
  db.prepare(`UPDATE allods SET ${setSql} WHERE id=@id`).run({ ...updates, id: req.params.id });
  res.json(fullAllod(db.prepare('SELECT * FROM allods WHERE id=?').get(req.params.id)));
});

// список снимков — без snapshot_json (может быть увесистым при длинной
// истории/истории острова с большим description) — только то, что нужно
// для списка "кто/когда"; сам снимок подгружается отдельно по клику
// "посмотреть" (см. ниже)
router.get('/allods/:id/history', requireAuth, (req, res)=>{
  const rows = db.prepare(
    'SELECT id, changed_by, created_at FROM allod_snapshots WHERE allod_id=? ORDER BY created_at DESC'
  ).all(req.params.id);
  res.json(rows);
});

router.get('/allod-snapshots/:snapshotId', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM allod_snapshots WHERE id=?').get(req.params.snapshotId);
  if(!row) return res.status(404).json({ error: 'Снимок не найден' });
  let snapshot;
  try{ snapshot = JSON.parse(row.snapshot_json); }
  catch(e){ return res.status(500).json({ error: 'Снимок повреждён' }); }
  res.json({ id: row.id, allodId: row.allod_id, allodName: row.allod_name, changedBy: row.changed_by, createdAt: row.created_at, snapshot });
});

// Общий журнал изменений по всему сайту — та же таблица allod_snapshots
// (она уже общая на все острова, allod_name в ней денормализован, поэтому
// join с allods не нужен даже для уже удалённых островов). Курсорная
// пагинация по created_at, не offset — список постоянно растёт, offset
// «плывёт» при новых правках между запросами страниц.
router.get('/recent-changes', requireAuth, (req, res)=>{
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const before = req.query.before ? Number(req.query.before) : null;
  const rows = before && Number.isFinite(before)
    ? db.prepare('SELECT id, allod_id, allod_name, changed_by, created_at FROM allod_snapshots WHERE created_at < ? ORDER BY created_at DESC LIMIT ?').all(before, limit)
    : db.prepare('SELECT id, allod_id, allod_name, changed_by, created_at FROM allod_snapshots ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json(rows);
});

/* ---------------- locations ---------------- */
router.post('/allods/:id/locations', requireAuth, (req, res)=>{
  const allod = db.prepare('SELECT id FROM allods WHERE id=?').get(req.params.id);
  if(!allod) return res.status(404).json({ error: 'Аллод не найден' });
  const name = (req.body.name||'').trim();
  if(!name) return res.status(400).json({ error: 'Название обязательно' });
  const id = 'loc_' + crypto.randomBytes(6).toString('hex');
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM locations WHERE allod_id=?').get(allod.id).m;
  db.prepare('INSERT INTO locations (id, allod_id, name, description, sort_order) VALUES (?,?,?,?,?)')
    .run(id, allod.id, name, '', maxSort+1);
  res.json(fullAllod(db.prepare('SELECT * FROM allods WHERE id=?').get(allod.id)));
});

router.patch('/locations/:id', requireAuth, (req, res)=>{
  const loc = db.prepare('SELECT * FROM locations WHERE id=?').get(req.params.id);
  if(!loc) return res.status(404).json({ error: 'Локация не найдена' });
  if('name' in req.body && !(req.body.name||'').trim()){
    return res.status(400).json({ error: 'Название локации не может быть пустым.' });
  }
  const fields = ['name','description','mapX','mapY'];
  const updates = {};
  fields.forEach(f=>{ if(f in req.body) updates[f]=req.body[f]; });
  if('name' in updates) updates.name = updates.name.trim();
  if(Object.keys(updates).length){
    const setSql = Object.keys(updates).map(k=>`${k}=@${k}`).join(', ');
    db.prepare(`UPDATE locations SET ${setSql} WHERE id=@id`).run({ ...updates, id: loc.id });
  }
  res.json(fullAllod(db.prepare('SELECT * FROM allods WHERE id=?').get(loc.allod_id)));
});

router.post('/allods/:id/locations/reorder', requireAuth, (req, res)=>{
  const allod = db.prepare('SELECT id FROM allods WHERE id=?').get(req.params.id);
  if(!allod) return res.status(404).json({ error: 'Аллод не найден' });
  const order = req.body.order; // массив id локаций в нужном порядке
  if(!Array.isArray(order)) return res.status(400).json({ error: 'Ожидался массив id локаций' });
  const upd = db.prepare('UPDATE locations SET sort_order=? WHERE id=? AND allod_id=?');
  const tx = db.transaction(()=>{
    order.forEach((locId, i)=> upd.run(i, locId, allod.id));
  });
  tx();
  res.json(fullAllod(db.prepare('SELECT * FROM allods WHERE id=?').get(allod.id)));
});

router.delete('/locations/:id', requireAuth, (req, res)=>{
  const loc = db.prepare('SELECT * FROM locations WHERE id=?').get(req.params.id);
  if(!loc) return res.status(404).json({ error: 'Не найдено' });
  const gals = db.prepare("SELECT url FROM gallery WHERE owner_type='location' AND owner_id=?").all(loc.id);
  gals.forEach(g=> deleteUploadedFile(g.url));
  db.prepare("DELETE FROM gallery WHERE owner_type='location' AND owner_id=?").run(loc.id);
  db.prepare("DELETE FROM source_refs WHERE entity_type='location' AND entity_id=?").run(loc.id);
  db.prepare('DELETE FROM locations WHERE id=?').run(loc.id);
  res.json(fullAllod(db.prepare('SELECT * FROM allods WHERE id=?').get(loc.allod_id)));
});

/* ---------------- gallery: by URL ---------------- */
router.post('/gallery', requireAuth, (req, res)=>{
  const { ownerType, ownerId, url } = req.body;
  if(!['allod','location'].includes(ownerType) || !ownerId || !url) return res.status(400).json({ error: 'Некорректные данные' });
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM gallery WHERE owner_type=? AND owner_id=?').get(ownerType, ownerId).m;
  const info = db.prepare('INSERT INTO gallery (owner_type, owner_id, url, sort_order) VALUES (?,?,?,?)').run(ownerType, ownerId, url, maxSort+1);
  res.json({ id: info.lastInsertRowid, url, caption: '' });
});

router.delete('/gallery/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT url FROM gallery WHERE id=?').get(req.params.id);
  if(row) deleteUploadedFile(row.url); // чистим физический файл, если он был загружен, а не ссылка
  db.prepare('DELETE FROM gallery WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.patch('/gallery/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM gallery WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  const caption = (req.body.caption ?? '').toString();
  db.prepare('UPDATE gallery SET caption=? WHERE id=?').run(caption, req.params.id);
  res.json({ id: row.id, url: row.url, caption });
});

router.post('/allods/:id/icon', requireAuth, upload.single('image'), verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, (req, res)=>{
  const row = db.prepare('SELECT * FROM allods WHERE id=?').get(req.params.id);
  if(!row){
    if(req.file) deleteUploadedFile('/uploads/' + req.file.filename);
    return res.status(404).json({ error: 'Не найдено' });
  }
  if(!req.file) return res.status(400).json({ error: 'Файл не получен' });
  // если у острова уже была своя загруженная (не внешняя ссылкой) иконка —
  // подчищаем старый файл, иначе он бы остался мусором в uploads/ навсегда
  if(row.icon_url && row.icon_url.startsWith('/uploads/')) deleteUploadedFile(row.icon_url);
  const url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE allods SET icon_url=? WHERE id=?').run(url, row.id);
  res.json(fullAllod(db.prepare('SELECT * FROM allods WHERE id=?').get(row.id)));
});

router.post('/allods/:id/location-map', requireAuth, upload.single('image'), verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, (req, res)=>{
  const row = db.prepare('SELECT * FROM allods WHERE id=?').get(req.params.id);
  if(!row){
    if(req.file) deleteUploadedFile('/uploads/' + req.file.filename);
    return res.status(404).json({ error: 'Не найдено' });
  }
  if(!req.file) return res.status(400).json({ error: 'Файл не получен' });
  if(row.location_map_url && row.location_map_url.startsWith('/uploads/')) deleteUploadedFile(row.location_map_url);
  const url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE allods SET location_map_url=? WHERE id=?').run(url, row.id);
  res.json(fullAllod(db.prepare('SELECT * FROM allods WHERE id=?').get(row.id)));
});

/* ---------------- gallery: file upload ---------------- */
router.post('/gallery/upload', requireAuth, upload.single('image'), verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, (req, res)=>{
  const { ownerType, ownerId } = req.body;
  if(!['allod','location'].includes(ownerType) || !ownerId || !req.file){
    // к этому моменту файл уже прошёл проверку/санитизацию/сжатие и лежит на
    // диске — если владелец всё равно некорректный, не оставляем файл сиротой
    if(req.file) deleteUploadedFile('/uploads/' + req.file.filename);
    return res.status(400).json({ error: 'Некорректные данные' });
  }
  const url = '/uploads/' + req.file.filename;
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM gallery WHERE owner_type=? AND owner_id=?').get(ownerType, ownerId).m;
  const info = db.prepare('INSERT INTO gallery (owner_type, owner_id, url, sort_order) VALUES (?,?,?,?)').run(ownerType, ownerId, url, maxSort+1);
  res.json({ id: info.lastInsertRowid, url, caption: '' });
});

/* ---------------- bulk import/export (JSON) ---------------- */
router.get('/export', (req, res)=>{
  const rows = db.prepare('SELECT * FROM allods').all().map(fullAllod);
  res.setHeader('Content-Disposition', 'attachment; filename="atlas_allods_export.json"');
  res.json(rows);
});

// Импорт — деструктивная операция: полностью заменяет allods/locations/gallery
// (см. комментарий ниже), поэтому только для администратора, как восстановление
// из бэкапа.
router.post('/import', requireAdmin, (req, res)=>{
  const rows = req.body;
  if(!Array.isArray(rows)) return res.status(400).json({ error: 'Ожидался массив аллодов' });

  // импорт полностью заменяет содержимое allods/locations/gallery — если старые
  // данные ссылались на локальные файлы в uploads/, которых нет в новом наборе,
  // они иначе так и останутся мусором на диске навсегда
  const oldLocalUrls = new Set();
  db.prepare("SELECT url FROM gallery WHERE url LIKE '/uploads/%'").all().forEach(r=>oldLocalUrls.add(r.url));
  db.prepare("SELECT icon_url, location_map_url FROM allods").all().forEach(a=>{
    if(a.icon_url && a.icon_url.startsWith('/uploads/')) oldLocalUrls.add(a.icon_url);
    if(a.location_map_url && a.location_map_url.startsWith('/uploads/')) oldLocalUrls.add(a.location_map_url);
  });

  const delGal = db.prepare('DELETE FROM gallery');
  const delLoc = db.prepare('DELETE FROM locations');
  const delAllod = db.prepare('DELETE FROM allods');
  const insertAllod = db.prepare(`INSERT INTO allods
    (id,name,slug,climate,size,holder,faction,hasMap,type,category,plot,expansion,archipelago,description,history,mapX,mapY,location_map_url,icon_url,project)
    VALUES (@id,@name,@slug,@climate,@size,@holder,@faction,@hasMap,@type,@category,@plot,@expansion,@archipelago,@description,@history,@mapX,@mapY,@location_map_url,@icon_url,@project)`);
  const insertLoc = db.prepare('INSERT INTO locations (id, allod_id, name, description, sort_order, mapX, mapY) VALUES (?,?,?,?,?,?,?)');
  const insertGal = db.prepare('INSERT INTO gallery (owner_type, owner_id, url, caption, sort_order) VALUES (?,?,?,?,?)');

  // Валидируем ДО транзакции: undefined (а не null) в необязательном поле
  // node:sqlite отказывается биндить как параметр (ERR_INVALID_ARG_TYPE) — без
  // этой нормализации один остров с пропущенным полем в JSON падал бы всей
  // операцией в 500 посреди транзакции. А без id/name — падать вообще незачем,
  // возвращаем понятную ошибку и не трогаем текущую базу.
  for(const r of rows){
    if(!r || typeof r.id !== 'string' || !r.id.trim() || typeof r.name !== 'string' || !r.name.trim()){
      return res.status(400).json({ error: 'У каждого острова в импортируемых данных должны быть непустые id и name.' });
    }
    for(const loc of (r.locations||[])){
      if(!loc || typeof loc.id !== 'string' || !loc.id.trim()){
        return res.status(400).json({ error: `У локации острова "${r.id}" должен быть непустой id.` });
      }
    }
  }
  const orNull = v => v === undefined ? null : v;

  const tx = db.transaction(()=>{
    delGal.run(); delLoc.run(); delAllod.run();
    rows.forEach(r=>{
      insertAllod.run({
        id: r.id, name: r.name, slug: r.slug || '', climate: orNull(r.climate), size: orNull(r.size),
        holder: orNull(r.holder), faction: orNull(r.faction), hasMap: r.hasMap ? 1 : 0, type: orNull(r.type),
        category: orNull(r.category), plot: orNull(r.plot), expansion: orNull(r.expansion), archipelago: orNull(r.archipelago),
        description: r.description || '', history: r.history || '', mapX: orNull(r.mapX), mapY: orNull(r.mapY),
        location_map_url: r.location_map_url || null, icon_url: r.icon_url || null,
        project: r.project || 'Аллоды Онлайн'
      });
      (r.gallery||[]).forEach((g,i)=> insertGal.run('allod', r.id, typeof g==='string'?g:g.url, (g&&g.caption)||'', i));
      (r.locations||[]).forEach((loc,i)=>{
        insertLoc.run(loc.id, r.id, loc.name || '', loc.description||'', i, orNull(loc.mapX), orNull(loc.mapY));
        (loc.gallery||[]).forEach((g,j)=> insertGal.run('location', loc.id, typeof g==='string'?g:g.url, (g&&g.caption)||'', j));
      });
    });
  });
  tx();

  // подчищаем файлы, на которые новый набор данных больше не ссылается
  const newLocalUrls = new Set();
  rows.forEach(r=>{
    (r.gallery||[]).forEach(g=>{ const u = typeof g==='string'?g:(g&&g.url); if(u && u.startsWith('/uploads/')) newLocalUrls.add(u); });
    (r.locations||[]).forEach(loc=>{
      (loc.gallery||[]).forEach(g=>{ const u = typeof g==='string'?g:(g&&g.url); if(u && u.startsWith('/uploads/')) newLocalUrls.add(u); });
    });
    if(r.icon_url && r.icon_url.startsWith('/uploads/')) newLocalUrls.add(r.icon_url);
    if(r.location_map_url && r.location_map_url.startsWith('/uploads/')) newLocalUrls.add(r.location_map_url);
  });
  let cleanedFiles = 0;
  oldLocalUrls.forEach(u=>{
    if(!newLocalUrls.has(u)){ deleteUploadedFile(u); cleanedFiles++; }
  });

  res.json({ ok: true, count: rows.length, cleanedFiles });
});

module.exports = router;
