@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0server"

if not exist node_modules (
  echo Зависимости сервера не установлены. Устанавливаю...
  echo Это может занять минуту-другую — не закрывайте окно.
  call npm install
  if errorlevel 1 (
    echo Установка зависимостей не удалась.
    pause
    exit /b 1
  )
)
call npm test
if errorlevel 1 (
  echo Тесты упали. Смотрите вывод выше.
  pause
  exit /b 1
)
pause
