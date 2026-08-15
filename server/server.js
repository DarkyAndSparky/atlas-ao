const fs = require('fs');
const path = require('path');
const os = require('os');
const { createApp } = require('./app');

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

app.listen(PORT, ()=>{
  const localUrl = `http://localhost:${PORT}`;
  const netAddr = localNetworkAddress();
  const netUrl = netAddr ? `http://${netAddr}:${PORT}` : null;
  const dbPath = process.env.ATLAS_DB_PATH || path.join(__dirname, 'atlas.db');

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
});
