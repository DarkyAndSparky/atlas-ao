// Права по умолчанию (0o077 = только владелец читает/пишет, group/other —
// ничего) для ЛЮБОГО файла, который процесс создаст дальше — БД с хэшами
// паролей, session-secret, bootstrap-password, backups/, uploads/. Первая
// строка файла — до любого require, который мог бы создать файл раньше
// (db.js делает то же самое сам на случай прямого запуска через createApp()
// в тестах, минуя этот файл — идемпотентно, дублирование безопасно).
process.umask(0o077);

// Без этих двух перехватчиков одно необработанное исключение в ЛЮБОМ из
// async-роутов (забытый try/catch, отклонённый промис без .catch) роняет
// ВЕСЬ процесс целиком — это дефолтное поведение Node 15+ для
// unhandledRejection, а не что-то специфичное для этого кода. Один плохой
// запрос от одного пользователя убивал бы сайт для всех остальных. Здесь
// логируем и продолжаем работу — тот же самый компромисс (лучше залогированная
// ошибка на одном запросе, чем полный даунтайм), что уже сделан в глобальном
// error-хендлере Express (app.js) для синхронных ошибок в самих роутах.
process.on('unhandledRejection', (reason)=>{
  console.error('Необработанный rejected promise — процесс продолжает работу:', reason);
});
process.on('uncaughtException', (err)=>{
  console.error('Необработанное исключение — процесс продолжает работу:', err);
});

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { execFile, exec } = require('child_process');
const { createApp } = require('./app');
const { startBackupScheduler } = require('./backupScheduler');
const { resolveHttpsCert } = require('./certs');

