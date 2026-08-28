/* ======================================================================
   РОУТЕР — синхронизация адресной строки с текущим state.view, без
   перезагрузки страницы (History API). Настоящие пути, не хэш:
     /                       → карта (по умолчанию)
     /wiki                   → атлас/вики
     /timeline                → хронология мира
     /sources                 → источники
     /archipelagos             → архипелаги
     /changes                  → последние правки
     /allod/:id/:slug           → остров (slug — для красоты, id — источник истины)
     /allod/:id/:slug/loc/:locId → локация внутри острова

   Сервер уже отдаёт index.html на любой путь (см. app.get('*') в
   server/app.js) — так что прямой переход по ссылке или F5 работают "из
   коробки", ничего дополнительно настраивать не пришлось.

   Как это использовать из остального кода: после ЛЮБОГО перехода между
   view (showMap/showWiki/openDetail/...) в конце вызывается syncUrl() —
   она сверяет URL с текущим state и, если он не совпадает, делает
   history.pushState(...). Флаг state._routingFromUrl подавляет pushState,
   когда мы, наоборот, применяем URL к состоянию (popstate/первая загрузка),
   чтобы не зациклиться и не плодить дублирующиеся записи в истории.
   ====================================================================== */

function slugifyClient(name){
  // Тот же алгоритм, что и на сервере (server/slug.js) — используется тут
  // только для сравнения "совпадает ли slug в URL с актуальным", не для
  // генерации (генерация и хранение — задача бэкенда).
  const map = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
  return (name||'').toLowerCase().split('').map(ch=> map[ch]!==undefined?map[ch]:ch).join('')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80) || 'ostrov';
}

function pathForCurrentState(){
  const s = state;
  if(s.view==='detail' || s.view==='location'){
    const item = byId(s.currentId);
    if(!item) return '/map';
    const slug = item.slug || slugifyClient(item.name);
    let p = `/allod/${item.id}/${slug}`;
    if(s.view==='location' && s.currentLocId) p += `/loc/${s.currentLocId}`;
    return p;
  }
  switch(s.view){
    case 'wiki': return '/wiki';
    case 'timeline': return '/timeline';
    case 'sources': return '/sources';
    case 'archipelagos': return '/archipelagos';
    case 'recentChanges': return '/changes';
    case 'config': return '/settings';
    case 'about': return '/about';
    case 'map': default: return '/map';
  }
}

function syncUrl(){
  if(state._routingFromUrl) return; // применяем URL → состояние, не наоборот — не пушим
  const path = pathForCurrentState();
  if(location.pathname === path) return;
  history.pushState({ atlasRoute:true }, '', path);
}

// Применяет путь из адресной строки к состоянию приложения. Вызывается на
// первой загрузке и на popstate (кнопки браузера назад/вперёд).
function applyRoute(){
  state._routingFromUrl = true;
  try{
    const path = location.pathname;
    const allodMatch = path.match(/^\/allod\/([^/]+)\/([^/]*)(?:\/loc\/([^/]+))?\/?$/);
    if(allodMatch){
      const [, id, urlSlug, locId] = allodMatch;
      const item = byId(id);
      if(item){
        openDetail(id, locId || null);
        // slug в адресной строке устарел (остров переименовали после того,
        // как на него сослались) — тихо поправляем URL на актуальный, без
        // новой записи в истории (replaceState, не pushState) и без
        // видимого редиректа/перезагрузки для пользователя.
        const actualSlug = item.slug || slugifyClient(item.name);
        if(urlSlug !== actualSlug){
          history.replaceState({ atlasRoute:true }, '', pathForCurrentState());
        }
      }else{
        showMap(); // битая/устаревшая ссылка на несуществующий id — не даём приложению зависнуть на пустом экране
      }
      return;
    }
    switch(path){
      case '/wiki': showWiki(); return;
      case '/timeline': showTimeline(); return;
      case '/sources': showSources(); return;
      case '/archipelagos': showArchipelagos(); return;
      case '/changes': showRecentChanges(); return;
      case '/settings':
        if(authStatus.loggedIn && authStatus.role==='admin') showConfig(); else showMap();
        return;
      case '/about':
        if(authStatus.loggedIn && authStatus.role==='admin') showAbout(); else showMap();
        return;
      default: showMap(); return;
    }
  } finally {
    state._routingFromUrl = false;
  }
}

window.addEventListener('popstate', applyRoute);

// Первичное применение маршрута — после того как state.data и авторизация
// уже загружены в boot() (main.js), иначе byId()/showConfig() отработают
// на пустых данных. initRouter() вызывается из конца boot().
function initRouter(){
  if(location.pathname === '/' || location.pathname === ''){
    history.replaceState({ atlasRoute:true }, '', '/map');
    return; // главная = карта по умолчанию, applyRoute для неё не нужен
  }
  applyRoute();
}
