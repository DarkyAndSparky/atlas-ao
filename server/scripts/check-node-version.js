// Проверяет, что версия Node.js >= 22.5 (нужна для встроенного node:sqlite).
// Возвращает код выхода 0, если версия подходит, 1 — если нет.
const [major, minor] = process.versions.node.split('.').map(Number);
const ok = major > 22 || (major === 22 && minor >= 5);
if(!ok){
  console.error(`Найден Node.js v${process.versions.node}, но нужна версия 22.5 или новее.`);
  process.exit(1);
}
console.log(`Node.js v${process.versions.node} — подходит.`);
process.exit(0);
