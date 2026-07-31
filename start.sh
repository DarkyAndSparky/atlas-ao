#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/server"

if [ ! -d node_modules ]; then
  echo "Зависимости ещё не установлены. Устанавливаю сейчас..."
  npm install
  echo ""
fi

URL="http://localhost:4173"
echo "=== Атлас Аллодов ==="
echo "Запускаю сервер на $URL"
echo "Чтобы остановить сервер — нажмите Ctrl+C в этом окне."
echo ""

# пробуем открыть браузер автоматически (не критично, если не получится)
( sleep 1.5
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1
  fi
) &

node server.js
