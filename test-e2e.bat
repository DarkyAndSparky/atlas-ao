@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0e2e"

if not exist node_modules (
  echo Зависимости e2e не установлены. Устанавливаю...
  call npm install
  if errorlevel 1 (
    echo Установка зависимостей не удалась.
    pause
    exit /b 1
  )
  echo.
  echo Скачиваю браузеры для тестов ^(Chromium и WebKit^) — это отдельная,
  echo БОЛЕЕ ДОЛГАЯ загрузка ^(сотни мегабайт^), может занять несколько минут
  echo в зависимости от скорости интернета. НЕ ЗАКРЫВАЙТЕ ОКНО.
  call npm run install-browsers
  if errorlevel 1 (
    echo Установка браузеров не удалась.
    pause
    exit /b 1
  )
)
call npm test
if errorlevel 1 (
  echo Тесты упали. Смотрите вывод выше или откройте отчёт: npx playwright show-report
  pause
  exit /b 1
)
pause
