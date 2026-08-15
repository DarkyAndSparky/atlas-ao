#!/usr/bin/env node
// Единственный источник правды по версии — файл VERSION в корне репозитория.
// Этот скрипт переносит его содержимое во все остальные места, где версия
// раньше была вписана вручную отдельно и могла разъехаться:
//   - server/package.json  ("version": "0.1.0+<VERSION>")
//   - doc/index.html        (три места: toc, шапка, подвал)
// server.js и server/routes/system.js версию не трогают — они и так читают
// VERSION напрямую в рантайме, здесь синхронизировать нечего.
//
// Запуск: npm run version:sync (из server/), или node scripts/sync-version.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const VERSION_FILE = path.join(ROOT, 'VERSION');
const PACKAGE_FILE = path.join(__dirname, '..', 'package.json');
const DOC_FILE = path.join(ROOT, 'doc', 'index.html');

const version = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
if(!/^v\d{2}w\d{2}-\d+$/.test(version)){
  console.error(`[version:sync] VERSION файл выглядит не так, как ожидается ("${version}") — жду формат vYYwWW-NN. Останавливаюсь, ничего не менял.`);
  process.exit(1);
}

let changed = 0;

// package.json: "version": "0.1.0+vYYwWW-NN" — сохраняем префикс semver
// перед "+", меняем только билд-метаданные после него.
{
  const raw = fs.readFileSync(PACKAGE_FILE, 'utf-8');
  const pkg = JSON.parse(raw);
  const semverBase = (pkg.version || '0.1.0').split('+')[0];
  const newVersion = `${semverBase}+${version}`;
  if(pkg.version !== newVersion){
    pkg.version = newVersion;
    fs.writeFileSync(PACKAGE_FILE, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`[version:sync] server/package.json -> ${newVersion}`);
    changed++;
  }
}

// doc/index.html: трёх мест с версией достаточно частые и одинаковые по
// формату (vYYwWW-NN) — заменяем ЛЮБОЕ вхождение такого паттерна на новую
// версию. Это безопаснее точечных str_replace: не расползётся, если кто-то
// добавит ещё одно упоминание версии в этом же формате.
{
  const raw = fs.readFileSync(DOC_FILE, 'utf-8');
  const versionPattern = /v\d{2}w\d{2}-\d+/g;
  const matches = raw.match(versionPattern) || [];
  const updated = raw.replace(versionPattern, version);
  if(updated !== raw){
    fs.writeFileSync(DOC_FILE, updated);
    console.log(`[version:sync] doc/index.html -> ${version} (${matches.length} вхождений)`);
    changed++;
  }
}

if(changed === 0){
  console.log(`[version:sync] уже везде ${version}, менять нечего.`);
}else{
  console.log(`[version:sync] готово — версия везде: ${version}`);
}
