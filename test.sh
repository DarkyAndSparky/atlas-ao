#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "=== Атлас Аллодов — тесты ==="
echo ""

echo "--- Бэкенд (node:test) ---"
cd server
if [ ! -d node_modules ]; then
  echo "Зависимости сервера не установлены. Устанавливаю..."
  npm install
fi
npm test
cd ..

echo ""
echo "--- UI/e2e (Playwright) ---"
cd e2e
if [ ! -d node_modules ]; then
  echo "Зависимости e2e не установлены. Устанавливаю (один раз, может занять пару минут)..."
  npm install
  npm run install-browsers
fi
npm test
cd ..

echo ""
echo "=== Все тесты пройдены ==="
