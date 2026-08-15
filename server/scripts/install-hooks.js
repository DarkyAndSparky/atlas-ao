#!/usr/bin/env node
// Копирует ../../scripts/hooks/* в .git/hooks/ репозитория — сами git-хуки
// не хранятся в .git (он не коммитится), поэтому "устанавливаем" их заново
// при каждом `npm install` через "prepare"-скрипт в server/package.json.
// Если .git отсутствует (например, установка из zip-архива, а не git
// clone/pull) — тихо пропускаем, это не ошибка.
const fs = require('fs');
const path = require('path');

// server/scripts/install-hooks.js -> .. -> server/ -> .. -> корень репозитория
const repoRoot = path.join(__dirname, '..', '..');
const gitHooksDir = path.join(repoRoot, '.git', 'hooks');
const sourceDir = path.join(repoRoot, 'scripts', 'hooks');

if(!fs.existsSync(path.join(repoRoot, '.git'))){
  // Не git-репозиторий (например, распаковали zip-архив) — ставить некуда.
  process.exit(0);
}

try{
  fs.mkdirSync(gitHooksDir, { recursive: true });
  const hooks = fs.readdirSync(sourceDir);
  for(const hook of hooks){
    const src = path.join(sourceDir, hook);
    const dest = path.join(gitHooksDir, hook);
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
    console.log(`[hooks] установлен: ${hook}`);
  }
}catch(e){
  // Установка хуков — забота о качестве, а не критичная функциональность;
  // не роняем npm install из-за неё.
  console.warn('[hooks] не удалось установить git-хуки:', e.message);
}
