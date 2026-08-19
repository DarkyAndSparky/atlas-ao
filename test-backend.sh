#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/server"
if [ ! -d node_modules ]; then
  echo "Зависимости сервера не установлены. Устанавливаю..."
  echo "Это может занять минуту-другую — подождите."
  npm install
fi
npm test
