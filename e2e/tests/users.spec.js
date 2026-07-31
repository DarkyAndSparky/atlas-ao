const { test, expect } = require('@playwright/test');
const { loginViaUI, TEST_USERNAME, TEST_PASSWORD, gotoReady } = require('../helpers');

test.describe('Управление редакторами (панель настроек)', ()=>{

  test('список редакторов показывает текущего пользователя, кнопки удаления нет — он один', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await page.click('#configBtn');

    await expect(page.locator('.user-row')).toHaveCount(1);
    await expect(page.locator('.user-row')).toContainText(TEST_USERNAME);
    await expect(page.locator('.user-del')).toHaveCount(0); // последнего удалить нельзя
  });

  test('добавление нового редактора: появляется в списке и может войти', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await page.click('#configBtn');

    await page.fill('#cfgNewUser', 'e2e-second-editor');
    await page.fill('#cfgNewPass', 'second-editor-pass1');
    await page.click('#cfgAddUserBtn');
    await page.waitForTimeout(500);

    await expect(page.locator('.user-row')).toHaveCount(2);
    await expect(page.locator('.user-row')).toContainText('e2e-second-editor');
    // теперь редакторов двое — у обоих должна появиться кнопка удаления
    await expect(page.locator('.user-del')).toHaveCount(2);

    // новый аккаунт реально может войти
    const status = await page.evaluate(async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username: 'e2e-second-editor', password: 'second-editor-pass1' }),
      });
      return res.status;
    });
    expect(status).toBe(200);
  });

  test('удаление чужого редактора убирает его из списка и он больше не может войти', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await page.click('#configBtn');

    await page.fill('#cfgNewUser', 'e2e-to-remove');
    await page.fill('#cfgNewPass', 'remove-me-pass1');
    await page.click('#cfgAddUserBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('.user-row')).toContainText('e2e-to-remove');

    page.once('dialog', dialog => dialog.accept());
    await page.locator('.user-row', { hasText: 'e2e-to-remove' }).locator('.user-del').click();
    await page.waitForTimeout(500);

    await expect(page.locator('.user-row')).not.toContainText('e2e-to-remove');

    const status = await page.evaluate(async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username: 'e2e-to-remove', password: 'remove-me-pass1' }),
      });
      return res.status;
    });
    expect(status).toBe(401);
  });

  test('смена собственного пароля: новый работает, старый — нет', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await page.click('#configBtn');

    await page.fill('#cfgCurPass', TEST_PASSWORD);
    await page.fill('#cfgNewOwnPass', 'brand-new-password-1');
    await page.click('#cfgChangePassBtn');
    await page.waitForTimeout(400);

    const oldStatus = await page.evaluate(async (username) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username, password: 'e2e-editor-password-123' }),
      });
      return res.status;
    }, TEST_USERNAME);
    expect(oldStatus).toBe(401);

    const newStatus = await page.evaluate(async (username) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username, password: 'brand-new-password-1' }),
      });
      return res.status;
    }, TEST_USERNAME);
    expect(newStatus).toBe(200);

    // возвращаем пароль обратно, чтобы не сломать глобальный global-setup-логин
    // для остальных тестов, идущих после этого в общем файле (общая БД/сервер)
    await page.evaluate(async () => {
      await fetch('/api/auth/password', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ currentPassword: 'brand-new-password-1', newPassword: 'e2e-editor-password-123' }),
      });
    });
  });

});
