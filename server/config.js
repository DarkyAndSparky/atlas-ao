const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_FILE = path.join(__dirname, '.session-secret');

function getSessionSecret(){
  if(process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if(fs.existsSync(SECRET_FILE)){
    return fs.readFileSync(SECRET_FILE, 'utf-8').trim();
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  console.log('Сгенерирован новый секрет сессии (server/.session-secret) — не коммитьте этот файл.');
  return secret;
}

module.exports = { getSessionSecret };
