#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/server"

DEPS_STATUS=$(node scripts/check-deps-fresh.js 2>/dev/null || echo "STALE")
if [ "$DEPS_STATUS" = "MISSING" ]; then
  echo "Зависимости ещё не установлены. Устанавливаю сейчас..."
  echo "Это может занять минуту-другую (особенно первый раз) — подождите."
  npm install
  echo ""
  echo "Зависимости установлены. Запускаю сервер..."
  echo ""
elif [ "$DEPS_STATUS" = "STALE" ]; then
  echo "package-lock.json изменился с последней установки — обновляю зависимости..."
  echo "Это может занять минуту-другую — подождите."
  npm install
  echo ""
fi

HTTPS_PORT="${ATLAS_HTTPS_PORT:-9311}"
REDIRECT_PORT="${ATLAS_HTTP_REDIRECT_PORT:-9312}"
URL="https://localhost:$HTTPS_PORT"
echo "=== Атлас Аллодов ==="
echo "Запускаю сервер на $URL (HTTP с $REDIRECT_PORT редиректит на HTTPS)"
echo "Сертификат самоподписанный — при первом заходе браузер один раз спросит подтверждение."
echo "Браузер откроется автоматически, как только сервер будет готов принимать запросы."
echo "Чтобы остановить сервер — нажмите Ctrl+C в этом окне."
echo ""

# ATLAS_NATIVE_HTTPS=1 — сервер сам терминирует HTTPS (самоподписанный
# сертификат, кэшируется в server/.https-cert) и сам редиректит с HTTP,
# без Docker/Caddy — см. server.js/certs.js. ATLAS_HTTPS=1 включает
# secure-куки и HSTS (тот же флаг, что и в Docker-режиме за Caddy).
# ATLAS_OPEN_BROWSER=1 — сервер сам откроет браузер из колбэка listen(),
# то есть ровно в момент, когда он реально готов принимать запросы, а не
# через фиксированную задержку "на глаз".
ATLAS_NATIVE_HTTPS=1 ATLAS_HTTPS=1 ATLAS_HTTPS_PORT="$HTTPS_PORT" ATLAS_HTTP_REDIRECT_PORT="$REDIRECT_PORT" ATLAS_OPEN_BROWSER=1 node server.js
