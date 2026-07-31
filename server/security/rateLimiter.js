// Простой rate-limit для входа: N неудачных попыток -> временная блокировка IP.
// Для одного локального пользователя этого достаточно; при рестарте сервера сбрасывается.

const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000; // 5 минут

const attempts = new Map(); // ip -> { count, lockedUntil }

function keyFor(req){
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function checkLocked(req){
  const rec = attempts.get(keyFor(req));
  if(!rec) return { locked: false };
  if(rec.lockedUntil && Date.now() < rec.lockedUntil){
    const secondsLeft = Math.ceil((rec.lockedUntil - Date.now())/1000);
    return { locked: true, secondsLeft };
  }
  return { locked: false };
}

function registerFailure(req){
  const key = keyFor(req);
  const rec = attempts.get(key) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if(rec.count >= MAX_ATTEMPTS){
    rec.lockedUntil = Date.now() + LOCK_MS;
    rec.count = 0;
  }
  attempts.set(key, rec);
}

function registerSuccess(req){
  attempts.delete(keyFor(req));
}

// без этого Map будет расти бесконечно на долгоживущем процессе — раз в час выкидываем
// записи, у которых давно истекла блокировка и не было новых попыток
setInterval(()=>{
  const now = Date.now();
  for(const [key, rec] of attempts){
    if((!rec.lockedUntil || rec.lockedUntil < now) && rec.count === 0) attempts.delete(key);
  }
}, 60*60*1000).unref();

module.exports = { checkLocked, registerFailure, registerSuccess, MAX_ATTEMPTS };
