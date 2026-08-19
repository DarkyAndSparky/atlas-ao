@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0server"

echo === Атлас Аллодов - установка ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден на этом компьютере.
  echo Установите Node.js версии 22.5 или новее с https://nodejs.org
  echo и запустите install.bat снова.
  pause
  exit /b 1
)

node scripts\check-node-version.js
if errorlevel 1 (
  echo Обновите Node.js на https://nodejs.org и запустите install.bat снова.
  pause
  exit /b 1
)

echo Устанавливаю зависимости сервера...
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
echo Готово! Теперь запустите start.bat, чтобы открыть сайт.
pause
