#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "=== Атлас Аллодов — тесты ==="
echo ""

echo "--- Бэкенд (node:test) ---"
cd server
if [ ! -d node_modules ]; then
  echo "Зависимости сервера не установлены. Устанавливаю..."
  echo "Это может занять минуту-другую — подождите."
  npm install
fi
npm test
cd ..

echo ""
echo "--- UI/e2e (Playwright) ---"
cd e2e
if [ ! -d node_modules ]; then
  echo "Зависимости e2e не установлены. Устанавливаю..."
  npm install
  echo ""
  echo "Скачиваю браузеры для тестов (Chromium и WebKit) — это отдельная,"
  echo "более долгая загрузка (сотни мегабайт), может занять несколько минут"
  echo "в зависимости от скорости интернета."
  npm run install-browsers
fi
npm test
cd ..

echo ""
echo "=== Все тесты пройдены ==="
