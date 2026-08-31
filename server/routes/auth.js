const express = require('express');
const db = require('../db');
const { makeSalt, hashPassword, verifyPassword } = require('../security/passwords');
const rateLimiter = require('../security/rateLimiter');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Zа-яА-ЯёЁ0-9_-]{3,32}$/;
const VALID_ROLES = ['editor', 'admin'];

function requireAuth(req, res, next){
  if(req.session && req.session.loggedIn) return next();
  res.status(401).json({ error: 'Требуется вход в аккаунт редактора.' });
}

function requireAdmin(req, res, next){
  if(req.session && req.session.loggedIn && req.session.role === 'admin') return next();
  if(req.session && req.session.loggedIn){
    return res.status(403).json({ error: 'Требуются права администратора.' });
  }
  res.status(401).json({ error: 'Требуется вход в аккаунт редактора.' });
}

// Скоупинг прав по проекту — админы всегда видят/редактируют всё; у
// редактора allowedProjects===null означает "без ограничений" (как было
// раньше для всех, поведение по умолчанию не меняется для существующих
// аккаунтов), непустой массив — редактировать можно только контент этих
// проектов. Опирается на req.session (не перечитывает БД на каждый запрос,
// тот же компромисс, что и у role — при живой смене прав другому
// пользователю самому ему нужно перелогиниться, чтобы новые ограничения
// вступили в силу; self-change применяется к своей сессии сразу, см. ниже).
function hasProjectAccess(req, project){
  if(!req.session) return false;
  if(req.session.role === 'admin') return true;
  if(req.session.allowedProjects == null) return true; // без ограничений
  return req.session.allowedProjects.includes(project);
}

function requireProjectAccess(req, res, project){
  if(hasProjectAccess(req, project)) return true;
  res.status(403).json({ error: `Нет прав на редактирование проекта «${project}».` });
  return false;
}

// null — без ограничений (по умолчанию); либо массив непустых строк.
// Не проверяем, что строки совпадают с текущим списком PROJECTS — тот чисто
// фронтенд-константа (см. public/js/projects.js), сервер про неё не знает
// и специально не привязывается к её содержимому.
function validateAllowedProjects(value){
  if(value === null || value === undefined) return { value: null };
  if(!Array.isArray(value) || !value.every(p => typeof p === 'string' && p.trim())){
    return { error: 'allowedProjects должен быть массивом непустых строк или null.' };
  }
  return { value: value.length ? value : null }; // пустой массив == без ограничений, не "нет доступа никуда"
}

