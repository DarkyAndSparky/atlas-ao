const express = require('express');
const db = require('../db');

const router = express.Router();

// Строим безопасный FTS5 MATCH-запрос из свободного пользовательского ввода:
// каждое слово — отдельная кавычечная фраза (защищает от того, что во
// введённом тексте случайно встретится служебный синтаксис FTS5 — AND/OR/NOT,
// скобки, звёздочки, дефисы и т.п. — всё это внутри кавычек трактуется как
// обычный текст, а не оператор). Двойные кавычки внутри слова экранируем
// удвоением — так их эскейпит сам FTS5. Последнему слову добавляем `*` —
// поиск "остр" находит "остров" уже во время печати, не только по полному
// совпадению.
function buildMatchQuery(raw){
  const words = raw.trim().split(/\s+/).filter(Boolean).slice(0, 12); // не даём разрастись запросу до абсурда
  if(!words.length) return null;
  const quoted = words.map(w => '"' + w.replace(/"/g, '""') + '"');
  quoted[quoted.length - 1] += '*';
  return quoted.join(' ');
}

// Полнотекстовый поиск по названию/описанию/истории/сюжету острова — в
// отличие от фильтра на карте (только по названию, мгновенно, без бэкенда),
// это ищет и внутри самого текста статьи. Публичный эндпоинт — сам поиск не
// раскрывает ничего, что не видно и так на страницах островов.
router.get('/search', (req, res)=>{
  const q = (req.query.q || '').toString();
  const matchQuery = buildMatchQuery(q);
  if(!matchQuery) return res.json([]);

  let rows;
  try{
    rows = db.prepare(`
      SELECT
        allods_fts.id AS id,
        bm25(allods_fts, 3.0, 1.0, 1.0, 1.0) AS rank,
        snippet(allods_fts, 1, '\u0001', '\u0002', '…', 6) AS name_snippet,
        snippet(allods_fts, 2, '\u0001', '\u0002', '…', 10) AS description_snippet,
        snippet(allods_fts, 3, '\u0001', '\u0002', '…', 10) AS history_snippet
      FROM allods_fts
      WHERE allods_fts MATCH ?
      ORDER BY rank
      LIMIT 30
    `).all(matchQuery);
  }catch(e){
    // некорректный ввод (например, один голый символ "*" или что-то ещё, что
    // buildMatchQuery не отфильтровал) — не 500, а пустой результат
    return res.json([]);
  }

  // \u0001/\u0002 — временные маркеры вместо <mark>/</mark>: сниппет идёт
  // через escapeHtml на клиенте (это не HTML, а обычный текст с координатами
  // совпадений), а сами маркеры клиент заменит на <mark> уже ПОСЛЕ экранирования
  const ids = rows.map(r => r.id);
  if(!ids.length) return res.json([]);
  const placeholders = ids.map(()=>'?').join(',');
  const allodsById = Object.fromEntries(
    db.prepare(`SELECT id, name, faction, category, mapX, mapY FROM allods WHERE id IN (${placeholders})`).all(...ids)
      .map(a => [a.id, a])
  );

  res.json(rows.map(r=>{
    const a = allodsById[r.id];
    if(!a) return null;
    // предпочитаем сниппет из description, если там есть совпадение
    // (\u0001 внутри строки), иначе пробуем history — так в выдаче видно
    // именно текст с найденным словом, а не всегда одно и то же поле
    const snippet = [r.description_snippet, r.history_snippet].find(s => s && s.includes('\u0001')) || r.description_snippet || '';
    return {
      id: a.id, name: a.name, faction: a.faction, category: a.category,
      placed: a.mapX != null && a.mapY != null,
      nameSnippet: r.name_snippet,
      snippet,
    };
  }).filter(Boolean));
});

module.exports = router;
