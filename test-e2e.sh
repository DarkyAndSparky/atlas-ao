#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/e2e"
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
