@echo off
chcp 65001 >nul
cd /d "%~dp0e2e"

if not exist node_modules (
  echo Зависимости e2e не установлены. Устанавливаю ^(один раз, может занять пару минут^)...
  call npm install
  if errorlevel 1 (
    echo Установка зависимостей не удалась.
    pause
    exit /b 1
  )
  call npm run install-browsers
)
call npm test
if errorlevel 1 (
  echo Тесты упали. Смотрите вывод выше или откройте отчёт: npx playwright show-report
  pause
  exit /b 1
)
pause
