/* ====================== ISLAND TEMPLATE ICONS ======================
   Пока нет кастомных нарисованных иконок — на карте показываются
   заготовки-«блобы»: форма зависит от размера острова, цвет — от климата.
   Как только для острова задан item.icon_url (кастомная иконка),
   она полностью заменяет собой шаблон — см. dotIcon() в mapView.js.
======================================================================= */

// силуэты-заготовки: единая точка отсчёта viewBox 0 0 100 100 для всех размеров
const ISLAND_SHAPES = {
  'Малый аллод':
    `<path d="M50,20 C65,18 78,30 76,45 C80,60 68,74 52,76 C36,78 22,66 22,50 C22,34 35,22 50,20 Z"/>`,
  'Средний остров':
    `<path d="M30,15 C50,8 75,15 82,35 C90,52 80,70 62,80 C45,90 22,82 15,65 C8,48 14,25 30,15 Z"/>`,
  'Большой остров':
    `<path d="M20,20 C40,5 70,5 85,22 C95,35 92,50 85,55 C88,65 80,78 65,85 C48,93 25,88 15,72 C5,58 8,40 12,30 C14,25 16,22 20,20 Z"/>`,
  'Крупный Архипелаг':
    `<path d="M40,30 C55,25 65,35 62,48 C65,60 52,68 40,65 C28,62 22,50 25,40 C28,32 34,32 40,30 Z"/>
     <path d="M68,15 C76,12 82,18 80,26 C82,33 74,37 68,34 C62,31 60,22 68,15 Z"/>
     <path d="M20,65 C28,62 34,68 31,76 C33,83 24,87 18,83 C12,79 12,70 20,65 Z"/>`,
  '?':
    `<path d="M50,15 C70,15 85,30 85,50 C85,70 70,85 50,85 C30,85 15,70 15,50 C15,30 30,15 50,15 Z"/>`,
};

// размер маркера на карте (px) по величине острова
const ISLAND_SIZE_PX = {
  'Малый аллод': 16,
  'Средний остров': 22,
  'Большой остров': 28,
  'Крупный Архипелаг': 34,
  '?': 18,
};

// цвет заливки/обводки по климату
const CLIMATE_PALETTE = {
  'Умеренный':      { fill:'#5a8f4a', stroke:'#3d6633' },
  'Тропический':    { fill:'#2f9e6e', stroke:'#1f6b49' },
  'Тундровый':      { fill:'#9fc4d1', stroke:'#6b98a6' },
  'Пустынный':      { fill:'#c9a24b', stroke:'#96701f' },
  'Таежный':        { fill:'#2d5f3f', stroke:'#1c3f29' },
  'Пустошь':        { fill:'#8a7a5c', stroke:'#5c4f37' },
  'Разнообразный':  { fill:'#8a6fae', stroke:'#5c4a7a' },
  '?':              { fill:'#6b6b6b', stroke:'#454545' },
};

function islandShapeKey(size){
  return ISLAND_SHAPES[size] ? size : '?';
}
function islandClimateKey(climate){
  return CLIMATE_PALETTE[climate] ? climate : '?';
}

// возвращает inline-SVG (строку) готового шаблонного значка острова
function templateIslandIcon(size, climate){
  const shapeKey = islandShapeKey(size);
  const climateKey = islandClimateKey(climate);
  const paths = ISLAND_SHAPES[shapeKey];
  const { fill, stroke } = CLIMATE_PALETTE[climateKey];
  const px = ISLAND_SIZE_PX[shapeKey];
  return {
    px,
    svg: `<svg viewBox="0 0 100 100" width="${px}" height="${px}" fill="${fill}" stroke="${stroke}" stroke-width="4">${paths}</svg>`
  };
}

// маленькая версия для легенды/списков (фиксированный размер)
function templateIslandIconFixed(size, climate, fixedPx){
  const shapeKey = islandShapeKey(size);
  const climateKey = islandClimateKey(climate);
  const paths = ISLAND_SHAPES[shapeKey];
  const { fill, stroke } = CLIMATE_PALETTE[climateKey];
  return `<svg viewBox="0 0 100 100" width="${fixedPx}" height="${fixedPx}" fill="${fill}" stroke="${stroke}" stroke-width="4">${paths}</svg>`;
}
