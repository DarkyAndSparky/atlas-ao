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

// Минимальный sitemap.xml — пока только главная страница. Фронтенд сейчас
// одностраничный без глубоких ссылок на конкретные острова (нет
// hash-роутинга/history.pushState, см. public/js/main.js) — то есть у
// отдельных островов нет собственного URL, который можно было бы положить
// в sitemap. Если/когда появится deep-linking (?id=... или #/allod/...),
// сюда же стоит добавить перечисление через db.prepare('SELECT id FROM allods').
router.get('/sitemap.xml', (req, res)=>{
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('application/xml');
  res.send(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url><loc>${base}/</loc></url>\n` +
    '</urlset>\n'
  );
});

module.exports = router;
