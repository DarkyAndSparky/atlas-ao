/* ======================================================================
   Три переиспользуемых модальных примитива на замену браузерным
   prompt()/confirm() — все в едином визуальном стиле сайта (см. класс
   .modal-overlay / .modal-box в style.css).

   pickFromList({title, items, allowCreate, createLabel, initialValue,
                 placeholder, passEmpty}) → Promise<string|null>
     Поисковый комбобокс. null — явная отмена.

   confirmDialog({title, message, confirmLabel, cancelLabel, danger})
     → Promise<boolean>
     Замена confirm(). danger:true красит кнопку подтверждения в красный
     (для необратимых удалений).

   textPrompt({title, label, initialValue, placeholder, multiline, required})
     → Promise<string|null>
     Замена prompt(). multiline:true — textarea вместо однострочного input.

   Каждый рендерит свой оверлей при первом вызове (ensure*Dom — лениво,
   один раз) и переиспользует его дальше — так что на странице всегда не
   больше одного видимого модального окна каждого типа одновременно.
   ====================================================================== */

/* ---------------- pickFromList ---------------- */
let pickerOverlay, pickerTitle, pickerInput, pickerList, pickerCancelBtn;
let pickerResolve = null;
let pickerActiveIndex = -1;

function ensurePickerDom(){
  if(pickerOverlay) return;
  pickerOverlay = document.createElement('div');
  pickerOverlay.className = 'modal-overlay';
  pickerOverlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-title"></div>
      <input class="modal-search" type="text" autocomplete="off" spellcheck="false">
      <div class="modal-list"></div>
      <div class="modal-actions">
        <button class="field-cancel">Отмена</button>
      </div>
    </div>
  `;
  document.body.appendChild(pickerOverlay);
  pickerTitle = pickerOverlay.querySelector('.modal-title');
  pickerInput = pickerOverlay.querySelector('.modal-search');
  pickerList = pickerOverlay.querySelector('.modal-list');
  pickerCancelBtn = pickerOverlay.querySelector('.field-cancel');

  pickerOverlay.addEventListener('mousedown', e=>{ if(e.target===pickerOverlay) closePicker(null); });
  pickerCancelBtn.addEventListener('click', ()=> closePicker(null));
  pickerInput.addEventListener('input', renderPickerList);
  pickerInput.addEventListener('keydown', onPickerKeydown);
}

function closePicker(value){
  pickerOverlay.classList.remove('show');
  if(pickerResolve){ const r = pickerResolve; pickerResolve = null; r(value); }
}

function renderPickerList(){
  const opts = pickerOverlay._opts || {};
  const q = pickerInput.value.trim().toLowerCase();
  const matches = opts.items.filter(v=> v.toLowerCase().includes(q));
  const rows = matches.map(v=> ({ type:'existing', value:v }));
  const exactExists = opts.items.some(v=> v.toLowerCase()===q);
  if(opts.allowCreate && q && !exactExists){
    rows.push({ type:'create', value:q });
  }
  if(opts.passEmpty && !q){
    rows.unshift({ type:'clear', value:'' });
  }
  pickerActiveIndex = rows.length ? 0 : -1;
  pickerList.innerHTML = rows.length ? '' : `<div class="picker-empty">Ничего не найдено</div>`;
  rows.forEach((row, i)=>{
    const el = document.createElement('div');
    el.className = 'picker-item' + (i===0 ? ' active' : '');
    if(row.type==='create') el.textContent = (opts.createLabel ? opts.createLabel(row.value) : `+ Создать «${row.value}»`);
    else if(row.type==='clear') el.innerHTML = `<span class="picker-clear">— очистить поле —</span>`;
    else el.textContent = row.value;
    el.addEventListener('mousedown', e=>{ e.preventDefault(); closePicker(row.value); });
    pickerList.appendChild(el);
  });
  pickerList._rows = rows;
}

function onPickerKeydown(e){
  const rows = pickerList._rows || [];
  if(e.key==='Escape'){ e.preventDefault(); closePicker(null); return; }
  if(e.key==='ArrowDown'){ e.preventDefault(); movePickerActive(1); return; }
  if(e.key==='ArrowUp'){ e.preventDefault(); movePickerActive(-1); return; }
  if(e.key==='Enter'){
    e.preventDefault();
    if(pickerActiveIndex>=0 && rows[pickerActiveIndex]) closePicker(rows[pickerActiveIndex].value);
    return;
  }
}

function movePickerActive(delta){
  const rows = pickerList._rows || [];
  if(!rows.length) return;
  pickerActiveIndex = (pickerActiveIndex + delta + rows.length) % rows.length;
  [...pickerList.children].forEach((el,i)=> el.classList.toggle('active', i===pickerActiveIndex));
  const activeEl = pickerList.children[pickerActiveIndex];
  if(activeEl) activeEl.scrollIntoView({ block:'nearest' });
}

function pickFromList(options){
  ensurePickerDom();
  const opts = Object.assign({ items:[], allowCreate:false, passEmpty:false, initialValue:'' }, options);
  pickerOverlay._opts = opts;
  pickerTitle.textContent = opts.title || 'Выберите значение';
  pickerInput.value = opts.initialValue || '';
  pickerInput.placeholder = opts.placeholder || 'Начните вводить…';
  renderPickerList();
  pickerOverlay.classList.add('show');
  setTimeout(()=>{ pickerInput.focus(); pickerInput.select(); }, 0);
  return new Promise(resolve=>{ pickerResolve = resolve; });
}

/* ---------------- confirmDialog ---------------- */
let confirmOverlay, confirmResolve = null;
function ensureConfirmDom(){
  if(confirmOverlay) return;
  confirmOverlay = document.createElement('div');
  confirmOverlay.className = 'modal-overlay';
  confirmOverlay.innerHTML = `
    <div class="modal-box" style="width:380px;">
      <div class="modal-title"></div>
      <div class="modal-message"></div>
      <div class="modal-actions">
        <button class="field-cancel"></button>
        <button class="field-save"></button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmOverlay);
  const okBtn = confirmOverlay.querySelector('.field-save');
  const cancelBtn = confirmOverlay.querySelector('.field-cancel');
  const close = (result)=>{
    confirmOverlay.classList.remove('show');
    if(confirmResolve){ const r = confirmResolve; confirmResolve = null; r(result); }
  };
  okBtn.addEventListener('click', ()=> close(true));
  cancelBtn.addEventListener('click', ()=> close(false));
  confirmOverlay.addEventListener('mousedown', e=>{ if(e.target===confirmOverlay) close(false); });
  confirmOverlay.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ e.preventDefault(); close(false); }
    if(e.key==='Enter'){ e.preventDefault(); close(true); }
  });
  confirmOverlay._els = { okBtn, cancelBtn };
}
function confirmDialog(options){
  ensureConfirmDom();
  const opts = Object.assign({ title:'Подтвердите действие', message:'', confirmLabel:'Да', cancelLabel:'Отмена', danger:false }, options);
  confirmOverlay.querySelector('.modal-title').textContent = opts.title;
  confirmOverlay.querySelector('.modal-message').textContent = opts.message;
  const { okBtn, cancelBtn } = confirmOverlay._els;
  okBtn.textContent = opts.confirmLabel;
  cancelBtn.textContent = opts.cancelLabel;
  okBtn.classList.toggle('danger', !!opts.danger);
  confirmOverlay.classList.add('show');
  setTimeout(()=> okBtn.focus(), 0);
  return new Promise(resolve=>{ confirmResolve = resolve; });
}

