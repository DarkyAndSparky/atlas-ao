// Транслитерация кириллицы в латиницу + сборка URL-slug из названия
// острова. Используется и при миграции старых записей (db.js), и при
// создании нового острова (routes/allods.js) — единственный источник
// правды по формату, чтобы оба места не разъезжались.
const TRANSLIT_MAP = {
  а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i',
  й:'y', к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t',
  у:'u', ф:'f', х:'h', ц:'ts', ч:'ch', ш:'sh', щ:'sch', ъ:'', ы:'y', ь:'',
  э:'e', ю:'yu', я:'ya',
};

function transliterate(s){
  return s.toLowerCase().split('').map(ch=> TRANSLIT_MAP[ch] !== undefined ? TRANSLIT_MAP[ch] : ch).join('');
}

// Базовый slug из названия — без проверки уникальности (см. uniqueSlug ниже).
function slugify(name){
  return transliterate(name || '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) // на случай очень длинных названий локаций/событий
    || 'ostrov';   // полностью нетранслитерируемое название (только эмодзи и т.п.) не должно давать пустую строку
}

// Генерирует slug, гарантированно уникальный среди уже занятых (existingSlugs —
// Set строк). При коллизии добавляет численный суффикс -2, -3, ...
function uniqueSlug(name, existingSlugs){
  const base = slugify(name);
  if(!existingSlugs.has(base)) return base;
  let i = 2;
  while(existingSlugs.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

module.exports = { slugify, uniqueSlug };
