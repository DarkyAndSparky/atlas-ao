const fs = require('fs');
const path = require('path');
const os = require('os');

// Переводы строк в PEM нормализуем везде — на Windows файлы иногда
// оказываются с \r\n (особенно если их когда-то открывали/сохраняли в
// текстовом редакторе), а некоторые парсеры TLS от этого спотыкаются.
function normalizePem(s){
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim() + '\n';
}

function isValidPem(s){
  return typeof s === 'string' && s.includes('BEGIN');
}

// IP-адреса локальных сетевых интерфейсов (не loopback) — нужны в SAN
// самоподписанного сертификата, чтобы открыть сайт с телефона по IP в той
// же Wi-Fi-сети без ошибки "имя в сертификате не совпадает с адресом".
function localNetworkAddresses(){
  const nets = os.networkInterfaces();
  const addrs = [];
  for(const name of Object.keys(nets)){
    for(const net of (nets[name]||[])){
      if(net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

function tryOpenssl(keyPath, certPath){
  try{
    const { execSync } = require('child_process');
    execSync('openssl version', { stdio: 'pipe' });
    const cmd = [
      'openssl req -x509 -newkey rsa:2048 -nodes',
      `-keyout "${keyPath}"`,
      `-out "${certPath}"`,
      '-days 3650',
      '-sha256',
      '-subj "/CN=localhost"',
      '-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"',
    ].join(' ');
    execSync(cmd, { stdio: 'pipe' });
    const key = normalizePem(fs.readFileSync(keyPath, 'utf8'));
    const cert = normalizePem(fs.readFileSync(certPath, 'utf8'));
    if(isValidPem(key) && isValidPem(cert)){
      fs.writeFileSync(keyPath, key, { mode: 0o600 });
      fs.writeFileSync(certPath, cert, { mode: 0o644 });
      return { key, cert };
    }
  }catch(e){ /* openssl недоступен или упал — пробуем следующую стратегию */ }
  return null;
}

function trySelfsigned(keyPath, certPath){
  let selfsigned;
  try{ selfsigned = require('selfsigned'); }
  catch(e){ return null; }
  try{
    const altNames = [
      { type: 2, value: 'localhost' }, // dNSName
      { type: 7, ip: '127.0.0.1' },    // iPAddress
      ...localNetworkAddresses().map(ip => ({ type: 7, ip })),
    ];
    const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
      days: 3650,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames }],
    });
    const key = normalizePem(pems.private);
    const cert = normalizePem(pems.cert);
    if(!isValidPem(key) || !isValidPem(cert)) throw new Error('PEM записан некорректно');
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    fs.writeFileSync(certPath, cert, { mode: 0o644 });
    return { key, cert };
  }catch(e){
    console.error('[HTTPS] selfsigned ошибка:', e.message);
    return null;
  }
}

// Возвращает { key, cert, source } (PEM-строки) или null, если сертификат
// получить не удалось никак — вызывающий код (server.js) в этом случае
// откатывается на обычный HTTP, а не падает.
//
// Порядок:
// 1. Готовый реальный сертификат (ATLAS_CERT_FILE/ATLAS_KEY_FILE) — для
//    настоящей публикации в интернете. Сюда указывают на файлы, которые
//    выпустил и обновляет ЛЮБОЙ внешний инструмент (обычно certbot) —
//    server.js сам ничего не знает про Let's Encrypt/ACME, только читает
//    готовые PEM. Не кэшируется — читаем заново при каждом старте, чтобы
//    подхватывать продление сертификата внешним certbot без пересборки
//    (перечитывание происходит при рестарте процесса; см. README про
//    hook certbot renew --deploy-hook для автоматического рестарта).
// 2. Локальный самоподписанный, закэшированный на диске в certDir — чтобы
//    браузer не просил заново подтверждать исключение при каждом рестарте.
//    Пробуем openssl (если есть в PATH), иначе npm-пакет selfsigned.
function resolveHttpsCert(certDir){
  const realCertFile = process.env.ATLAS_CERT_FILE;
  const realKeyFile = process.env.ATLAS_KEY_FILE;
  if(realCertFile && realKeyFile){
    if(fs.existsSync(realCertFile) && fs.existsSync(realKeyFile)){
      try{
        const cert = normalizePem(fs.readFileSync(realCertFile, 'utf8'));
        const key = normalizePem(fs.readFileSync(realKeyFile, 'utf8'));
        if(isValidPem(cert) && isValidPem(key)){
          console.log(`[HTTPS] Используется реальный сертификат: ${realCertFile}`);
          return { key, cert, source: 'external' };
        }
      }catch(e){ console.error('[HTTPS] Не удалось прочитать ATLAS_CERT_FILE/ATLAS_KEY_FILE:', e.message); }
    }else{
      console.warn(`[HTTPS] ATLAS_CERT_FILE/ATLAS_KEY_FILE заданы, но файлы не найдены (${realCertFile}) — использую локальный самоподписанный.`);
    }
  }

  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');
  if(fs.existsSync(keyPath) && fs.existsSync(certPath)){
    try{
      const key = fs.readFileSync(keyPath, 'utf8');
      const cert = fs.readFileSync(certPath, 'utf8');
      if(isValidPem(key) && isValidPem(cert)) return { key, cert, source: 'self-signed-cached' };
      console.log('[HTTPS] Закэшированный сертификат повреждён, пересоздаю...');
    }catch(e){ /* пересоздаём ниже */ }
  }

  fs.mkdirSync(certDir, { recursive: true });
  const viaOpenssl = tryOpenssl(keyPath, certPath);
  if(viaOpenssl){
    console.log('[HTTPS] ✓ Самоподписанный сертификат создан через openssl');
    return { ...viaOpenssl, source: 'self-signed-openssl' };
  }
  const viaSelfsigned = trySelfsigned(keyPath, certPath);
  if(viaSelfsigned){
    console.log('[HTTPS] ✓ Самоподписанный сертификат создан через пакет selfsigned');
    return { ...viaSelfsigned, source: 'self-signed-npm' };
  }

  console.warn('[HTTPS] ⚠ Не удалось создать сертификат ни через openssl, ни через selfsigned — сервер запустится по HTTP.');
  return null;
}

module.exports = { resolveHttpsCert, normalizePem, isValidPem, localNetworkAddresses };
