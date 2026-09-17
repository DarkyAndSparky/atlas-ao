const crypto = require('crypto');

function makeSalt(){ return crypto.randomBytes(16).toString('hex'); }

// Тот же безопасный-для-переписывания-вручную алфавит, что и у
// bootstrap-пароля в db.js (без 0/O/1/l/I) — используется там же и в
// новом self-service сбросе пароля (routes/auth.js, роадмап п.14), где
// админ так же передаёт сгенерированный пароль пользователю на словах/в
// чате, а не по защищённому каналу.
const READABLE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generateRandomPassword(length = 16){
  return Array.from(crypto.randomBytes(length))
    .map(b => READABLE_ALPHABET[b % READABLE_ALPHABET.length])
    .join('');
}

// crypto.scryptSync блокирует весь event loop Node на время хэширования (это
// специально медленная функция — так и задумано для защиты от подбора пароля).
// При параллельных запросах (несколько воркеров Playwright логинятся почти
// одновременно, или просто два человека) вызовы встают в очередь и блокируют
// ВСЕ остальные запросы к серверу, пока каждый scrypt не досчитается — на
// медленной машине это может занять секунды и выглядит как «сервер завис».
// Асинхронный crypto.scrypt считает в пуле потоков libuv и не блокирует
// обработку остальных запросов, пока идёт хэширование.
function hashPassword(password, salt){
  return new Promise((resolve, reject)=>{
    crypto.scrypt(password, salt, 64, (err, derivedKey)=>{
      if(err) return reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });
}

async function verifyPassword(password, salt, expectedHash){
  const hash = await hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if(a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { makeSalt, hashPassword, verifyPassword, generateRandomPassword };
