const path = require('path');
const fs = require('fs');

let DatabaseSync;
try{
  ({ DatabaseSync } = require('node:sqlite'));
}catch(e){
  console.error('');
  console.error('Не удалось загрузить встроенный модуль node:sqlite.');
  console.error('Нужен Node.js версии 22.5 или новее (у вас: ' + process.version + ').');
  console.error('Скачайте свежий Node.js с https://nodejs.org и запустите install.bat/install.sh заново.');
  console.error('');
  process.exit(1);
}

const DB_PATH = process.env.ATLAS_DB_PATH || path.join(__dirname, 'atlas.db');
const isNew = !fs.existsSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// db.transaction(fn) -> обёртка BEGIN/COMMIT/ROLLBACK, повторяет API better-sqlite3,
// чтобы остальной код (роуты, сиды) не пришлось переписывать.
db.transaction = function(fn){
  return function(...args){
    db.exec('BEGIN');
    try{
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    }catch(err){
      try{ db.exec('ROLLBACK'); }catch(e2){ /* транзакции могло и не быть */ }
      throw err;
    }
  };
};

db.exec(`
CREATE TABLE IF NOT EXISTS allods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  climate TEXT,
  size TEXT,
  holder TEXT,
  faction TEXT,
  hasMap INTEGER DEFAULT 0,
  type TEXT,
  category TEXT,
  plot TEXT,
  expansion TEXT,
  archipelago TEXT,
  description TEXT DEFAULT '',
  history TEXT DEFAULT '',
  mapX REAL,
  mapY REAL,
  location_map_url TEXT,
  icon_url TEXT,
  project TEXT DEFAULT 'Аллоды Онлайн'
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  allod_id TEXT NOT NULL REFERENCES allods(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  mapX REAL,
  mapY REAL
);

CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('allod','location')),
  owner_id TEXT NOT NULL,
  url TEXT NOT NULL,
  caption TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt TEXT NOT NULL,
  hash TEXT NOT NULL
);

-- многопользовательские аккаунты редакторов (см. миграцию из auth ниже) —
-- все редакторы равноправны, отдельной роли "администратор" нет
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title TEXT NOT NULL DEFAULT 'Атлас Аллодов',
  logo_url TEXT,
  accent_light TEXT NOT NULL DEFAULT '#96701f',
  accent_dark TEXT NOT NULL DEFAULT '#c9a24b'
);

-- express-session хранит сюда данные сессий вместо дефолтного MemoryStore
-- (тот течёт по памяти и не переживает рестарт процесса — не годится даже
-- для однопользовательского продакшна). См. server/sessionStore.js.
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);

-- Векторные пометки на глобальной карте (слой рисования): текстовые подписи,
-- линии, прямоугольники, круги. Координаты — в той же системе, что и mapX/mapY
-- островов (пиксели внутри #mapCanvas 1669×1256), поэтому пометки панорамируются
-- и масштабируются синхронно с картой и метками — не «уплывают» при зуме.
-- Отдельная таблица, а не JSON-поле в site_settings — пометок может быть много,
-- и каждую нужно уметь двигать/удалять по отдельности.
CREATE TABLE IF NOT EXISTS map_annotations (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','line','rect','circle')),
  x1 REAL NOT NULL,
  y1 REAL NOT NULL,
  x2 REAL,
  y2 REAL,
  r REAL,
  text TEXT,
  color TEXT NOT NULL DEFAULT '#e8c874',
  stroke_width REAL NOT NULL DEFAULT 2,
  font_size REAL NOT NULL DEFAULT 16,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_project ON map_annotations(project);

CREATE INDEX IF NOT EXISTS idx_locations_allod ON locations(allod_id);
CREATE INDEX IF NOT EXISTS idx_gallery_owner ON gallery(owner_type, owner_id);
`);

// миграция для баз, созданных до появления подписей к фото
const galleryCols = db.prepare("PRAGMA table_info(gallery)").all().map(c=>c.name);
if(!galleryCols.includes('caption')){
  console.log('Миграция: добавляю колонку caption в таблицу gallery...');
  db.exec("ALTER TABLE gallery ADD COLUMN caption TEXT DEFAULT ''");
}

