const express = require('express');

const router = express.Router();

// robots.txt отдаётся динамически, а не статическим файлом — переключатель
// индексации через переменную окружения (не нужно лезть в файлы, чтобы
// открыть сайт для поисковиков, когда будет пора). По умолчанию ЗАКРЫТО:
// сайт ещё не готов к публичному виду, безопасный дефолт — не индексировать
// до явного решения.
router.get('/robots.txt', (req, res)=>{
  res.type('text/plain');
  if(process.env.ATLAS_ALLOW_INDEXING === '1'){
    res.send(
      'User-agent: *\n' +
      'Allow: /\n' +
      `Sitemap: ${req.protocol}://${req.get('host')}/sitemap.xml\n`
    );
  } else {
    res.send('User-agent: *\nDisallow: /\n');
  }
});

// Sitemap теперь перечисляет и страницы островов — раньше у них не было
// собственного URL (весь фронтенд жил на "/"), с появлением роутинга
// (public/js/router.js, /allod/:id/:slug) есть что класть в sitemap.
router.get('/sitemap.xml', (req, res)=>{
  const db = require('../db');
  const base = `${req.protocol}://${req.get('host')}`;
  const staticPaths = ['/map', '/wiki', '/timeline', '/sources', '/archipelagos'];
  let allodUrls = '';
  try{
    const rows = db.prepare("SELECT id, slug FROM allods WHERE slug IS NOT NULL AND TRIM(slug) <> ''").all();
    allodUrls = rows.map(r=> `  <url><loc>${base}/allod/${r.id}/${r.slug}</loc></url>\n`).join('');
  }catch(e){ /* БД недоступна — отдаём хотя бы статические разделы, не 500 */ }
  res.type('application/xml');
  res.send(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url><loc>${base}/</loc></url>\n` +
    staticPaths.map(p=> `  <url><loc>${base}${p}</loc></url>\n`).join('') +
    allodUrls +
    '</urlset>\n'
  );
});

module.exports = router;
