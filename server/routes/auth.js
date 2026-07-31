const express = require('express');
const db = require('../db');
const { makeSalt, hashPassword, verifyPassword } = require('../security/passwords');
const rateLimiter = require('../security/rateLimiter');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Zа-яА-ЯёЁ0-9_-]{3,32}$/;

function requireAuth(req, res, next){
  if(req.session && req.session.loggedIn) return next();
  res.status(401).json({ error: 'Требуется вход в аккаунт редактора.' });
}

function countUsers(){
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function publicUser(u){
  return { id: u.id, username: u.username, createdAt: u.created_at };
}

router.get('/status', (req, res)=>{
  res.json({
    hasAccount: countUsers() > 0,
    loggedIn: !!(req.session && req.session.loggedIn),
    username: (req.session && req.session.username) || null,
  });
});

// Список редакторов — для панели «Настройки» (управление аккаунтами).
router.get('/users', requireAuth, (req, res)=>{
  const users = db.prepare('SELECT id, username, created_at FROM users ORDER BY created_at ASC').all();
  res.json(users.map(publicUser));
});

// Первая регистрация на сервере (без аккаунтов вообще) — открытая, создаёт
// первого редактора и сразу логинит. Если хотя бы один аккаунт уже есть —
// создание новых требует входа (это уже приглашение коллеги, а не бутстрап).
router.post('/register', (req, res)=>{
  const isBootstrap = countUsers() === 0;
  if(!isBootstrap && !(req.session && req.session.loggedIn)){
    return res.status(401).json({ error: 'Для добавления нового редактора нужно сначала войти в аккаунт.' });
  }
  const username = (req.body.username || '').trim();
  const { password } = req.body;
  if(!USERNAME_RE.test(username)){
    return res.status(400).json({ error: 'Имя пользователя: 3–32 символа, буквы/цифры/дефис/подчёркивание.' });
  }
  if(!password || password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов.' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if(exists) return res.status(409).json({ error: 'Такое имя пользователя уже занято.' });

  const salt = makeSalt();
  const hash = hashPassword(password, salt);
  const info = db.prepare('INSERT INTO users (username, salt, hash, created_at) VALUES (?,?,?,?)')
    .run(username, salt, hash, Date.now());

  if(isBootstrap){
    req.session.loggedIn = true;
    req.session.userId = info.lastInsertRowid;
    req.session.username = username;
  }
  res.json({ ok: true, user: { id: info.lastInsertRowid, username } });
});

router.post('/login', (req, res)=>{
  const lockState = rateLimiter.checkLocked(req);
  if(lockState.locked){
    return res.status(429).json({ error: `Слишком много неудачных попыток. Повторите через ${lockState.secondsLeft} сек.` });
  }
  const username = (req.body.username || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  const { password } = req.body;
  // сверяем пароль даже если пользователь не найден (с фиктивной солью) —
  // чтобы по времени ответа нельзя было угадать, существует ли имя пользователя
  const ok = user
    ? verifyPassword(password || '', user.salt, user.hash)
    : (hashPassword(password || '', 'нет-такого-имени-пользователя'), false);
  if(!ok){
    rateLimiter.registerFailure(req);
    return res.status(401).json({ error: 'Неверное имя пользователя или пароль.' });
  }
  rateLimiter.registerSuccess(req);
  req.session.loggedIn = true;
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ ok: true, user: { id: user.id, username: user.username } });
});

router.post('/logout', (req, res)=>{
  req.session.destroy(()=> res.json({ ok: true }));
});

// Смена собственного пароля (требует текущий пароль).
router.post('/password', requireAuth, (req, res)=>{
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if(!user) return res.status(404).json({ error: 'Аккаунт не найден.' });
  const { currentPassword, newPassword } = req.body;
  if(!verifyPassword(currentPassword || '', user.salt, user.hash)){
    return res.status(401).json({ error: 'Текущий пароль указан неверно.' });
  }
  if(!newPassword || newPassword.length < 8){
    return res.status(400).json({ error: 'Новый пароль должен быть не короче 8 символов.' });
  }
  const salt = makeSalt();
  const hash = hashPassword(newPassword, salt);
  db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').run(salt, hash, user.id);
  res.json({ ok: true });
});

// Удаление чужого (или своего) аккаунта редактора. Нельзя удалить последнего
// оставшегося — иначе сайт останется без единого способа войти в редактор
// (кроме npm run reset-password на сервере).
router.delete('/users/:id', requireAuth, (req, res)=>{
  const id = Number(req.params.id);
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if(!user) return res.status(404).json({ error: 'Пользователь не найден.' });
  if(countUsers() <= 1){
    return res.status(400).json({ error: 'Нельзя удалить последнего оставшегося редактора.' });
  }
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  // если удалили самого себя — сразу разлогиниваем эту сессию
  if(req.session.userId === id){
    req.session.destroy(()=> res.json({ ok: true, selfDeleted: true }));
  }else{
    res.json({ ok: true, selfDeleted: false });
  }
});

module.exports = { router, requireAuth };
