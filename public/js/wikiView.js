/* ====================== WIKI VIEW ======================
   «Атлас островов» — текстовый индекс-каталог всех островов текущего
   проекта, сгруппированный по фракции, а внутри — по размеру. Это как бы
   основа-справочник, поверх которой глобальная карта — красивая надстройка
   с теми же данными и ссылками на те же страницы островов. */

const WIKI_FACTION_GROUPS = [
  { key:'Империя',    match: f => (f||'').includes('Имперск') },
  { key:'Лига',        match: f => (f||'').includes('Лигийск') },
  { key:'Эльфийские',  match: f => (f||'').includes('Эльфийск') },
  { key:'Нейтральные', match: f => (f||'').includes('Нейтральн') },
];
const WIKI_SIZE_ORDER = ['Крупный Архипелаг','Большой остров','Средний остров','Малый аллод','?'];
const WIKI_SIZE_LABEL = {
  'Крупный Архипелаг':'Архипелаги', 'Большой остров':'Большие острова',
  'Средний остров':'Средние острова', 'Малый аллод':'Малые аллоды', '?':'Размер не указан',
};

function showWiki(){
  state.view='wiki'; state.currentId=null; state.currentLocId=null;
  mapView.style.display='none';
  document.getElementById('zoomCtrl').style.display='none';
  detailView.classList.remove('show');
  document.getElementById('configView').classList.remove('show');
  document.getElementById('wikiView').classList.add('show');
  updateActiveFilterBar(); // раньше тут была безусловная .add('hidden') — активный
                            // фильтр, выставленный кликом по тегу, становился
                            // невидимым и несбрасываемым при переходе в вики
  document.querySelectorAll('.view-toggle-btn').forEach(b=> b.classList.toggle('active', b.dataset.view==='wiki'));
  trayEl.classList.remove('show');
  renderWiki();
}

function groupWikiData(){
  const data = projectFilteredData().filter(passesFilter);
  const groups = WIKI_FACTION_GROUPS.map(g=>({ key:g.key, items: data.filter(d=>g.match(d.faction)) }));
  const assigned = new Set(groups.flatMap(g=>g.items.map(i=>i.id)));
  const other = data.filter(d=>!assigned.has(d.id));
  groups.push({ key:'Другие', items: other });
  return groups.filter(g=>g.items.length);
}

function renderWiki(){
  const wrap = document.getElementById('wikiView');
  const groups = groupWikiData();
  const total = groups.reduce((n,g)=>n+g.items.length, 0);

  let html = `
    <div class="wiki-hero">
      <h1>Атлас островов</h1>
      <p>Полный список аллодов проекта «${escapeHtml(currentProjectLabel())}» — ${total} шт. Сгруппировано по фракции и размеру, обновляется автоматически по мере наполнения карты.</p>
    </div>
    <div class="wiki-body">
  `;

  if(!total){
    html += `<div class="prose empty" data-empty="В этом проекте пока нет островов в базе."></div>`;
  }

  groups.forEach(group=>{
    html += `<div class="wiki-faction-group">
      <h2 class="wiki-faction-title">${escapeHtml(group.key)} <span class="wiki-count">${group.items.length}</span></h2>`;
    WIKI_SIZE_ORDER.forEach(sizeKey=>{
      const items = group.items.filter(d=>(d.size||'?')===sizeKey)
        .sort((a,b)=>a.name.localeCompare(b.name,'ru'));
      if(!items.length) return;
      html += `<div class="wiki-size-group">
        <h3 class="wiki-size-title">${escapeHtml(WIKI_SIZE_LABEL[sizeKey]||sizeKey)}</h3>
        <div class="wiki-island-list">
          ${items.map(d=>`
            <a class="wiki-island-link" href="#" data-action="open-detail" data-id="${escapeHtml(d.id)}">
              ${escapeHtml(d.name)}
              ${d.mapX==null ? '<span class="wiki-unplaced-mark" title="Ещё не размещён на карте">●</span>' : ''}
            </a>
          `).join('')}
        </div>
      </div>`;
    });
    // «страховка»: остров с каким-то нестандартным значением size (например,
    // руками отредактированным через API/импорт значением, которого нет в
    // WIKI_SIZE_ORDER) иначе не попал бы ни в одну из групп выше и просто
    // молча пропал бы из списка — при том, что в счётчике "N шт." наверху
    // он всё ещё учтён. Показываем всё, что не разобрано, отдельной группой.
    const knownSizes = new Set(WIKI_SIZE_ORDER);
    const leftover = group.items.filter(d=>!knownSizes.has(d.size||'?'))
      .sort((a,b)=>a.name.localeCompare(b.name,'ru'));
    if(leftover.length){
      html += `<div class="wiki-size-group">
        <h3 class="wiki-size-title">Другой размер</h3>
        <div class="wiki-island-list">
          ${leftover.map(d=>`
            <a class="wiki-island-link" href="#" data-action="open-detail" data-id="${escapeHtml(d.id)}">
              ${escapeHtml(d.name)}
              ${d.mapX==null ? '<span class="wiki-unplaced-mark" title="Ещё не размещён на карте">●</span>' : ''}
            </a>
          `).join('')}
        </div>
      </div>`;
    }
    html += `</div>`;
  });

  html += `</div>`;
  wrap.innerHTML = html;
}

function currentProjectLabel(){
  const p = PROJECTS.find(p=>p.id===state.project);
  return p ? p.label : state.project;
}

/* wikiView-обёртка не пересоздаётся между рендерами (только innerHTML внутри неё),
   поэтому один делегированный обработчик достаточно повесить один раз. */
document.getElementById('wikiView').addEventListener('click', (ev)=>{
  const el = ev.target.closest('[data-action="open-detail"]');
  if(!el) return;
  ev.preventDefault();
  openDetail(el.dataset.id);
});
