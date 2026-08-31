@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0server"

for /f "delims=" %%D in ('node scripts\check-deps-fresh.js 2^>nul') do set DEPS_STATUS=%%D
if not defined DEPS_STATUS set DEPS_STATUS=STALE

if "%DEPS_STATUS%"=="MISSING" (
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
) else if "%DEPS_STATUS%"=="STALE" (
  echo package-lock.json изменился с последней установки — обновляю зависимости...
  echo ЭТО МОЖЕТ ЗАНЯТЬ МИНУТУ-ДВЕ — НЕ ЗАКРЫВАЙТЕ ОКНО.
  echo.
  call npm install
  if errorlevel 1 (
    echo Обновление зависимостей не удалось. Проверьте сообщение выше.
    pause
    exit /b 1
  )
  echo.
)

if not defined ATLAS_HTTPS_PORT set ATLAS_HTTPS_PORT=9311
if not defined ATLAS_HTTP_REDIRECT_PORT set ATLAS_HTTP_REDIRECT_PORT=9312

echo === Атлас Аллодов ===
echo Запускаю сервер на https://localhost:%ATLAS_HTTPS_PORT% (HTTP с %ATLAS_HTTP_REDIRECT_PORT% редиректит на HTTPS)
echo Сертификат самоподписанный — при первом заходе браузер один раз спросит подтверждение.
echo Браузер откроется автоматически, как только сервер будет готов принимать запросы.
echo Чтобы остановить сервер — закройте это окно или нажмите Ctrl+C.
echo.

rem ATLAS_NATIVE_HTTPS=1 — сервер сам терминирует HTTPS (самоподписанный
rem сертификат, кэшируется в server\.https-cert) и сам редиректит с HTTP,
rem без Docker/Caddy — см. server.js/certs.js. ATLAS_HTTPS=1 включает
rem secure-куки и HSTS (тот же флаг, что и в Docker-режиме за Caddy).
set ATLAS_NATIVE_HTTPS=1
set ATLAS_HTTPS=1
set ATLAS_OPEN_BROWSER=1
node server.js
pause
