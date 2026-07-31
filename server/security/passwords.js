const crypto = require('crypto');

function makeSalt(){ return crypto.randomBytes(16).toString('hex'); }

function hashPassword(password, salt){
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash){
  const hash = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if(a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { makeSalt, hashPassword, verifyPassword };