/* ---------------- textPrompt ---------------- */
let tpOverlay, tpResolve = null;
function ensureTextPromptDom(){
  if(tpOverlay) return;
  tpOverlay = document.createElement('div');
  tpOverlay.className = 'modal-overlay';
  tpOverlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-title"></div>
      <input class="ef-input tp-input" type="text" autocomplete="off" style="margin-top:8px;">
      <textarea class="ef-input tp-textarea" rows="4" style="margin-top:8px;resize:vertical;display:none;"></textarea>
      <div class="modal-actions">
        <button class="field-cancel">Отмена</button>
        <button class="field-save">Сохранить</button>
      </div>
    </div>
  `;
  document.body.appendChild(tpOverlay);
  const inputEl = tpOverlay.querySelector('.tp-input');
  const textareaEl = tpOverlay.querySelector('.tp-textarea');
  const okBtn = tpOverlay.querySelector('.field-save');
  const cancelBtn = tpOverlay.querySelector('.field-cancel');
  const close = (result)=>{
    tpOverlay.classList.remove('show');
    if(tpResolve){ const r = tpResolve; tpResolve = null; r(result); }
  };
  const activeEl = ()=> tpOverlay._opts.multiline ? textareaEl : inputEl;
  const submit = ()=>{
    const val = activeEl().value.trim();
    if(tpOverlay._opts.required && !val) return;
    close(val);
  };
  okBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', ()=> close(null));
  tpOverlay.addEventListener('mousedown', e=>{ if(e.target===tpOverlay) close(null); });
  tpOverlay.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ e.preventDefault(); close(null); }
    if(e.key==='Enter' && e.target===inputEl){ e.preventDefault(); submit(); }
  });
  tpOverlay._els = { inputEl, textareaEl, okBtn };
}
function textPrompt(options){
  ensureTextPromptDom();
  const opts = Object.assign({ title:'Введите значение', label:'', initialValue:'', placeholder:'', multiline:false, required:false }, options);
  tpOverlay._opts = opts;
  tpOverlay.querySelector('.modal-title').textContent = opts.title;
  const { inputEl, textareaEl } = tpOverlay._els;
  inputEl.style.display = opts.multiline ? 'none' : '';
  textareaEl.style.display = opts.multiline ? '' : 'none';
  const el = opts.multiline ? textareaEl : inputEl;
  el.value = opts.initialValue || '';
  el.placeholder = opts.placeholder || opts.label || '';
  tpOverlay.classList.add('show');
  setTimeout(()=>{ el.focus(); el.select(); }, 0);
  return new Promise(resolve=>{ tpResolve = resolve; });
}

/* ---------------- resolveConflict ---------------- */
// Замена молчаливой перезаписи при одновременном редактировании (см.
// expectedRev в PATCH /allods, /locations). Показывает и мою, и чужую
// версию поля рядом — пользователь решает сам, а не теряет правку молча.
let conflictOverlay, conflictResolve = null;
function ensureConflictDom(){
  if(conflictOverlay) return;
  conflictOverlay = document.createElement('div');
  conflictOverlay.className = 'modal-overlay';
  conflictOverlay.innerHTML = `
    <div class="modal-box" style="width:460px;">
      <div class="modal-title">Кто-то другой уже сохранил это поле</div>
      <div class="modal-message">Пока вы редактировали «<span class="cf-field"></span>», кто-то ещё изменил и сохранил остров. Ваша правка ещё не потеряна — выберите, что делать.</div>
      <div style="margin-top:12px;">
        <div style="font-family:var(--ui);font-size:11px;color:var(--parchment-dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Их версия (уже сохранена)</div>
        <div class="cf-theirs" style="background:var(--void-0);border:1px solid var(--line);border-radius:3px;padding:10px 12px;font-family:var(--display);font-size:14px;color:var(--parchment-dim);max-height:120px;overflow-y:auto;white-space:pre-wrap;"></div>
      </div>
      <div style="margin-top:10px;">
        <div style="font-family:var(--ui);font-size:11px;color:var(--parchment-dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Ваша версия (ещё не сохранена)</div>
        <div class="cf-mine" style="background:var(--void-0);border:1px solid var(--gold);border-radius:3px;padding:10px 12px;font-family:var(--display);font-size:14px;color:var(--parchment);max-height:120px;overflow-y:auto;white-space:pre-wrap;"></div>
      </div>
      <div class="modal-actions">
        <button class="field-cancel">Отменить мою правку</button>
        <button class="field-save">Сохранить мою версию поверх</button>
      </div>
    </div>
  `;
  document.body.appendChild(conflictOverlay);
  const okBtn = conflictOverlay.querySelector('.field-save');
  const cancelBtn = conflictOverlay.querySelector('.field-cancel');
  const close = (result)=>{
    conflictOverlay.classList.remove('show');
    if(conflictResolve){ const r = conflictResolve; conflictResolve = null; r(result); }
  };
  okBtn.addEventListener('click', ()=> close('overwrite'));
  cancelBtn.addEventListener('click', ()=> close('discard'));
  conflictOverlay.addEventListener('mousedown', e=>{ if(e.target===conflictOverlay) close('discard'); });
  conflictOverlay.addEventListener('keydown', e=>{ if(e.key==='Escape'){ e.preventDefault(); close('discard'); } });
}
function resolveConflict({ fieldLabel, myValue, theirValue }){
  ensureConflictDom();
  conflictOverlay.querySelector('.cf-field').textContent = fieldLabel;
  conflictOverlay.querySelector('.cf-theirs').textContent = theirValue || '(пусто)';
  conflictOverlay.querySelector('.cf-mine').textContent = myValue || '(пусто)';
  conflictOverlay.classList.add('show');
  return new Promise(resolve=>{ conflictResolve = resolve; });
}
