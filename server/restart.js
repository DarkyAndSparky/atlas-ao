const fs = require('fs');
const { spawn } = require('child_process');

/* ======================================================================
   Роадмап, пункт 12 («Критично»): после восстановления из бэкапа
   (/api/backup/restore и /api/backup/restore-full) процесс раньше просто
   вызывал process.exit(0) — соединение с SQLite нужно закрыть и открыть
   заново на новый файл, и самый надёжный способ это сделать без гонок —
   перезапустить процесс с нуля.

   Под Docker (restart: unless-stopped в docker-compose.yml) это работало
   само — контейнер поднимался обратно за несколько секунд. При обычном
   запуске (node server.js / start.sh / start.bat, без внешнего супервизора)
   никто не поднимал процесс обратно — сайт реально "зависал" (переставал
   отвечать) до тех пор, пока кто-то не зайдёт и не перезапустит вручную.
   Именно это и было в отчёте.

   Решение: перед выходом сами порождаем detached-копию процесса с теми же
   argv/env — она подхватывает соединение с сервером ~сразу же, пока
   старый процесс ещё завершается. Простыня даунтайма — секунда-две на
   переоткрытие БД и миграции (они все idempotent, лишний раз ничего не
   портят), а не "зависает до вмешательства человека".

   Под Docker respawn НАРОЧНО не делаем: там наш процесс — PID 1
   контейнера, и docker-compose уже сам перезапустит контейнер политикой
   restart:unless-stopped. Если вдобавок ещё и породить дочерний процесс
   здесь, оба (новый контейнер от Docker и наш child) попробуют занять
   один и тот же порт — гонка вместо чистого перезапуска. /.dockerenv —
   стандартный маркер, который Docker кладёт внутрь каждого контейнера,
   отсюда и проверка.
   ====================================================================== */

function isRunningInDocker(){
  try{ return fs.existsSync('/.dockerenv'); }
  catch(e){ return false; }
}

// Возвращает { mode }, чтобы вызывающий код (роуты бэкапа) мог сформировать
// точное сообщение пользователю — что именно сейчас произойдёт.
//   'test'    — ATLAS_TEST_NO_EXIT=1, процесс вообще не трогаем (юнит-тесты)
//   'docker'  — respawn не делаем, полагаемся на restart-policy контейнера
//   'respawn' — сами подняли новую копию процесса перед выходом
//   'manual'  — respawn не удался (нет прав/платформа не поддерживает) —
//               остаётся только ручной перезапуск, как раньше
function scheduleRestart(delayMs = 300){
  if(process.env.ATLAS_TEST_NO_EXIT === '1') return { mode: 'test' };

  if(isRunningInDocker()){
    setTimeout(()=> process.exit(0), delayMs);
    return { mode: 'docker' };
  }

  try{
    const child = spawn(process.argv[0], process.argv.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    setTimeout(()=> process.exit(0), delayMs);
    return { mode: 'respawn' };
  }catch(e){
    console.error('Не удалось автоматически перезапустить процесс — перезапустите вручную:', e.message);
    setTimeout(()=> process.exit(0), delayMs);
    return { mode: 'manual' };
  }
}

module.exports = { scheduleRestart, isRunningInDocker };
