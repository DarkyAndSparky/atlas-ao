/* ====================== WIKI DROPDOWN (топбар) ======================
   Атлас/Источники/Хронология/Архипелаги были 4 отдельными кнопками в и без
   того перегруженном топбаре (см. "Аудит дизайна и UI/UX" в роадмапе) —
   собраны в одно выпадающее меню "Вики ▾". Клики по пунктам меню по-прежнему
   ловит существующий делегированный обработчик в mapView.js (те же классы
   .view-toggle-btn/data-view, поэтому логика открытия разделов и подсветки
   активного пункта не менялась вообще — только разметка). */
(function(){
  const dropdown = document.getElementById('wikiDropdown');
  const trigger = document.getElementById('wikiDropdownBtn');
  const menu = document.getElementById('wikiDropdownMenu');

  function closeMenu(){
    dropdown.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }
  function openMenu(){
    dropdown.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  }

  trigger.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    if(dropdown.classList.contains('open')) closeMenu(); else openMenu();
  });
  // выбор раздела закрывает меню — сам переход обрабатывает существующий
  // делегированный обработчик кликов по .view-toggle-btn в mapView.js
  menu.querySelectorAll('.view-toggle-btn').forEach(btn=>{
    btn.addEventListener('click', closeMenu);
  });
  document.getElementById('randomAllodBtn').addEventListener('click', ()=>{
    const pool = (typeof projectFilteredData==='function' ? projectFilteredData() : state.data);
    if(!pool.length) return;
    const pick = pool[Math.floor(Math.random()*pool.length)];
    openDetail(pick.id);
  });
  document.addEventListener('click', (ev)=>{
    if(!dropdown.contains(ev.target)) closeMenu();
  });
  document.addEventListener('keydown', (ev)=>{
    if(ev.key === 'Escape') closeMenu();
  });
})();
