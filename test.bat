@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo === Атлас Аллодов - тесты ===
echo.

echo --- Бэкенд (node:test) ---
cd server
if not exist node_modules (
  echo Зависимости сервера не установлены. Устанавливаю...
  echo Это может занять минуту-другую — не закрывайте окно.
  call npm install
  if errorlevel 1 (
    echo Установка зависимостей сервера не удалась.
    cd ..
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
  echo Зависимости e2e не установлены. Устанавливаю...
  call npm install
  if errorlevel 1 (
    echo Установка зависимостей e2e не удалась.
    cd ..
    pause
    exit /b 1
  )
  echo.
  echo Скачиваю браузеры для тестов ^(Chromium и WebKit^) — это отдельная,
  echo БОЛЕЕ ДОЛГАЯ загрузка ^(сотни мегабайт^), может занять несколько минут
  echo в зависимости от скорости интернета. НЕ ЗАКРЫВАЙТЕ ОКНО.
  call npm run install-browsers
  if errorlevel 1 (
    echo Установка браузеров для e2e не удалась.
    cd ..
    pause
    exit /b 1
  )
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
