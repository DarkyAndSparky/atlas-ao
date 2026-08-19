@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0server"

if not exist node_modules (
  echo Зависимости ещё не установлены. Устанавливаю сейчас...
  echo ЭТО МОЖЕТ ЗАНЯТЬ МИНУТУ-ДВЕ ^(особенно первый раз^) — НЕ ЗАКРЫВАЙТЕ ОКНО,
  echo даже если кажется, что ничего не происходит.
  echo.
  call npm install
  if errorlevel 1 (
    echo Установка зависимостей не удалась. Проверьте сообщение выше.
    pause
    exit /b 1
  )
  echo.
  echo Зависимости установлены. Запускаю сервер...
  echo.
)

echo === Атлас Аллодов ===
echo Запускаю сервер на http://localhost:4173
echo Браузер откроется автоматически, как только сервер будет готов принимать запросы.
echo Чтобы остановить сервер — закройте это окно или нажмите Ctrl+C.
echo.

set ATLAS_OPEN_BROWSER=1
node server.js
pause
