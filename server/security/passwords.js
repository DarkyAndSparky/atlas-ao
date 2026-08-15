const crypto = require('crypto');

function makeSalt(){ return crypto.randomBytes(16).toString('hex'); }

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

module.exports = { makeSalt, hashPassword, verifyPassword };