function countUsers(){
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function publicUser(u){
  return { id: u.id, username: u.username, role: u.role, mustChangePassword: !!u.must_change_password, createdAt: u.created_at, allowedProjects: parseAllowedProjects(u.allowed_projects) };
}

// allowed_projects в БД хранится как JSON-строка массива или NULL. Раньше
// это поле только объявили в схеме и нигде не читали/не писали — сессия
// логина его не подхватывала, поэтому hasProjectAccess() всегда молча
// пропускала всех (allowedProjects всегда undefined == null == "без
// ограничений"), независимо от того, что реально лежало в БД. Починено:
// логин теперь кладёт распарсенное значение в сессию (см. ниже).
function parseAllowedProjects(raw){
  if(!raw) return null;
  try{ const arr = JSON.parse(raw); return Array.isArray(arr) && arr.length ? arr : null; }
  catch(e){ return null; }
}

// SQLite's COLLATE NOCASE only case-folds ASCII (A-Z/a-z) — 'Империя' и
// 'империя' в кириллице SQLite считает РАЗНЫМИ строками даже с COLLATE
// NOCASE в запросе или в схеме таблицы. Логин у нас разрешает кириллицу
// (см. USERNAME_RE), поэтому регистронезависимый поиск делаем в JS через
// String.toLowerCase(), которая кириллицу обрабатывает правильно.
function findUserByUsername(username){
  const target = username.toLowerCase();
  return db.prepare('SELECT * FROM users').all().find(u => u.username.toLowerCase() === target);
}

router.get('/status', (req, res)=>{
  res.json({
    hasAccount: countUsers() > 0,
    loggedIn: !!(req.session && req.session.loggedIn),
    username: (req.session && req.session.username) || null,
    role: (req.session && req.session.role) || null,
    allowedProjects: (req.session && req.session.allowedProjects) || null,
    mustChangePassword: !!(req.session && req.session.mustChangePassword),
  });
});

// Список редакторов — для панели «Настройки → Пользователи» (только админ).
router.get('/users', requireAdmin, (req, res)=>{
  const users = db.prepare('SELECT id, username, role, must_change_password, created_at, allowed_projects FROM users ORDER BY created_at ASC').all();
  res.json(users.map(publicUser));
});

// Первая регистрация на сервере (без аккаунтов вообще) — открытая, создаёт
// первого редактора с ролью admin и сразу логинит. Если хотя бы один
// аккаунт уже есть — приглашение нового требует прав администратора (не
// просто входа) и по умолчанию создаёт роль 'editor', если явно не указана
// 'admin'.
router.post('/register', async (req, res, next)=>{
  try{
    const isBootstrap = countUsers() === 0;
    if(!isBootstrap){
      if(!(req.session && req.session.loggedIn)){
        return res.status(401).json({ error: 'Для добавления нового редактора нужно сначала войти в аккаунт.' });
      }
      if(req.session.role !== 'admin'){
        return res.status(403).json({ error: 'Приглашать новых пользователей может только администратор.' });
      }
    }
    const username = (req.body.username || '').trim();
    const { password } = req.body;
    if(!USERNAME_RE.test(username)){
      return res.status(400).json({ error: 'Имя пользователя: 3–32 символа, буквы/цифры/дефис/подчёркивание.' });
    }
    if(!password || password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов.' });
    const exists = findUserByUsername(username);
    if(exists) return res.status(409).json({ error: 'Такое имя пользователя уже занято.' });

    let role = 'editor';
    if(isBootstrap){
      role = 'admin';
    }else if(req.body.role !== undefined){
      if(!VALID_ROLES.includes(req.body.role)){
        return res.status(400).json({ error: `Роль должна быть одной из: ${VALID_ROLES.join(', ')}.` });
      }
      role = req.body.role;
    }

    const salt = makeSalt();
    const hash = await hashPassword(password, salt);
    // must_change_password: для приглашённых (не bootstrap) — начальный
    // пароль выбрал не сам пользователь, а администратор, так что просим
    // сменить при первом входе; для bootstrap — пароль свой, форсировать нечего
    const mustChangePassword = isBootstrap ? 0 : 1;
    const info = db.prepare('INSERT INTO users (username, salt, hash, role, must_change_password, created_at) VALUES (?,?,?,?,?,?)')
      .run(username, salt, hash, role, mustChangePassword, Date.now());

    if(isBootstrap){
      req.session.regenerate(err=>{
        if(err) return next(err);
        req.session.loggedIn = true;
        req.session.userId = info.lastInsertRowid;
        req.session.username = username;
        req.session.role = role;
        req.session.mustChangePassword = false;
        req.session.save(err2=>{
          if(err2) return next(err2);
          res.json({ ok: true, user: { id: info.lastInsertRowid, username, role, mustChangePassword: false } });
        });
      });
      return;
    }
    res.json({ ok: true, user: { id: info.lastInsertRowid, username, role, mustChangePassword: !!mustChangePassword } });
  }catch(err){ next(err); }
});

router.post('/login', async (req, res, next)=>{
  try{
    const username = (req.body.username || '').trim();
    const lockState = rateLimiter.checkLocked(req, username);
    if(lockState.locked){
      return res.status(429).json({ error: `Слишком много неудачных попыток. Повторите через ${lockState.secondsLeft} сек.` });
    }
    const user = findUserByUsername(username);
    const { password } = req.body;
    // сверяем пароль даже если пользователь не найден (с фиктивной солью) —
    // чтобы по времени ответа нельзя было угадать, существует ли имя пользователя
    const ok = user
      ? await verifyPassword(password || '', user.salt, user.hash)
      : (await hashPassword(password || '', 'нет-такого-имени-пользователя'), false);
    if(!ok){
      rateLimiter.registerFailure(req, username);
      return res.status(401).json({ error: 'Неверное имя пользователя или пароль.' });
    }
    rateLimiter.registerSuccess(req, username);
    // Пересоздаём ID сессии при входе (не просто переиспользуем текущий) —
    // защита от session fixation: если у кого-то был заранее известный ID
    // сессии этого браузера (до входа), после логина он не станет валидным
    // залогиненным ID. session.regenerate уничтожает старую запись в сторе
    // и выдаёт новый sid, поля на req.session нужно проставлять уже после.
    req.session.regenerate(err=>{
      if(err) return next(err);
      req.session.loggedIn = true;
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role;
      req.session.allowedProjects = parseAllowedProjects(user.allowed_projects);
      req.session.mustChangePassword = !!user.must_change_password;
      req.session.save(err2=>{
        if(err2) return next(err2);
        res.json({ ok: true, user: publicUser(user) });
      });
    });
  }catch(err){ next(err); }
});

router.post('/logout', (req, res)=>{
  req.session.destroy(()=> res.json({ ok: true }));
});

// Смена собственного пароля (требует текущий пароль).
router.post('/password', requireAuth, async (req, res, next)=>{
  try{
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if(!user) return res.status(404).json({ error: 'Аккаунт не найден.' });
    const { currentPassword, newPassword } = req.body;
    // при ОБЯЗАТЕЛЬНОЙ смене пароля (must_change_password) текущий пароль не
    // спрашиваем — человек его только что ввёл при входе секунду назад,
    // повторный запрос той же строки — лишнее трение, не дополнительная
    // защита (сессия уже полностью аутентифицирована). Для добровольной
    // смены пароля из настроек — как и раньше, текущий пароль обязателен.
    if(!user.must_change_password){
      if(!(await verifyPassword(currentPassword || '', user.salt, user.hash))){
        return res.status(401).json({ error: 'Текущий пароль указан неверно.' });
      }
    }
    if(!newPassword || newPassword.length < 8){
      return res.status(400).json({ error: 'Новый пароль должен быть не короче 8 символов.' });
    }
    const salt = makeSalt();
    const hash = await hashPassword(newPassword, salt);
    db.prepare('UPDATE users SET salt=?, hash=?, must_change_password=0 WHERE id=?').run(salt, hash, user.id);
    req.session.mustChangePassword = false;
    req.session.save(err=>{
      if(err) return next(err);
      res.json({ ok: true });
    });
  }catch(err){ next(err); }
});

// Изменение существующего пользователя — смена роли и/или принудительный
// сброс пароля (админ подозревает компрометацию — включает флаг, при
// следующем входе пользователя заставит сменить пароль, тем же путём, что
// и обычное приглашение). Раньше единственным способом сменить роль или
// заставить сменить пароль было удалить аккаунт и завести заново.
router.patch('/users/:id', requireAdmin, (req, res)=>{
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if(!user) return res.status(404).json({ error: 'Пользователь не найден.' });

  if('role' in req.body){
    const role = req.body.role;
    if(!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Неизвестная роль.' });
    // та же защита, что и на удаление ниже — нельзя оставить сайт без
    // единого администратора
    if(user.role === 'admin' && role !== 'admin'){
      const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n;
      if(adminCount <= 1) return res.status(400).json({ error: 'Нельзя понизить последнего оставшегося администратора.' });
    }
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
    // если админ меняет роль самому себе — применяем сразу к текущей сессии,
    // иначе requireAdmin на следующем же запросе будет опираться на старую
    // роль из сессии, а не на то, что реально в базе
    if(req.session.userId === id) req.session.role = role;
  }

  if('allowedProjects' in req.body){
    const parsed = validateAllowedProjects(req.body.allowedProjects);
    if(parsed.error) return res.status(400).json({ error: parsed.error });
    // Последнего администратора трогать не о чем — requireProjectAccess у
    // роли admin всегда возвращает true, so ограничивать проект админу
    // бессмысленно (и не проверяем это как отдельную защиту — не критично,
    // просто сохранённое значение будет молча ни на что не влиять).
    db.prepare('UPDATE users SET allowed_projects=? WHERE id=?')
      .run(parsed.value ? JSON.stringify(parsed.value) : null, id);
    // тот же паттерн, что и для role выше — если админ меняет ограничения
    // самому себе, применяем сразу к текущей сессии
    if(req.session.userId === id) req.session.allowedProjects = parsed.value;
  }

  if(req.body.forcePasswordReset === true){
    db.prepare('UPDATE users SET must_change_password=1 WHERE id=?').run(id);
  }

  res.json(publicUser(db.prepare('SELECT id, username, role, must_change_password, created_at, allowed_projects FROM users WHERE id=?').get(id)));
});

// Удаление чужого (или своего) аккаунта редактора — только админ. Нельзя
// удалить последнего оставшегося аккаунта вообще и нельзя удалить последнего
// оставшегося admin — иначе сайт останется без единого способа управлять
// пользователями/настройками/бэкапами (кроме npm run reset-password).
router.delete('/users/:id', requireAdmin, (req, res)=>{
  const id = Number(req.params.id);
  const user = db.prepare('SELECT id, role FROM users WHERE id=?').get(id);
  if(!user) return res.status(404).json({ error: 'Пользователь не найден.' });
  if(countUsers() <= 1){
    return res.status(400).json({ error: 'Нельзя удалить последнего оставшегося пользователя.' });
  }
  if(user.role === 'admin'){
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n;
    if(adminCount <= 1){
      return res.status(400).json({ error: 'Нельзя удалить последнего оставшегося администратора.' });
    }
  }
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  // если удалили самого себя — сразу разлогиниваем эту сессию
  if(req.session.userId === id){
    req.session.destroy(()=> res.json({ ok: true, selfDeleted: true }));
  }else{
    res.json({ ok: true, selfDeleted: false });
  }
});

module.exports = { router, requireAuth, requireAdmin, requireProjectAccess, hasProjectAccess };
