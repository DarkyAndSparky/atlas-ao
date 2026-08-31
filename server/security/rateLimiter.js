// Rate-limit для входа: N неудачных попыток -> временная блокировка.
// Два независимых ключа — по IP И по конкретному аккаунту (нормализованный
// логин, нижний регистр) — блокировка срабатывает по любому из двух.
//
// Раньше был только ключ по IP: подбор пароля к ОДНОМУ конкретному
// аккаунту с разных IP (VPN-ротация, ботнет, просто два браузера) вообще
// не ловился — лимит считался отдельно на каждый IP, и каждый из них мог
// честно исчерпать свою квоту попыток против одного и того же логина.
// Подсмотрено в it-assets (server/middleware/rateLimit.js) — независимая
// реализация с тем же паттерном, перенесено под уже существующий здесь
// интерфейс checkLocked/registerFailure/registerSuccess.

const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000; // 5 минут

const attemptsByIp = new Map();     // ip -> { count, lockedUntil }
const attemptsByTarget = new Map(); // нормализованный логин -> { count, lockedUntil }

function ipKeyFor(req){
  return req.ip || req.connection?.remoteAddress || 'unknown';
}
function targetKeyFor(username){
  return (username || '').trim().toLowerCase();
}

function checkOne(map, key){
  const rec = map.get(key);
  if(!rec) return { locked: false };
  if(rec.lockedUntil && Date.now() < rec.lockedUntil){
    const secondsLeft = Math.ceil((rec.lockedUntil - Date.now())/1000);
    return { locked: true, secondsLeft };
  }
  return { locked: false };
}
function registerFailureOne(map, key){
  const rec = map.get(key) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if(rec.count >= MAX_ATTEMPTS){
    rec.lockedUntil = Date.now() + LOCK_MS;
    rec.count = 0;
  }
  map.set(key, rec);
}

// username необязателен — вызовы без него (например, до того как тело
// запроса распарсено) проверяют/учитывают только IP-ключ, как и раньше;
// login-роут передаёт его, как только username становится известен.
function checkLocked(req, username){
  const byIp = checkOne(attemptsByIp, ipKeyFor(req));
  if(byIp.locked) return byIp;
  if(username){
    const byTarget = checkOne(attemptsByTarget, targetKeyFor(username));
    if(byTarget.locked) return byTarget;
  }
  return { locked: false };
}

function registerFailure(req, username){
  registerFailureOne(attemptsByIp, ipKeyFor(req));
  if(username) registerFailureOne(attemptsByTarget, targetKeyFor(username));
}

function registerSuccess(req, username){
  attemptsByIp.delete(ipKeyFor(req));
  if(username) attemptsByTarget.delete(targetKeyFor(username));
}

// без этого оба Map будут расти бесконечно на долгоживущем процессе — раз
// в час выкидываем записи, у которых давно истекла блокировка и не было
// новых попыток
setInterval(()=>{
  const now = Date.now();
  for(const map of [attemptsByIp, attemptsByTarget]){
    for(const [key, rec] of map){
      if((!rec.lockedUntil || rec.lockedUntil < now) && rec.count === 0) map.delete(key);
    }
  }
}, 60*60*1000).unref();

module.exports = { checkLocked, registerFailure, registerSuccess, MAX_ATTEMPTS };
