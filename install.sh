#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/server"

echo "=== Атлас Аллодов — установка ==="

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден на этом компьютере."
  echo "Установите Node.js версии 22.5 или новее с https://nodejs.org и запустите install.sh снова."
  exit 1
fi

if ! node scripts/check-node-version.js; then
  echo "Обновите Node.js на https://nodejs.org и запустите install.sh снова."
  exit 1
fi

echo "Устанавливаю зависимости сервера (Express, SQLite и т.д.)..."
npm install

echo ""
echo "Готово! Теперь запустите ./start.sh, чтобы открыть сайт."
