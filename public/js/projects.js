/* ====================== PROJECTS ======================
   Атлас может содержать острова из нескольких игр/продуктов. Каждый остров
   хранит поле project — по нему всё (карта, вики-список, фильтры) режется
   на независимые разделы. */

const PROJECTS = [
  { id: 'Аллоды Онлайн',        label: 'Аллоды Онлайн',        logo: 'assets/projects/logo-allods-online.png' },
  { id: 'Пираты Штурм Небес',   label: 'Пираты Штурм Небес',   logo: 'assets/projects/logo-pirates.png' },
  { id: 'Allods Adventure',     label: 'Allods Adventure',     logo: 'assets/projects/logo-adventure.png' },
  { id: 'Классические игры',    label: 'Классические игры',    logo: 'assets/projects/logo-classic.png' },
];

const PROJECT_STORAGE_KEY = 'atlas_current_project';

function getCurrentProject(){
  return localStorage.getItem(PROJECT_STORAGE_KEY) || PROJECTS[0].id;
}
function setCurrentProject(id){
  localStorage.setItem(PROJECT_STORAGE_KEY, id);
  state.project = id;
}

function renderProjectSwitcher(){
  const wrap = document.getElementById('projectSwitcher');
  if(!wrap) return;
  // «страховка»: если у какого-то острова project не совпадает ни с одним из
  // 4 известных выше (например, задан вручную через API/импорт), для него
  // иначе не нашлось бы вкладки вообще — остров стал бы недоступен нигде в
  // интерфейсе, оставаясь в базе. Добавляем для таких значений обычную
  // текстовую вкладку без логотипа.
  const knownIds = new Set(PROJECTS.map(p=>p.id));
  const extraIds = [...new Set(state.data.map(d=>d.project).filter(id=>id && !knownIds.has(id)))].sort();
  const allProjects = PROJECTS.concat(extraIds.map(id=>({ id, label:id, logo:null })));

  wrap.innerHTML = allProjects.map(p=>`
    <button class="project-tab ${state.project===p.id?'active':''}" data-project="${escapeHtml(p.id)}" title="${escapeHtml(p.label)}">
      ${p.logo ? `<img src="${p.logo}" alt="${escapeHtml(p.label)}">` : `<span class="project-tab-text">${escapeHtml(p.label)}</span>`}
    </button>
  `).join('');
  wrap.querySelectorAll('.project-tab').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      setCurrentProject(btn.dataset.project);
      renderProjectSwitcher();
      state.filters = { category:'', faction:'', q:'', archipelago:'', climate:'', size:'' };
      document.getElementById('catFilter').value='';
      document.getElementById('facFilter').value='';
      document.getElementById('searchbox').value='';
      updateActiveFilterBar();
      await loadAnnotations();
      const wasOnWiki = state.view==='wiki';
      if(wasOnWiki){
        renderWiki();
      }else{
        showMap();
        renderMarkers(); renderTray();
      }
    });
  });
}

function projectFilteredData(){
  return state.data.filter(d => (d.project || 'Аллоды Онлайн') === state.project);
}
