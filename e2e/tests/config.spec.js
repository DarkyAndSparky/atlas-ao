const { test, expect } = require('@playwright/test');
const { loginViaUI, gotoReady, openConfig } = require('../helpers');

test.describe('Панель конфига (админ)', ()=>{

  test('кнопка «Конфиг» скрыта без входа и появляется после входа', async ({ page })=>{
    await gotoReady(page);
    await expect(page.locator('#configBtn')).toBeHidden();
    await loginViaUI(page);
    await expect(page.locator('#configBtn')).toBeVisible();
  });

  test('открывается по клику и содержит все три карточки', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);
    await expect(page.locator('#configView')).toHaveClass(/show/);
    await expect(page.locator('.config-card')).toHaveCount(8);
  });

  test('смена названия обновляет шапку и title вкладки', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    await page.fill('#cfgTitle', 'E2E Тест Атлас');
    await page.click('#cfgTitleSave');
    await page.waitForTimeout(400);

    await expect(page).toHaveTitle('E2E Тест Атлас');
    await expect(page.locator('#brand')).toContainText('E2E Тест Атлас');

    const saved = await page.evaluate(async () => (await (await fetch('/api/settings')).json()).title);
    expect(saved).toBe('E2E Тест Атлас');
  });

  test('цвет акцента применяется сразу после сохранения (тёмная тема)', async ({ page })=>{
    await page.emulateMedia({ colorScheme: 'dark' });
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    await page.evaluate(() => {
      const el = document.getElementById('cfgAccentDark');
      el.value = '#3399ff';
      el.dispatchEvent(new Event('input'));
    });
    await page.click('#cfgAccentSave');
    await page.waitForTimeout(400);

    const gold = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gold').trim());
    expect(gold.toLowerCase()).toBe('#3399ff');
  });

  test('загрузка и удаление логотипа', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    await expect(page.locator('#cfgLogoPreview span')).toHaveText('Логотип не установлен');

    // 1x1 валидный PNG
    const pngBuffer = Buffer.from(
      '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
      'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082',
      'hex'
    );
    await page.setInputFiles('#cfgLogoFile', { name: 'logo.png', mimeType: 'image/png', buffer: pngBuffer });
    await page.waitForTimeout(500);

    await expect(page.locator('#cfgLogoPreview img')).toBeVisible();
    await expect(page.locator('.brand-logo')).toBeVisible();

    await page.click('#cfgLogoRemove');
    await page.waitForTimeout(400);
    await expect(page.locator('#cfgLogoPreview span')).toHaveText('Логотип не установлен');
    await expect(page.locator('.brand-logo')).toHaveCount(0);
  });

  test('шрифт Allods West применён к заголовкам', async ({ page })=>{
    await gotoReady(page);
    await page.waitForTimeout(500);
    const loaded = await page.evaluate(() => document.fonts.check('20px "Allods West"'));
    expect(loaded).toBe(true);
    const brandFont = await page.locator('#brand').evaluate(el => getComputedStyle(el).fontFamily);
    expect(brandFont).toContain('Allods West');
  });

  test('переключатель темы: светлая/тёмная/авто применяются и сохраняются', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    // выбираем тёмную явно
    await page.click('[data-theme-choice="dark"]');
    await page.waitForTimeout(200);
    let attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr).toBe('dark');
    let stored = await page.evaluate(() => localStorage.getItem('atlas_theme'));
    expect(stored).toBe('dark');

    // выбираем светлую явно
    await page.click('[data-theme-choice="light"]');
    await page.waitForTimeout(200);
    attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr).toBe('light');

    // переживает перезагрузку страницы (без мигания — атрибут выставляется инлайн-скриптом в head)
    await page.reload();
    await page.waitForTimeout(300);
    attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr).toBe('light');

    // возврат к авто убирает атрибут и запись в localStorage
    await openConfig(page);
    await page.click('[data-theme-choice="auto"]');
    await page.waitForTimeout(200);
    attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr).toBeNull();
    stored = await page.evaluate(() => localStorage.getItem('atlas_theme'));
    expect(stored).toBeNull();
  });

  test('карта центрируется по видимой области при загрузке', async ({ page })=>{
    await page.setViewportSize({ width: 1920, height: 1000 });
    await gotoReady(page);
    await page.waitForTimeout(300);
    const rect = await page.locator('#mapCanvas').evaluate(el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: window.innerWidth - r.right };
    });
    expect(Math.abs(rect.left - rect.right)).toBeLessThan(5);
  });

  test('панель настроек: стартовый набор украшений виден и в него можно добавить своё', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    await expect(page.locator('.deco-manage-item')).toHaveCount(10);

    await page.fill('#cfgNewDecoName', 'E2E Своя картинка');
    await page.setInputFiles('#cfgNewDecoFile', {
      name: 'e2e-deco.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
        'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082', 'hex'),
    });
    await page.click('#cfgAddDecoBtn');
    await page.waitForTimeout(500);

    await expect(page.locator('.deco-manage-item')).toHaveCount(11);
    await expect(page.locator('.deco-manage-item')).toContainText('E2E Своя картинка');
  });

  test('панель настроек: удаление украшения убирает его из списка', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    await page.fill('#cfgNewDecoName', 'E2E Удалю Меня');
    await page.setInputFiles('#cfgNewDecoFile', {
      name: 'e2e-deco-2.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
        'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082', 'hex'),
    });
    await page.click('#cfgAddDecoBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('.deco-manage-item', { hasText: 'E2E Удалю Меня' })).toHaveCount(1);

    page.once('dialog', dialog => dialog.accept());
    await page.locator('.deco-manage-item', { hasText: 'E2E Удалю Меня' }).locator('.deco-del').click();
    await page.waitForTimeout(500);

    await expect(page.locator('.deco-manage-item', { hasText: 'E2E Удалю Меня' })).toHaveCount(0);
  });

  test('панель настроек: стартовый набор иконок фракций виден и в него можно добавить свою', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    await expect(page.locator('.faction-manage-item')).toHaveCount(8);

    await page.fill('#cfgNewFactionName', 'E2E Тестовая Фракция');
    await page.setInputFiles('#cfgNewFactionFile', {
      name: 'e2e-faction.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
        'de0000000c4944415478da6360000002000100b0e9d5330000000049454e44ae426082', 'hex'),
    });
    await page.click('#cfgAddFactionBtn');
    await page.waitForTimeout(500);

    await expect(page.locator('.faction-manage-item')).toHaveCount(9);
  });

  test('панель настроек: переименование иконки фракции сохраняется', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    const input = page.locator('.faction-name-input').first();
    const oldValue = await input.inputValue();
    await input.fill(oldValue + ' (переименовано)');
    await input.blur();
    await page.waitForTimeout(500);

    const values = await page.locator('.faction-name-input').evaluateAll(els => els.map(e => e.value));
    expect(values).toContain(oldValue + ' (переименовано)');
  });

  test('панель настроек: удаление иконки фракции убирает её из списка', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    await expect(page.locator('.faction-manage-item').first()).toBeVisible();
    const before = await page.locator('.faction-manage-item').count();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.faction-del').first().click();

    await expect(page.locator('.faction-manage-item')).toHaveCount(before - 1);
  });

});

