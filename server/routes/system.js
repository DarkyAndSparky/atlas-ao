const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../db');
const { requireAdmin } = require('./auth');

const router = express.Router();

const ROOT_DIR = path.join(__dirname, '..', '..');
const SERVER_DIR = path.join(__dirname, '..');
const VERSION_FILE = path.join(ROOT_DIR, 'VERSION');
const CHANGELOG_FILE = process.env.ATLAS_CHANGELOG_PATH || path.join(ROOT_DIR, 'CHANGELOG.md');
const PACKAGE_FILE = path.join(SERVER_DIR, 'package.json');
const DB_PATH = process.env.ATLAS_DB_PATH || path.join(SERVER_DIR, 'atlas.db');
const BACKUPS_DIR = process.env.ATLAS_BACKUPS_DIR || path.join(ROOT_DIR, 'backups');

const pkg = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf-8'));

function readVersion(){
  try{ return fs.readFileSync(VERSION_FILE, 'utf-8').trim(); }
  catch(e){ return pkg.version || 'неизвестно'; }
}

// Парсер CHANGELOG.md (формат Keep a Changelog). Секции вида
// "## [версия] — дата" (без даты — например [Unreleased] — тоже
// поддерживаются, просто date=null), внутри — подсекции "### Добавлено/
// Изменено/Исправлено" со списком "- пункт". Пункты всех подсекций
// собираются в один плоский список — для компактной сводки в UI разбивка
// по категориям не нужна, полный markdown всегда доступен в самом файле.
function readChangelog(limit=5){
  let raw;
  try{ raw = fs.readFileSync(CHANGELOG_FILE, 'utf-8'); }
  catch(e){ return []; }

  const releases = [];
  const headerRe = /^##\s*\[([^\]]+)\](?:\s*—\s*(\d{4}-\d{2}-\d{2}))?\s*$/gm;
  const matches = [...raw.matchAll(headerRe)];

  for(let i=0; i<matches.length && releases.length<limit; i++){
    const [, version, date] = matches[i];
    const start = matches[i].index + matches[i][0].length;
    const end = i+1 < matches.length ? matches[i+1].index : raw.length;
    const body = raw.slice(start, end);
    const items = [...body.matchAll(/^- (.+(?:\n {2,}\S.*)*)$/gm)]
      .map(m => m[1].replace(/\n\s+/g, ' ').trim());
    releases.push({ version, date: date || null, items });
  }
  return releases;
}

