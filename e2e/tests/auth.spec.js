const { test, expect } = require('@playwright/test');
const { loginViaUI, enableEditor, loginAndEnableEditor, TEST_USERNAME, TEST_PASSWORD, gotoReady } = require('../helpers');

test.describe('Вход и редактор', ()=>{

  test('неверный пароль показывает ошибку, не закрывая окно', async ({ page })=>{
    await gotoReady(page);
    await page.click('#authBtn');
    await page.waitForSelector('#authOverlay.show');
    await page.fill('#amUser', TEST_USERNAME);
    await page.fill('#amPass', 'совершенно неверный пароль');
    await page.click('#amSubmit');
    await expect(page.locator('#amErr')).not.toBeEmpty();
    await expect(page.locator('#authOverlay')).toHaveClass(/show/);
  });

  test('верный пароль логинит и открывает доступ к редактору', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await expect(page.locator('#authBtn')).toContainText('Выйти');
    await enableEditor(page);
    await expect(page.locator('#editorToggle')).toHaveClass(/on/);
    // в режиме редактора появляется панель неразмещённых островов
    await expect(page.locator('#tray')).toHaveClass(/show/);
  });

  test('после выхода редактор снова недоступен', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);
    await page.click('#authBtn'); // теперь это "Выйти"
    await page.waitForTimeout(300);
    await expect(page.locator('#authBtn')).toHaveText('Войти');
    await expect(page.locator('#editorToggle')).not.toHaveClass(/on/);
  });

  test('название острова редактируется только в режиме редактора', async ({ page })=>{
    await gotoReady(page);
    await page.evaluate(() => openDetail('a010'));
    const nameEl = page.locator('[data-field="name"]');
    await expect(nameEl).toHaveAttribute('contenteditable', 'false');

    await loginViaUI(page);
    await enableEditor(page);
    await page.evaluate(() => renderDetail());
    await expect(nameEl).toHaveAttribute('contenteditable', 'true');
  });

  test('выход из аккаунта на странице вики не перекидывает на карту (регрессия)', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="wiki"]');
    await expect(page.locator('#wikiView')).toHaveClass(/show/);

    await page.click('#authBtn'); // теперь это "Выйти (...)"
    await expect(page.locator('#authBtn')).toHaveText('Войти');

    await expect(page.locator('#wikiView')).toHaveClass(/show/);
    await expect(page.locator('#mapView')).toBeHidden();
  });

});
