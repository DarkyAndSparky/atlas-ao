const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, exec } = require('child_process');
const { createApp } = require('./app');
const { startBackupScheduler } = require('./backupScheduler');

const PORT = process.env.PORT || 4173;
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
// app.listen(), а не из start.bat/start.sh таймером/задержкой "на глаз".
// Раньше start.bat открывал браузер ДО запуска node server.js вообще (`start
// "url"` шёл строкой раньше `node server.js`), а start.sh — через фиксированный
// sleep 1.5с, который на медленной машине/первом запуске (засев 318 островов
// в БД и т.п.) мог не хватить. app.listen() коллбэк — единственный момент,
// когда сервер гарантированно уже принимает соединения, а не просто "наверное
// уже запустился". Включается только по явному флагу из start.bat/start.sh —
// сам по себе `node server.js` браузер не открывает.
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

app.listen(PORT, ()=>{
  const localUrl = `http://localhost:${PORT}`;
  const netAddr = localNetworkAddress();
  const netUrl = netAddr ? `http://${netAddr}:${PORT}` : null;
  const dbPath = process.env.ATLAS_DB_PATH || path.join(__dirname, 'atlas.db');
  const backupsDir = process.env.ATLAS_BACKUPS_DIR || path.join(__dirname, '..', 'backups');

  const lines = [
    `  Версия:      ${VERSION}`,
    `  Локально:    ${localUrl}`,
    netUrl ? `  По сети:     ${netUrl}` : null,
    `  База данных: ${dbPath}`,
    `  Node.js:     ${process.version}`,
  ].filter(l => l !== null);

  const rule = '─'.repeat(60);

  console.log('\n' + rule);
  console.log(' 🗺️  Атлас Аллодов — сервер запущен');
  console.log(rule + '\n');
  console.log(lines.join('\n'));
  console.log('\n  Чтобы остановить сервер — нажмите Ctrl+C.\n');
  console.log(rule + '\n');

  startBackupScheduler({ dbPath, backupsDir, db: require('./db') });

  if(process.env.ATLAS_OPEN_BROWSER === '1') openBrowser(localUrl);
});
