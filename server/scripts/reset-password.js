// Запуск: npm run reset-password
// ВАЖНО: сначала остановите сервер (Ctrl+C), иначе возможна блокировка файла базы.
const path = require('path');
const readline = require('readline');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.ATLAS_DB_PATH || path.join(__dirname, '..', 'atlas.db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q)=> new Promise(resolve => rl.question(q, resolve));

(async ()=>{
  let db;
  try{
    db = new DatabaseSync(DB_PATH);
  }catch(e){
    console.error('Не удалось открыть базу:', e.message);
    rl.close();
    return;
  }

  const users = db.prepare('SELECT id, username FROM users ORDER BY created_at ASC').all();
  if(!users.length){
    console.log('Ни одного аккаунта редактора ещё нет — сбрасывать нечего.');
    db.close();
    rl.close();
    return;
  }

  console.log('Текущие аккаунты редакторов:');
  users.forEach(u=> console.log(`  - ${u.username}`));
  console.log('');
  const answer = await ask(
    'Введите имя пользователя, чтобы удалить именно этот аккаунт, ' +
    'или "all", чтобы удалить ВСЕ аккаунты сразу (после этого при следующем входе ' +
    'на сайте предложат создать первый аккаунт заново). Оставьте пустым для отмены: '
  );
  const trimmed = answer.trim();
  if(!trimmed){
    console.log('Отменено.');
    db.close();
    rl.close();
    return;
  }

  if(trimmed.toLowerCase() === 'all'){
    const info = db.prepare('DELETE FROM users').run();
    console.log(`Готово. Удалено аккаунтов: ${info.changes}. При следующем входе на сайте будет предложено создать аккаунт заново.`);
  }else{
    const user = users.find(u=> u.username.toLowerCase() === trimmed.toLowerCase());
    if(!user){
      console.log(`Пользователь "${trimmed}" не найден среди перечисленных выше — ничего не удалено.`);
    }else if(users.length === 1){
      console.log('Это единственный оставшийся аккаунт — удалить его через эту команду нельзя ' +
        '(сайт остался бы совсем без входа никаким другим способом, кроме повторного запуска ' +
        'этой же команды с "all"). Если это и нужно — повторите и введите "all".');
    }else{
      db.prepare('DELETE FROM users WHERE id=?').run(user.id);
      console.log(`Готово. Аккаунт "${user.username}" удалён. Данные аллодов не пострадали.`);
    }
  }

  db.close();
  rl.close();
})();
