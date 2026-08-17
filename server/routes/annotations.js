const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();

const TYPES = new Set(['text', 'line', 'arrow', 'rect', 'circle', 'polygon', 'freehand', 'icon']);
const MULTIPOINT_TYPES = new Set(['polygon', 'freehand']);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_POINTS = 500; // защита от гигантских payload — с запасом хватает на любой реалистичный от-руки рисунок

function toNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// points приходят как [{x,y}, ...] в JSON-теле запроса — валидируем и
// пересобираем сами (не доверяем структуре целиком), чтобы в БД не улетело
// что-то кроме пар конечных чисел
function parsePoints(raw){
  if(!Array.isArray(raw)) return null;
  if(raw.length < 2 || raw.length > MAX_POINTS) return null;
  const pts = [];
  for(const p of raw){
    const x = toNum(p && p.x), y = toNum(p && p.y);
    if(x===null || y===null) return null;
    pts.push({ x, y });
  }
  return pts;
}

function rowToAnnotation(row){
  return {
    id: row.id, project: row.project, type: row.type,
    x1: row.x1, y1: row.y1, x2: row.x2, y2: row.y2, r: row.r,
    text: row.text, iconUrl: row.icon_url,
    points: row.points ? JSON.parse(row.points) : null,
    color: row.color, strokeWidth: row.stroke_width, fontSize: row.font_size,
    opacity: row.opacity,
  };
}

// публично — карта (и слой пометок на ней) видна всем, редактирование — только вошедшим
router.get('/annotations', (req, res)=>{
  const project = req.query.project;
  if(!project) return res.status(400).json({ error: 'Не указан project' });
  const rows = db.prepare('SELECT * FROM map_annotations WHERE project=? ORDER BY created_at ASC').all(project);
  res.json(rows.map(rowToAnnotation));
});

router.post('/annotations', requireAuth, (req, res)=>{
  const b = req.body || {};
  if(!TYPES.has(b.type)) return res.status(400).json({ error: 'Неизвестный тип пометки' });
  if(!b.project || typeof b.project !== 'string') return res.status(400).json({ error: 'Не указан project' });
  const x1 = toNum(b.x1), y1 = toNum(b.y1);
  if(x1===null || y1===null) return res.status(400).json({ error: 'Некорректные координаты' });

  let x2=null, y2=null, r=null, iconUrl=null, points=null;
  if(b.type==='line' || b.type==='arrow' || b.type==='rect'){
    x2 = toNum(b.x2); y2 = toNum(b.y2);
    if(x2===null || y2===null) return res.status(400).json({ error: 'Для линии/стрелки/прямоугольника нужна вторая точка' });
  }
  if(b.type==='circle'){
    r = toNum(b.r);
    if(r===null || r<=0) return res.status(400).json({ error: 'Некорректный радиус круга' });
  }
  if(b.type==='text' && (!b.text || !String(b.text).trim())){
    return res.status(400).json({ error: 'Текст подписи не может быть пустым' });
  }
  if(MULTIPOINT_TYPES.has(b.type)){
    points = parsePoints(b.points);
    const minPoints = b.type==='polygon' ? 3 : 2;
    if(!points || points.length < minPoints){
      return res.status(400).json({ error: b.type==='polygon' ? 'Полигону нужно хотя бы 3 точки' : 'Линии от руки нужно хотя бы 2 точки' });
    }
  }
  if(b.type==='icon'){
    // iconUrl должен быть из управляемой библиотеки украшений, а не
    // произвольной строкой — иначе кто угодно мог бы вставить в src ссылку
    // на сторонний домен под видом украшения
    const known = db.prepare('SELECT 1 FROM decoration_icons WHERE url=?').get(b.iconUrl);
    if(!known) return res.status(400).json({ error: 'Неизвестное украшение — сначала добавьте его в библиотеку' });
    iconUrl = b.iconUrl;
    r = Math.min(Math.max(toNum(b.r) || 32, 12), 200);
  }

  const color = HEX_COLOR_RE.test(b.color) ? b.color : '#e8c874';
  const strokeWidth = Math.min(Math.max(toNum(b.strokeWidth) || 2, 1), 20);
  const fontSize = Math.min(Math.max(toNum(b.fontSize) || 16, 8), 72);
  const opacity = b.opacity !== undefined ? Math.min(Math.max(toNum(b.opacity) ?? 1, 0.1), 1) : 1;

  const id = 'ann_' + crypto.randomBytes(8).toString('hex');
  db.prepare(`INSERT INTO map_annotations (id, project, type, x1, y1, x2, y2, r, text, icon_url, points, color, stroke_width, font_size, opacity, created_at)
    VALUES (@id,@project,@type,@x1,@y1,@x2,@y2,@r,@text,@iconUrl,@points,@color,@strokeWidth,@fontSize,@opacity,@createdAt)`)
    .run({
      id, project: b.project, type: b.type, x1, y1, x2, y2, r,
      text: b.type==='text' ? String(b.text).trim().slice(0, 500) : null,
      iconUrl, points: points ? JSON.stringify(points) : null,
      color, strokeWidth, fontSize, opacity, createdAt: Date.now(),
    });
  res.json(rowToAnnotation(db.prepare('SELECT * FROM map_annotations WHERE id=?').get(id)));
});

router.patch('/annotations/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT * FROM map_annotations WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  const b = req.body || {};
  const updates = {};
  ['x1','y1','x2','y2','r'].forEach(f=>{ if(f in b){ const n = toNum(b[f]); if(n!==null) updates[f]=n; } });
  if('text' in b) updates.text = row.type==='text' ? String(b.text||'').trim().slice(0,500) : row.text;
  if('color' in b && HEX_COLOR_RE.test(b.color)) updates.color = b.color;
  if('strokeWidth' in b){ const n = toNum(b.strokeWidth); if(n!==null) updates.stroke_width = Math.min(Math.max(n,1),20); }
  if('fontSize' in b){ const n = toNum(b.fontSize); if(n!==null) updates.font_size = Math.min(Math.max(n,8),72); }
  if('opacity' in b){ const n = toNum(b.opacity); if(n!==null) updates.opacity = Math.min(Math.max(n,0.1),1); }
  if('points' in b && MULTIPOINT_TYPES.has(row.type)){
    const pts = parsePoints(b.points);
    if(pts) updates.points = JSON.stringify(pts);
  }
  if(Object.keys(updates).length===0) return res.json(rowToAnnotation(row));
  const setSql = Object.keys(updates).map(k=>`${k}=@${k}`).join(', ');
  db.prepare(`UPDATE map_annotations SET ${setSql} WHERE id=@id`).run({ ...updates, id: row.id });
  res.json(rowToAnnotation(db.prepare('SELECT * FROM map_annotations WHERE id=?').get(row.id)));
});

router.delete('/annotations/:id', requireAuth, (req, res)=>{
  const row = db.prepare('SELECT id FROM map_annotations WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({ error: 'Не найдено' });
  db.prepare('DELETE FROM map_annotations WHERE id=?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