function installedVersion(depName){
  try{
    const p = path.join(SERVER_DIR, 'node_modules', depName, 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8')).version;
  }catch(e){ return null; }
}

function lastBackupInfo(){
  try{
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => ({ f, t: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
      .sort((a,b)=> b.t - a.t);
    if(!files.length) return null;
    return new Date(files[0].t).toISOString();
  }catch(e){ return null; }
}

function dbSizeBytes(){
  try{ return fs.statSync(DB_PATH).size; }
  catch(e){ return null; }
}

// технологии показываем куратором вручную (не всё в package.json — часть встроена в Node,
// как node:sqlite) — список поддерживается вместе с README при добавлении новых зависимостей
const TECHNOLOGIES = [
  { icon: '🟢', name: 'Node.js + Express', desc: 'Backend-сервер и REST API' },
  { icon: '📄', name: 'node:sqlite', desc: 'Встроенная файловая БД, без отдельного сервера СУБД' },
  { icon: '🛡️', name: 'Helmet', desc: 'HTTP security headers' },
  { icon: '🖼️', name: 'sharp', desc: 'Сжатие и обработка загружаемых изображений' },
  { icon: '🧼', name: 'DOMPurify + jsdom', desc: 'Очистка загружаемых SVG от вредоносного кода' },
  { icon: '📦', name: 'multer', desc: 'Приём multipart-загрузок файлов' },
  { icon: '🎨', name: 'Vanilla JS + HTML/CSS', desc: 'Фронтенд без фреймворков и сборщиков' },
  { icon: '🎭', name: 'Playwright', desc: 'E2E-тесты (скриншоты/рендер используется точечно)' },
];

router.get('/', requireAdmin, (req, res)=>{
  const allodsCount = db.prepare('SELECT COUNT(*) AS c FROM allods').get().c;
  const usersCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

  const dependencies = Object.entries(pkg.dependencies || {}).map(([name, range])=>({
    name,
    range,
    installed: installedVersion(name),
  }));

  const dbBytes = dbSizeBytes();

  res.json({
    project: {
      name: 'Атлас Аллодов',
      version: readVersion(),
      description: 'Локальный сайт-энциклопедия аллодов (островов) вселенной Allods Online: '
        + 'глобальная карта, страницы островов с историей и галереей, встроенный редактор.',
      license: 'MIT (код) — см. /api/system/license',
      author: pkg.author || null,
      repository: (pkg.repository && pkg.repository.url) || null,
    },
    environment: {
      node: process.version,
      platform: `${process.platform} / ${process.arch}`,
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      pid: process.pid,
      dbSizeKb: dbBytes !== null ? Math.round(dbBytes / 1024) : null,
      lastBackup: lastBackupInfo(),
    },
    technologies: TECHNOLOGIES,
    dependencies,
    changelog: readChangelog(),
    data: {
      allods: allodsCount,
      users: usersCount,
    },
  });
});

// текстовый файл с лицензией — код MIT, игровые ресурсы отдельно; отдаётся как
// вложение, чтобы кнопка «Скачать» на фронте просто открывала эту ссылку
router.get('/license', (req, res)=>{
  const version = readVersion();
  const text = `АТЛАС АЛЛОДОВ (${version}) — ЛИЦЕНЗИЯ
========================================

1. ИСХОДНЫЙ КОД

Лицензия MIT распространяется ТОЛЬКО на исходный код этого проекта
(сервер, фронтенд, тесты, конфигурацию сборки) — то есть на программу,
которая отображает и редактирует данные.

MIT License

Copyright (c) 2026 ${typeof pkg.author === 'string' ? pkg.author.replace(/\s*\(.*\)\s*$/, '') : 'Автор проекта'}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

2. ИГРОВОЙ КОНТЕНТ — ЭТО НЕ MIT

Лицензия MIT НЕ распространяется на:
- название «Аллоды Онлайн», логотипы, торговые марки и любые материалы,
  принадлежащие ASTRUM ENTERTAINMENT / ASTRUM LAB LLC;
- любые скриншоты, арты, карты, тексты описаний и прочий игровой контент,
  который загружается через редактор в качестве данных (seed-data.json,
  содержимое uploads/, atlas.db).

Все права на ресурсы игры «Аллоды Онлайн» принадлежат их правообладателю —
ASTRUM ENTERTAINMENT / ASTRUM LAB LLC. Это неофициальный, некоммерческий
фан-проект, не связанный с разработчиком и не претендующий на официальность.

© 2026 ASTRUM LAB LLC. Все права на игровые ресурсы защищены.
Все товарные знаки являются собственностью их правообладателей.
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="atlas-allods-license-${version}.txt"`);
  res.send(text);
});

// сверяет установленные версии зависимостей с последними на npm — бьёт напрямую
// в registry.npmjs.org, поэтому нужен доступ в интернет; вызывается по кнопке,
// не на каждую загрузку /api/system, чтобы не делать это без необходимости
router.get('/check-updates', requireAdmin, async (req, res, next)=>{
  try{
    const names = Object.keys(pkg.dependencies || {});
    const results = await Promise.all(names.map(async (name)=>{
      const installed = installedVersion(name);
      try{
        const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
          signal: AbortSignal.timeout(5000),
        });
        if(!r.ok) throw new Error('npm registry: ' + r.status);
        const data = await r.json();
        return { name, installed, latest: data.version, upToDate: data.version === installed, error: null };
      }catch(e){
        return { name, installed, latest: null, upToDate: null, error: 'Не удалось проверить' };
      }
    }));
    res.json({ checkedAt: new Date().toISOString(), results });
  }catch(err){ next(err); }
});

module.exports = { router, readChangelog };
