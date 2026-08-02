@echo off
chcp 65001 >nul
cd /d "%~dp0server"

if not exist node_modules (
  echo Зависимости ещё не установлены. Устанавливаю сейчас...
  echo.
  call npm install
  if errorlevel 1 (
    echo Установка зависимостей не удалась. Проверьте сообщение выше.
    pause
    exit /b 1
  )
  echo.
)

echo === Атлас Аллодов ===
echo Запускаю сервер на http://localhost:4173
echo Чтобы остановить сервер — закройте это окно или нажмите Ctrl+C.
echo.

start "" "http://localhost:4173"
node server.js
pause