// миграция для баз, созданных до появления мини-карты локаций
const allodCols = db.prepare("PRAGMA table_info(allods)").all().map(c=>c.name);
if(!allodCols.includes('location_map_url')){
  console.log('Миграция: добавляю колонку location_map_url в таблицу allods...');
  db.exec("ALTER TABLE allods ADD COLUMN location_map_url TEXT");
}
if(!allodCols.includes('icon_url')){
  console.log('Миграция: добавляю колонку icon_url в таблицу allods...');
  db.exec("ALTER TABLE allods ADD COLUMN icon_url TEXT");
}
if(!allodCols.includes('project')){
  console.log('Миграция: добавляю колонку project в таблицу allods (существующие записи -> "Аллоды Онлайн")...');
  db.exec("ALTER TABLE allods ADD COLUMN project TEXT DEFAULT 'Аллоды Онлайн'");
  db.exec("UPDATE allods SET project = 'Аллоды Онлайн' WHERE project IS NULL");
}
const locationCols = db.prepare("PRAGMA table_info(locations)").all().map(c=>c.name);
if(!locationCols.includes('mapX')){
  console.log('Миграция: добавляю колонки mapX/mapY в таблицу locations...');
  db.exec("ALTER TABLE locations ADD COLUMN mapX REAL");
  db.exec("ALTER TABLE locations ADD COLUMN mapY REAL");
}

// миграция: старые базы (до многопользовательских аккаунтов) хранили единственного
// редактора в auth(id=1) без имени пользователя — переносим в users под именем
// "admin" (хэш/соль переиспользуются как есть, алгоритм хэширования не поменялся)
const legacyAuth = db.prepare('SELECT * FROM auth WHERE id=1').get();
const hasAnyUser = db.prepare('SELECT id FROM users LIMIT 1').get();
if(legacyAuth && !hasAnyUser){
  console.log('Миграция: переношу единственный аккаунт редактора в многопользовательскую систему (логин: admin)...');
  db.prepare('INSERT INTO users (username, salt, hash, created_at) VALUES (?,?,?,?)')
    .run('admin', legacyAuth.salt, legacyAuth.hash, Date.now());
  db.prepare('DELETE FROM auth WHERE id=1').run();
}

if(isNew){
  console.log('Новая база — засеваю данными из seed-data.json...');
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data.json'), 'utf-8'));
  const insertAllod = db.prepare(`INSERT INTO allods
    (id,name,slug,climate,size,holder,faction,hasMap,type,category,plot,expansion,archipelago,description,history,mapX,mapY)
    VALUES (@id,@name,@slug,@climate,@size,@holder,@faction,@hasMap,@type,@category,@plot,@expansion,@archipelago,@description,@history,@mapX,@mapY)`);
  const insertLoc = db.prepare(`INSERT INTO locations (id, allod_id, name, description, sort_order) VALUES (?,?,?,?,?)`);
  const insertGal = db.prepare(`INSERT INTO gallery (owner_type, owner_id, url, sort_order) VALUES (?,?,?,?)`);

  const tx = db.transaction((rows)=>{
    rows.forEach(r=>{
      insertAllod.run({
        id: r.id, name: r.name, slug: r.slug || null, climate: r.climate || null, size: r.size || null,
        holder: r.holder || null, faction: r.faction || null, hasMap: r.hasMap?1:0, type: r.type || null,
        category: r.category || null, plot: r.plot || null, expansion: r.expansion || null, archipelago: r.archipelago || null,
        description: r.description||'', history: r.history||'',
        mapX: r.mapX ?? null, mapY: r.mapY ?? null
      });
      (r.gallery||[]).forEach((url,i)=> insertGal.run('allod', r.id, url, i));
      (r.locations||[]).forEach((loc,i)=>{
        insertLoc.run(loc.id, r.id, loc.name, loc.description||'', i);
        (loc.gallery||[]).forEach((url,j)=> insertGal.run('location', loc.id, url, j));
      });
    });
  });
  tx(seed);
  console.log(`Засеяно аллодов: ${seed.length}`);
}

// гарантируем, что строка настроек сайта всегда есть (id=1, singleton)
const hasSettings = db.prepare('SELECT id FROM site_settings WHERE id=1').get();
if(!hasSettings){
  db.prepare('INSERT INTO site_settings (id) VALUES (1)').run();
}

module.exports = db;
