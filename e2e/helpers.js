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

module.exports = { loginViaUI, enableEditor, loginAndEnableEditor, gotoReady, TEST_USERNAME, TEST_PASSWORD };
