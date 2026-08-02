@echo off
chcp 65001 >nul
cd /d "%~dp0server"

if not exist node_modules (
  echo Зависимости сервера не установлены. Устанавливаю...
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
