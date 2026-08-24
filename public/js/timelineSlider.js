/* ====================== TIMELINE SLIDER (динамика островов) ======================
   Год + чекбокс "показать все острова" — фильтрует видимость меток на карте
   по year_appeared/year_disappeared (см. passesFilter/islandExistsAtTimelineYear
   в state.js). Полностью клиентская фича, не привязана к текущему editorOn —
   видна любому посетителю карты, это про чтение мира, а не редактирование.
   Если ни у одного острова текущего проекта эти поля не заполнены — панель
   не показывается вообще (нечего листать, слайдер без диапазона бессмыслен). */

function timelineYearBounds(){
  const years = [];
  state.data.forEach(item=>{
    if((item.project||'Аллоды Онлайн') !== state.project) return;
    if(item.year_appeared!=null) years.push(item.year_appeared);
    if(item.year_disappeared!=null) years.push(item.year_disappeared);
  });
  if(!years.length) return null;
  return { min: Math.min(...years), max: Math.max(...years) };
}

function renderTimelineSlider(){
  const bar = document.getElementById('timelineSliderBar');
  const bounds = timelineYearBounds();
  if(!bounds){
    bar.classList.remove('show');
    state.timelineShowAll = true; // нет данных — фильтр по году не может быть активен
    return;
  }
  bar.classList.add('show');

  const range = document.getElementById('timelineRange');
  const yearInput = document.getElementById('timelineYearInput');
  const checkbox = document.getElementById('timelineShowAllCheckbox');

  range.min = bounds.min; range.max = bounds.max;
  yearInput.min = bounds.min; yearInput.max = bounds.max;
  document.getElementById('timelineMinLabel').textContent = bounds.min;
  document.getElementById('timelineMaxLabel').textContent = bounds.max;

  if(state.timelineYear==null) state.timelineYear = bounds.max; // по умолчанию — самый поздний известный год
  range.value = state.timelineYear;
  yearInput.value = state.timelineYear;
  checkbox.checked = state.timelineShowAll;
  range.disabled = state.timelineShowAll;
  yearInput.disabled = state.timelineShowAll;
}

function applyTimelineYear(year){
  const bounds = timelineYearBounds();
  if(!bounds) return;
  const clamped = Math.min(Math.max(year, bounds.min), bounds.max);
  state.timelineYear = clamped;
  document.getElementById('timelineRange').value = clamped;
  document.getElementById('timelineYearInput').value = clamped;
  renderMarkers();
}

document.getElementById('timelineRange').addEventListener('input', (e)=>{
  applyTimelineYear(parseInt(e.target.value, 10));
});
document.getElementById('timelineYearInput').addEventListener('change', (e)=>{
  const n = parseInt(e.target.value, 10);
  if(Number.isInteger(n)) applyTimelineYear(n);
  else e.target.value = state.timelineYear;
});
document.getElementById('timelineShowAllCheckbox').addEventListener('change', (e)=>{
  state.timelineShowAll = e.target.checked;
  document.getElementById('timelineRange').disabled = state.timelineShowAll;
  document.getElementById('timelineYearInput').disabled = state.timelineShowAll;
  renderMarkers();
});