test.describe('Управление пользователями (расширенное меню прав)', ()=>{

  test('смена роли существующего пользователя через выпадающий список', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    await page.fill('#cfgNewUser', 'e2e-role-target');
    await page.fill('#cfgNewPass', 'e2e-role-target-pass1');
    await page.selectOption('#cfgNewRole', 'editor');
    await page.click('#cfgAddUserBtn');

    const row = page.locator('.user-row', { hasText: 'e2e-role-target' });
    const select = row.locator('.user-role-select');
    await expect(select).toHaveValue('editor');

    page.once('dialog', d => d.accept());
    await select.selectOption('admin');
    await expect(select).toHaveValue('admin');
  });

  test('нельзя понизить последнего администратора — select откатывается назад', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    const adminRow = page.locator('.user-row', { hasText: 'admin' }).first();
    const select = adminRow.locator('.user-role-select');
    // на этот момент в системе может быть больше одного админа из прошлого теста —
    // проверяем именно ситуацию единственного администратора отдельно через API
    const adminsCount = await page.evaluate(async () => {
      const res = await fetch('/api/auth/users', { credentials: 'same-origin' });
      const users = await res.json();
      return users.filter(u => u.role === 'admin').length;
    });
    test.skip(adminsCount > 1, 'нужен ровно один администратор для этого сценария');

    page.once('dialog', d => d.accept());
    await select.selectOption('editor');
    await expect(select).toHaveValue('admin'); // откатилось обратно после ошибки с сервера
  });

  test('«Сбросить пароль» помечает пользователя как ожидающего смены пароля', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await openConfig(page);

    // свежезарегистрированный (приглашённый) пользователь и так стартует с
    // ожидающим сбросом по умолчанию — берём уже существующий bootstrap-аккаунт
    // admin, у которого этого флага изначально нет, чтобы проверить именно кнопку
    const row = page.locator('.user-row', { hasText: 'admin' }).first();
    await expect(row.locator('.user-reset-pending')).toHaveCount(0);

    page.once('dialog', d => d.accept());
    await row.locator('.user-reset-pass').click();

    await expect(row.locator('.user-reset-pending')).toBeVisible();
  });

});
