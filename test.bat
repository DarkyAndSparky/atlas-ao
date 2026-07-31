@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo === Атлас Аллодов - тесты ===
echo.

echo --- Бэкенд (node:test) ---
cd server
if not exist node_modules (
  echo Зависимости сервера не установлены. Устанавливаю...
  call npm install
  if errorlevel 1 (
    echo Установка зависимостей сервера не удалась.
    pause
    exit /b 1
  )
)
call npm test
if errorlevel 1 (
  echo Бэкенд-тесты упали. Смотрите вывод выше.
  cd ..
  pause
  exit /b 1
)
cd ..

echo.
echo --- UI/e2e (Playwright) ---
cd e2e
if not exist node_modules (
  echo Зависимости e2e не установлены. Устанавливаю ^(один раз, может занять пару минут^)...
  call npm install
  if errorlevel 1 (
    echo Установка зависимостей e2e не удалась.
    cd ..
    pause
    exit /b 1
  )
  call npm run install-browsers
)
call npm test
if errorlevel 1 (
  echo UI-тесты упали. Смотрите вывод выше или откройте отчёт: npx playwright show-report
  cd ..
  pause
  exit /b 1
)
cd ..

echo.
echo === Все тесты пройдены ===
pause
