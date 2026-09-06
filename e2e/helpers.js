const { TEST_USERNAME, TEST_PASSWORD } = require('./constants');

async function loginViaUI(page){
  await page.click('#authBtn');
  await page.locator('#authOverlay').waitFor({ state:'visible' });
  await page.fill('#amUser', TEST_USERNAME);
  await page.fill('#amPass', TEST_PASSWORD);
  await page.click('#amSubmit');
  await page.locator('#authOverlay').waitFor({ state:'hidden', timeout: 10000 });
}

async function enableEditor(page){
  const btn = page.locator('#editorToggle');
  const isOn = await btn.evaluate(el => el.classList.contains('on'));
  if(!isOn) await btn.click();
  await page.waitForSelector('#editorToggle.on');
}

// Раньше подтверждения/ввод текста шли через нативные window.confirm()/
// prompt(), и тесты ловили их через page.once('dialog', ...). Теперь это
// два переиспользуемых модальных компонента (confirmDialog/textPrompt в
// picker.js) — визуально в едином стиле сайта, но НЕ нативные диалоги
// браузера. page.once('dialog', ...) на них никогда не сработает: модалка
// просто виснет открытой (<div class="modal-overlay show">…) и перехватывает
// все последующие клики. Используем эти хелперы вместо page.once('dialog').
async function confirmModalAccept(page){
  const overlay = page.locator('.modal-overlay.show');
  await overlay.waitFor({ state: 'visible' });
  await overlay.locator('.field-save').click();
}
async function confirmModalCancel(page){
  const overlay = page.locator('.modal-overlay.show');
  await overlay.waitFor({ state: 'visible' });
  await overlay.locator('.field-cancel').click();
}
async function fillTextPrompt(page, value){
  const overlay = page.locator('.modal-overlay.show');
  await overlay.waitFor({ state: 'visible' });
  const input = overlay.locator('.tp-input:visible, .tp-textarea:visible').first();
  await input.fill(value);
  await overlay.locator('.field-save').click();
}
async function cancelTextPrompt(page){
  const overlay = page.locator('.modal-overlay.show');
  await overlay.waitFor({ state: 'visible' });
  await overlay.locator('.field-cancel').click();
}
// pickFromList — поисковый пикер (picker.js): печатаем в .modal-search,
// кликаем по совпавшему пункту .picker-item, содержащему нужный текст.
async function pickFromListByText(page, text){
  const overlay = page.locator('.modal-overlay.show');
  await overlay.waitFor({ state: 'visible' });
  await overlay.locator('.modal-search').fill(text);
  await overlay.locator('.picker-item', { hasText: text }).first().click();
}
// Для pickFromList({ allowCreate:true }) (editTagField и т.п.): вписываем
// значение, которого нет в списке, и жмём Enter — по renderPickerList()
// в picker.js это создаёт активную строку type:'create' и подтверждает её.
async function pickFromListCreate(page, text){
  const overlay = page.locator('.modal-overlay.show');
  await overlay.waitFor({ state: 'visible' });
  await overlay.locator('.modal-search').fill(text);
  await overlay.locator('.modal-search').press('Enter');
}
async function fillSourceForm(page, { title, url, note }){
  const overlay = page.locator('.modal-overlay.show');
  await overlay.waitFor({ state: 'visible' });
  if(title != null) await overlay.locator('.sf-title').fill(title);
  if(url != null) await overlay.locator('.sf-url').fill(url);
  if(note != null) await overlay.locator('.sf-note').fill(note);
  await overlay.locator('.field-save').click();
}
// Форма события хронологии (title+year+description в одном модальном окне,
// см. ensureEventFormDom в timelineView.js) — тоже замена старой цепочки из
// нескольких window.prompt().
async function fillEventForm(page, { title, year, description }){
  const overlay = page.locator('.modal-overlay.show');
  await overlay.waitFor({ state: 'visible' });
  await overlay.locator('.ef-title').fill(title);
  await overlay.locator('.ef-year').fill(String(year));
  if(description != null) await overlay.locator('.ef-desc').fill(description);
  await overlay.locator('.field-save').click();
}

async function loginAndEnableEditor(page){
  await loginViaUI(page);
  await enableEditor(page);
}

// Панель рисования — отдельный тоггл поверх режима редактора
// (см. updateDrawToolbarVisibility() в mapView.js: toolbar.show зависит от
// onMapInEditor && state.drawPanelOpen, а не только от editorOn). Открыть
// редактор недостаточно, чтобы кнопки .draw-tool стали видимы/кликабельны —
// нужно ещё явно нажать #drawToggleBtn.
async function openDrawPanel(page){
  const toolbar = page.locator('#drawToolbar');
  const isOpen = await toolbar.evaluate(el => el.classList.contains('show'));
  if(!isOpen) await page.click('#drawToggleBtn');
  await toolbar.waitFor({ state: 'visible' });
}

async function gotoReady(page, path='/'){
  await page.goto(path);
  await page.waitForFunction(() => typeof state !== 'undefined' && Array.isArray(state.data) && state.data.length > 0);
}

// Пометки слоя рисования привязаны к state.project — переключаем на заведомо
// несуществующий, уникальный на каждый тест проект: (а) там гарантированно
// нет ни одного настоящего острова, значит клики при рисовании не могут
// случайно попасть на маркер и отмениться; (б) пометки предыдущих тестов
// физически не могут туда попасть, счётчики надёжны без ручной очистки.
async function useIsolatedDrawingProject(page){
  const project = 'e2e-drawing-' + Math.random().toString(36).slice(2);
  await page.evaluate(async (project) => {
    state.project = project;
    await loadAnnotations();
    renderMarkers();
  }, project);
  return project;
}

// renderConfigPanel() асинхронная (подгружает список редакторов/украшений/
// иконок фракций перед отрисовкой) — просто клика по кнопке недостаточно,
// нужно дождаться, что форма реально появилась в DOM.
async function openConfig(page){
  await page.click('#configBtn');
  await page.locator('.config-card').first().waitFor({ state: 'visible' });
}

module.exports = { loginViaUI, enableEditor, loginAndEnableEditor, openDrawPanel, gotoReady, useIsolatedDrawingProject, openConfig, confirmModalAccept, confirmModalCancel, fillTextPrompt, cancelTextPrompt, fillEventForm, pickFromListByText, pickFromListCreate, fillSourceForm, TEST_USERNAME, TEST_PASSWORD };