const VERSION = (()=>{
  try{ return fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf-8').trim(); }
  catch(e){ return 'dev'; }
})();

const app = createApp();

function localNetworkAddress(){
  const nets = os.networkInterfaces();
  for(const name of Object.keys(nets)){
    for(const net of nets[name]){
      if(net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

// Открывает браузер на локальном адресе — но только отсюда, из callback
// listen(), а не из start.bat/start.sh таймером/задержкой "на глаз". Раньше
// start.bat открывал браузер ДО запуска node server.js вообще (`start "url"`
// шёл строкой раньше `node server.js`), а start.sh — через фиксированный
// sleep 1.5с, который на медленной машине/первом запуске (засев 318 островов
// в БД, генерация сертификата и т.п.) мог не хватить. listen()-коллбэк —
// единственное место, когда сервер гарантированно уже принимает соединения.
// Включается только по явному флагу из start.bat/start.sh — сам по себе
// `node server.js` браузер не открывает.
function openBrowser(url){
  const platform = process.platform;
  if(platform === 'win32'){
    // `start` в cmd.exe трактует первый кавычечный аргумент как заголовок
    // окна, а не как то, что открывать — отсюда обязательная пустая пара
    // кавычек `""` перед самим URL. Через exec (с реальным шеллом), не
    // execFile — execFile без шелла не проходит через парсер cmd.exe, и это
    // экранирование там просто не сработает как надо.
    exec(`start "" "${url}"`, (err)=>{
      if(err) console.warn('Не удалось открыть браузер автоматически:', err.message);
    });
    return;
  }
  const cmd = platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(cmd, [url], (err)=>{
    if(err) console.warn('Не удалось открыть браузер автоматически:', err.message);
  });
}

function printBanner({ proto, port, extraLines }){
  const localUrl = `${proto}://localhost:${port}`;
  const netAddr = localNetworkAddress();
  const netUrl = netAddr ? `${proto}://${netAddr}:${port}` : null;
  const dbPath = process.env.ATLAS_DB_PATH || path.join(__dirname, 'atlas.db');
  const backupsDir = process.env.ATLAS_BACKUPS_DIR || path.join(__dirname, '..', 'backups');

  const lines = [
    `  Версия:      ${VERSION}`,
    `  Локально:    ${localUrl}`,
    netUrl ? `  По сети:     ${netUrl}` : null,
    `  База данных: ${dbPath}`,
    `  Node.js:     ${process.version}`,
    ...(extraLines || []),
  ].filter(l => l !== null);

  const rule = '─'.repeat(60);
  console.log('\n' + rule);
  console.log(' 🗺️  Атлас Аллодов — сервер запущен');
  console.log(rule + '\n');
  console.log(lines.join('\n'));
  console.log('\n  Чтобы остановить сервер — нажмите Ctrl+C.\n');
  console.log(rule + '\n');

  startBackupScheduler({ dbPath, backupsDir, db: require('./db') });
  return localUrl;
}

// Отдаёт /.well-known/acme-challenge/* как статику из ATLAS_ACME_WEBROOT,
// если он задан — нужно для certbot в режиме webroot: он кладёт туда файл
// с токеном и ждёт, что его отдадут ПО ОБЫЧНОМУ HTTP на порту 80, ДО того,
// как что-либо редиректнёт на HTTPS. Без этого редирект-сервер ниже сломал
// бы продление/выпуск настоящего сертификата на реальном домене (см.
// certs.js — сам сертификат server.js не выпускает, только читает готовый
// из ATLAS_CERT_FILE/ATLAS_KEY_FILE, а получает его извне именно certbot).
function serveAcmeChallengeOrRedirect(req, res, httpsPort){
  const webroot = process.env.ATLAS_ACME_WEBROOT;
  if(webroot && req.url.startsWith('/.well-known/acme-challenge/')){
    const filePath = path.join(webroot, req.url.replace('/.well-known/acme-challenge/', ''));
    // защита от выхода за пределы webroot через "../" в токене
    if(path.relative(webroot, filePath).startsWith('..')){
      res.writeHead(400); res.end('Bad request'); return;
    }
    fs.readFile(filePath, (err, data)=>{
      if(err){ res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(data);
    });
    return;
  }
  const host = req.headers.host ? req.headers.host.replace(/:\d+$/, '') : 'localhost';
  res.writeHead(301, { Location: `https://${host}:${httpsPort}${req.url}` });
  res.end();
}

function startNativeHttps(){
  const certDir = process.env.ATLAS_CERT_DIR || path.join(__dirname, '.https-cert');
  const resolved = resolveHttpsCert(certDir);
  if(!resolved){
    console.warn('[HTTPS] Продолжаю без HTTPS — см. предупреждение выше.');
    return startPlainHttp();
  }

  const httpsPort = process.env.ATLAS_HTTPS_PORT || 9311;
  const redirectPort = process.env.ATLAS_HTTP_REDIRECT_PORT || 9312;

  https.createServer({ key: resolved.key, cert: resolved.cert }, app).listen(httpsPort, ()=>{
    const localUrl = printBanner({
      proto: 'https', port: httpsPort,
      extraLines: [
        `  HTTP-редирект: порт ${redirectPort} → HTTPS`,
        resolved.source === 'external' ? null : '  ⚠️  Самоподписанный сертификат — браузер один раз спросит подтверждение.',
        `  Сертификат: ${resolved.source}`,
      ],
    });
    if(process.env.ATLAS_OPEN_BROWSER === '1') openBrowser(localUrl);
  });

  http.createServer((req, res)=> serveAcmeChallengeOrRedirect(req, res, httpsPort)).listen(redirectPort, ()=>{
    console.log(`[HTTP→HTTPS] Редирект с порта ${redirectPort} на ${httpsPort}`);
  });
}

function startPlainHttp(){
  const port = process.env.PORT || 4173;
  app.listen(port, ()=>{
    const localUrl = printBanner({ proto: 'http', port });
    if(process.env.ATLAS_OPEN_BROWSER === '1') openBrowser(localUrl);
  });
}

if(process.env.ATLAS_NATIVE_HTTPS === '1') startNativeHttps();
else startPlainHttp();
