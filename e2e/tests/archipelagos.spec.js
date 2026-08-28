const { test, expect } = require('@playwright/test');
const { gotoReady, loginAndEnableEditor } = require('../helpers');

test.describe('Архипелаги', ()=>{

  test('кнопка "+🏝" в Атласе островов создаёт архипелаг и привязывает остров', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="wiki"]');
    const row = page.locator('.wiki-island-row').first();
    const islandName = (await row.locator('.wiki-island-link').textContent()).replace('●','').trim();

    page.once('dialog', d => d.accept('Новый архипелаг из Атласа'));
    await row.locator('[data-action="add-to-archipelago"]').click();

    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)

    await page.click('[data-view="archipelagos"]');
    await expect(page.locator('#archipelagosView')).toHaveClass(/show/);
    const card = page.locator('.source-card', { hasText: 'Новый архипелаг из Атласа' });
    await expect(card).toBeVisible();
    await expect(card.locator('.source-ref-chip', { hasText: islandName })).toBeVisible();
  });

  test('ctrl+клик на карте выделяет маркеры, панель собирает их в архипелаг', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('[data-view="map"]');

    const markers = page.locator('.marker');
    const count = await markers.count();
    test.skip(count < 2, 'нужно минимум 2 острова на карте для этого теста');

    await markers.nth(0).click({ modifiers: ['Control'] });
    await markers.nth(1).click({ modifiers: ['Control'] });
    await expect(page.locator('#mapSelectionPanel')).toContainText('Выбрано: 2');
    await expect(markers.nth(0)).toHaveClass(/selected/);
    await expect(markers.nth(1)).toHaveClass(/selected/);

    page.once('dialog', d => d.accept('Собранный через ctrl+клик архипелаг'));
    await page.click('#mapSelectionAssignBtn');

    // панель выделения должна закрыться после успешной привязки
    await expect(page.locator('#mapSelectionPanel')).toHaveCount(0);

    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)

    await page.click('[data-view="archipelagos"]');
    const card = page.locator('.source-card', { hasText: 'Собранный через ctrl+клик архипелаг' });
    await expect(card).toContainText('2');
  });

  test('кнопка "✕" в панели выделения снимает выделение без создания архипелага', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('[data-view="map"]');

    const markers = page.locator('.marker');
    const count = await markers.count();
    test.skip(count < 1, 'нужен минимум 1 остров на карте');

    await markers.nth(0).click({ modifiers: ['Control'] });
    await expect(page.locator('#mapSelectionPanel')).toBeVisible();
    await page.click('#mapSelectionClearBtn');
    await expect(page.locator('#mapSelectionPanel')).toHaveCount(0);
    await expect(markers.nth(0)).not.toHaveClass(/selected/);
  });

  test('пикер на странице острова: создать новый архипелаг и открепить обратно', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="wiki"]');
    await page.locator('.wiki-island-link').first().click();
    await expect(page.locator('#detailView')).toHaveClass(/show/);

    const select = page.locator('#archipelagoSelect');
    await expect(select).toBeVisible();

    page.once('dialog', d => d.accept('Архипелаг из пикера острова'));
    await select.selectOption('__new__');
    await expect(select).not.toHaveValue('__new__');

    // открепление — выбрать "— Нет —"
    await select.selectOption('');
    // после смены значения select должен снова показывать "— Нет —"
    await expect(select).toHaveValue('');
  });

  test('удаление архипелага не удаляет остров — только открепляет', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="wiki"]');
    await page.locator('.wiki-island-link').first().click();

    page.once('dialog', d => d.accept('Архипелаг на удаление'));
    await page.locator('#archipelagoSelect').selectOption('__new__');

    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)

    await page.click('[data-view="archipelagos"]');
    const card = page.locator('.source-card', { hasText: 'Архипелаг на удаление' });
    await expect(card).toBeVisible();

    page.once('dialog', d => d.accept());
    await card.locator('[data-action="delete-archipelago"]').click();
    await expect(page.locator('.source-card', { hasText: 'Архипелаг на удаление' })).toHaveCount(0);
  });

});
