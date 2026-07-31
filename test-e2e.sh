#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/e2e"
if [ ! -d node_modules ]; then
  echo "Зависимости e2e не установлены. Устанавливаю (один раз, может занять пару минут)..."
  npm install
  npm run install-browsers
fi
npm test
