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

async function loginAndEnableEditor(page){
  await loginViaUI(page);
  await enableEditor(page);
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

module.exports = { loginViaUI, enableEditor, loginAndEnableEditor, gotoReady, useIsolatedDrawingProject, openConfig, TEST_USERNAME, TEST_PASSWORD };
