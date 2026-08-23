const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
-- контейнер группы островов (см. обсуждение роадмапа) — старое текстовое
-- поле allods.archipelago остаётся в схеме нетронутым (см. миграцию ниже:
-- значения из него разово переносятся в архипелаги), но UI им больше не
-- пользуется, источник истины теперь archipelago_id.
CREATE TABLE IF NOT EXISTS archipelagos (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL DEFAULT 'Аллоды Онлайн',
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

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
-- роль хранится в отдельной колонке (см. миграцию role ниже), в CREATE TABLE
-- сразу для новых баз с дефолтом 'admin' — первый аккаунт на сервере
-- всегда полноправный (см. bootstrap-ветку в routes/auth.js)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('editor','admin')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
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
  -- тип не ограничен CHECK — список допустимых значений живёт в коде
  -- (server/routes/annotations.js), т.к. CHECK нельзя расширить на лету
  -- ALTER-ом для уже существующих баз (см. миграцию ниже)
  type TEXT NOT NULL,
  x1 REAL NOT NULL,
  y1 REAL NOT NULL,
  x2 REAL,
  y2 REAL,
  r REAL,
  text TEXT,
  icon_url TEXT,
  -- JSON-массив [{x,y},...] — для многоточечных фигур (полигон, произвольная
  -- линия от руки); для остальных типов остаётся NULL, координаты в x1/y1/x2/y2/r
  points TEXT,
  color TEXT NOT NULL DEFAULT '#e8c874',
  stroke_width REAL NOT NULL DEFAULT 2,
  font_size REAL NOT NULL DEFAULT 16,
  opacity REAL NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_project ON map_annotations(project);

-- Библиотека украшений для слоя рисования (астральные обломки/аномалии/etc.) —
-- управляемый набор, а не хардкод в JS: редакторы могут добавлять свои
-- картинки через настройки, плюс стартовый набор засевается автоматически
-- (см. ниже, блок isNew).
CREATE TABLE IF NOT EXISTS decoration_icons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Иконки фракций (Гиберлинги/Кания/Империя/... — то, что реально стоит в
-- поле allods.faction) — управляемая таблица, не хардкод. Совпадение по
-- точному названию фракции (без учёта регистра), см. server/routes/factions.js.
CREATE TABLE IF NOT EXISTS faction_icons (
  id TEXT PRIMARY KEY,
  faction TEXT NOT NULL UNIQUE COLLATE NOCASE,
  icon_url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_locations_allod ON locations(allod_id);
CREATE INDEX IF NOT EXISTS idx_gallery_owner ON gallery(owner_type, owner_id);

-- Источники (внешние ссылки — форумные темы, статьи, скриншоты официальных
-- материалов и т.п.), на основе которых заполняется вики. Глобальный
-- список, а не привязанный к project: одна и та же статья по лору может
-- быть источником для аллодов из разных "проектов" (игровых версий) —
-- дублировать запись под каждый project незачем.
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Привязка источника к конкретной сущности (аллоду, локации, будущим
-- событиям хронологии) — многие-ко-многим: у одной статьи может быть
-- несколько упоминаний по разным аллодам, у одного аллода — несколько
-- источников. entity_type/entity_id не через FK (сущности разных типов
-- живут в разных таблицах) — как entity_type в gallery.owner_type.
CREATE TABLE IF NOT EXISTS source_refs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_refs_source ON source_refs(source_id);
CREATE INDEX IF NOT EXISTS idx_source_refs_entity ON source_refs(entity_type, entity_id);

-- Хронология: и общемировые события ("хронология мира"), и события
-- конкретного аллода (тогда allod_id заполнен). year — просто число:
-- договорились не городить отдельный лейбл эпохи, т.к. у части событий
-- даты внутри одного года "размазаны" — sort_order разруливает порядок
-- внутри одного year, когда самого года для сортировки недостаточно.
CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL DEFAULT 'Аллоды Онлайн',
  scope TEXT NOT NULL DEFAULT 'world', -- 'world' | 'allod'
  allod_id TEXT REFERENCES allods(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timeline_allod ON timeline_events(allod_id);
CREATE INDEX IF NOT EXISTS idx_timeline_project_year ON timeline_events(project, year, sort_order);

-- Полнотекстовый поиск по тексту статей (не только по названию, как раньше
-- искал клиент). id — TEXT (не INTEGER PRIMARY KEY), поэтому content_rowid
-- у allods не подходит для FTS5 external-content (там нужен настоящий
-- integer rowid) — держим свою копию нужных полей в отдельной FTS5-таблице,
-- id хранится как обычная колонка (UNINDEXED — не участвует в полнотекстовом
-- поиске, только для обратной связи с allods.id). Синхронизация — триггерами
-- на allods, а не в JS-коде роутов: так не получится забыть обновить индекс
-- на каком-то из путей записи (прямой PATCH, импорт, restore и т.п.).
CREATE VIRTUAL TABLE IF NOT EXISTS allods_fts USING fts5(
  id UNINDEXED,
  name, description, history, plot,
  tokenize = 'unicode61 remove_diacritics 2'
);
`);

const hasAllodsFtsTriggers = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='trigger' AND name='allods_fts_ai'"
).get();
if(!hasAllodsFtsTriggers){
  db.exec(`
CREATE TRIGGER allods_fts_ai AFTER INSERT ON allods BEGIN
  INSERT INTO allods_fts(id, name, description, history, plot)
  VALUES (new.id, new.name, new.description, new.history, new.plot);
END;
CREATE TRIGGER allods_fts_ad AFTER DELETE ON allods BEGIN
  DELETE FROM allods_fts WHERE id = old.id;
END;
CREATE TRIGGER allods_fts_au AFTER UPDATE ON allods BEGIN
  DELETE FROM allods_fts WHERE id = old.id;
  INSERT INTO allods_fts(id, name, description, history, plot)
  VALUES (new.id, new.name, new.description, new.history, new.plot);
END;
`);
}

// бэкафилл — если в allods уже есть записи (обновление существующей базы,
// где allods_fts только что создалась пустой выше), а в allods_fts их ещё
// нет, заполняем разово. Сравниваем по количеству строк, а не наличием
// таблицы — то же самое условие защищает от повторного бэкафилла на
// каждом старте, когда индекс уже наполнен.
{
  const allodsCount = db.prepare('SELECT COUNT(*) AS n FROM allods').get().n;
  const ftsCount = db.prepare('SELECT COUNT(*) AS n FROM allods_fts').get().n;
  if(allodsCount > 0 && ftsCount === 0){
    console.log('Миграция: заполняю полнотекстовый индекс (allods_fts) из существующих данных...');
    db.exec(`
      INSERT INTO allods_fts(id, name, description, history, plot)
      SELECT id, name, description, history, plot FROM allods
    `);
  }
}

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
if(!allodCols.includes('year_appeared')){
  console.log('Миграция: добавляю колонки year_appeared/year_disappeared в таблицу allods...');
  db.exec("ALTER TABLE allods ADD COLUMN year_appeared INTEGER");
  db.exec("ALTER TABLE allods ADD COLUMN year_disappeared INTEGER");
}
if(!allodCols.includes('archipelago_id')){
  console.log('Миграция: добавляю колонку archipelago_id в таблицу allods...');
  // ON DELETE SET NULL: удаление архипелага не должно удалять острова —
  // они просто открепляются (см. обсуждение роадмапа)
  db.exec("ALTER TABLE allods ADD COLUMN archipelago_id TEXT REFERENCES archipelagos(id) ON DELETE SET NULL");

  // авто-создание архипелагов из уже введённых текстовых значений — по
  // одной записи на уникальную пару (project, archipelago), острова с этим
  // текстом сразу привязываются. Дальше эти архипелаги — обычные записи,
  // управляются через UI как любые другие (переименование/объединение и
  // т.п.), это только отправная точка, а не разовый снимок для отображения.
  const distinctArchs = db.prepare(
    "SELECT DISTINCT project, archipelago FROM allods WHERE archipelago IS NOT NULL AND TRIM(archipelago) <> ''"
  ).all();
  if(distinctArchs.length){
    const insertArch = db.prepare('INSERT INTO archipelagos (id, project, name, created_at) VALUES (?,?,?,?)');
    const linkAllods = db.prepare('UPDATE allods SET archipelago_id=? WHERE project=? AND archipelago=?');
    const tx = db.transaction((rows)=>{
      rows.forEach(r=>{
        const id = 'arch_' + crypto.randomBytes(6).toString('hex');
        insertArch.run(id, r.project, r.archipelago, Date.now());
        linkAllods.run(id, r.project, r.archipelago);
      });
    });
    tx(distinctArchs);
    console.log(`Миграция: авто-создано архипелагов из текстовых значений: ${distinctArchs.length}`);
  }
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

// миграция: базы до введения ролей — все существующие аккаунты становятся
// 'admin' (сохраняем текущий уровень доступа, никого не понижаем молча);
// новые аккаунты, приглашённые уже ПОСЛЕ этой миграции, получают 'editor' по
// умолчанию в routes/auth.js, если админ явно не укажет роль 'admin'
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c=>c.name);
if(userCols.length && !userCols.includes('role')){
  console.log('Миграция: добавляю роли редакторов (существующие аккаунты становятся admin)...');
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
}
if(userCols.length && !userCols.includes('must_change_password')){
  console.log('Миграция: добавляю флаг обязательной смены пароля (существующие аккаунты — без принуждения)...');
  db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
}

// дефолтный аккаунт admin/admin0000 — защита от дурака: если на сервере
// вообще нет ни одного пользователя (совсем свежая база, и легаси-миграция
// выше не сработала — например, ей неоткуда было взять старый аккаунт),
// заводим его сами, а не оставляем сайт без единого способа войти до тех
// пор, пока кто-то не пройдёт полностью безопасный, но необязательный
// bootstrap-экран регистрации. must_change_password=1 — форсируем смену
// пароля при первом входе (см. requireAuth-гейт на фронтенде и в /auth).
{
  const hasAnyUserNow = db.prepare('SELECT id FROM users LIMIT 1').get();
  if(!hasAnyUserNow){
    console.log('На сервере нет ни одного аккаунта — создаю дефолтный: admin / admin0000 (пароль нужно будет сменить при первом входе).');
    // scryptSync — не async hashPassword() из security/passwords.js: это
    // разовое вычисление при самом старте сервера, ДО того как он начал
    // принимать запросы, а не под конкурентной нагрузкой — как раз тот
    // случай, когда блокировка event loop на пару сотен мс совершенно не
    // страшна (в отличие от логина под нагрузкой, ради которого там был
    // переход на асинхронный scrypt).
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('admin0000', salt, 64).toString('hex');
    db.prepare('INSERT INTO users (username, salt, hash, role, must_change_password, created_at) VALUES (?,?,?,?,?,?)')
      .run('admin', salt, hash, 'admin', 1, Date.now());
  }
}

// миграция: старые базы уже содержали map_annotations со CHECK-ограничением
// на тип ('text'/'line'/'rect'/'circle') и без колонки icon_url — SQLite не
// умеет ALTER-ом снять CHECK, поэтому при необходимости пересобираем таблицу
const annotCols = db.prepare("PRAGMA table_info(map_annotations)").all().map(c=>c.name);
if(annotCols.length && !annotCols.includes('icon_url')){
  console.log('Миграция: обновляю таблицу map_annotations (добавляю тип "icon" для украшений)...');
  db.exec('ALTER TABLE map_annotations RENAME TO map_annotations_old');
  db.exec(`CREATE TABLE map_annotations (
    id TEXT PRIMARY KEY, project TEXT NOT NULL, type TEXT NOT NULL,
    x1 REAL NOT NULL, y1 REAL NOT NULL, x2 REAL, y2 REAL, r REAL,
    text TEXT, icon_url TEXT, color TEXT NOT NULL DEFAULT '#e8c874',
    stroke_width REAL NOT NULL DEFAULT 2, font_size REAL NOT NULL DEFAULT 16,
    created_at INTEGER NOT NULL
  )`);
  db.exec(`INSERT INTO map_annotations (id, project, type, x1, y1, x2, y2, r, text, color, stroke_width, font_size, created_at)
    SELECT id, project, type, x1, y1, x2, y2, r, text, color, stroke_width, font_size, created_at FROM map_annotations_old`);
  db.exec('DROP TABLE map_annotations_old');
  db.exec('CREATE INDEX IF NOT EXISTS idx_annotations_project ON map_annotations(project)');
}

// миграция: points/opacity — простой ADD COLUMN (в отличие от icon_url выше,
// тут не было CHECK-ограничения, которое требовало бы пересоздания таблицы)
const annotCols2 = db.prepare("PRAGMA table_info(map_annotations)").all().map(c=>c.name);
if(annotCols2.length && !annotCols2.includes('points')){
  console.log('Миграция: добавляю поддержку многоточечных фигур (полигон/от руки) и прозрачности...');
  db.exec('ALTER TABLE map_annotations ADD COLUMN points TEXT');
  db.exec("ALTER TABLE map_annotations ADD COLUMN opacity REAL NOT NULL DEFAULT 1");
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

// стартовый набор украшений для слоя рисования — идёт в комплекте (файлы в
// public/assets/decorations/, не в uploads/), но таблица управляемая: через
// настройки редакторы добавляют свои картинки поверх этого набора, не хардкод
const hasDecorations = db.prepare('SELECT id FROM decoration_icons LIMIT 1').get();
if(!hasDecorations){
  const seedDecorations = [
    { id: 'dec_astral', name: 'Астрал', file: 'astral.png' },
    { id: 'dec_astral_turret', name: 'Астральная турель', file: 'astral-turret.png' },
    { id: 'dec_astral_unit', name: 'Астральный юнит', file: 'astral-unit.png' },
    { id: 'dec_astral_ship', name: 'Астральный корабль', file: 'astral-ship.png' },
    { id: 'dec_astral_island', name: 'Астральный остров', file: 'astral-island.png' },
    { id: 'dec_wreckage', name: 'Обломки', file: 'wreckage.png' },
    { id: 'dec_anomaly_1', name: 'Астральная аномалия 1', file: 'astral-anomaly-1.png' },
    { id: 'dec_anomaly_2', name: 'Астральная аномалия 2', file: 'astral-anomaly-2.png' },
    { id: 'dec_anomaly_3', name: 'Астральная аномалия 3', file: 'astral-anomaly-3.png' },
    { id: 'dec_anomaly_4', name: 'Астральная аномалия 4', file: 'astral-anomaly-4.png' },
  ];
  const insertDec = db.prepare('INSERT INTO decoration_icons (id, name, url, created_at) VALUES (?,?,?,?)');
  seedDecorations.forEach(d=> insertDec.run(d.id, d.name, '/assets/decorations/'+d.file, Date.now()));
  console.log(`Засеяно украшений для карты: ${seedDecorations.length}`);
}

// стартовый набор иконок фракций — тоже управляемая таблица, не хардкод;
// это race-уровень (Кания/Гиберлинги/...), отдельно от общих
// Имперский/Лигийский/Эльфийский/Нейтральный аллод, которые уже есть в данных —
// какую иконку на что назначать, решает редактор через настройки
const hasFactionIcons = db.prepare('SELECT id FROM faction_icons LIMIT 1').get();
if(!hasFactionIcons){
  const seedFactionIcons = [
    { id: 'fac_hadagan', faction: 'Хадаган', file: 'hadagan.png' },
    { id: 'fac_praiden', faction: 'Прайден', file: 'praiden.png' },
    { id: 'fac_orc', faction: 'Орки', file: 'orc.png' },
    { id: 'fac_kania', faction: 'Кания', file: 'kania.png' },
    { id: 'fac_undead', faction: 'Нежить', file: 'undead.png' },
    { id: 'fac_aed', faction: 'Аэд', file: 'aed.png' },
    { id: 'fac_elf', faction: 'Эльфы', file: 'elf.png' },
    { id: 'fac_gibberling', faction: 'Гиберлинги', file: 'gibberling.png' },
  ];
  const insertFac = db.prepare('INSERT INTO faction_icons (id, faction, icon_url, created_at) VALUES (?,?,?,?)');
  seedFactionIcons.forEach(f=> insertFac.run(f.id, f.faction, '/assets/factions/'+f.file, Date.now()));
  console.log(`Засеяно иконок фракций: ${seedFactionIcons.length}`);
}

// стартовые записи в глобальном списке источников — ссылки, которыми уже
// пользовались при заполнении лора (см. обсуждение роадмапа), чтобы раздел
// "Источники" не был пустым с первого дня. Управляемая таблица — редакторы
// добавляют/редактируют/удаляют через UI, это только отправная точка.
const hasSources = db.prepare('SELECT id FROM sources LIMIT 1').get();
if(!hasSources){
  const seedSources = [
    { id: 'src_dtf_universe_intro', title: 'Введение в историю вселенной Аллодов', url: 'https://dtf.ru/games/1130550-vvedenie-v-istoriyu-vselennoi-allodov' },
    { id: 'src_forum_140056', title: 'Форум Allods.ru — тема 140056', url: 'https://forum.allods.ru/showthread.php?t=140056' },
    { id: 'src_forum_57641', title: 'Форум Allods.ru — тема 57641', url: 'https://forum.allods.ru/showthread.php?t=57641' },
  ];
  const insertSrc = db.prepare('INSERT INTO sources (id, title, url, note, created_at) VALUES (?,?,?,?,?)');
  seedSources.forEach(s=> insertSrc.run(s.id, s.title, s.url, '', Date.now()));
  console.log(`Засеяно источников: ${seedSources.length}`);
}

// гарантируем, что строка настроек сайта всегда есть (id=1, singleton)
const hasSettings = db.prepare('SELECT id FROM site_settings WHERE id=1').get();
if(!hasSettings){
  db.prepare('INSERT INTO site_settings (id) VALUES (1)').run();
}

module.exports = db;
