const { test, expect } = require('@playwright/test');
const { gotoReady, loginAndEnableEditor } = require('../helpers');

test.describe('Полнотекстовый поиск', ()=>{

  test('находит остров по слову из описания, не только по названию', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('[data-view="wiki"]');
    await page.locator('.wiki-island-link').first().click();
    const islandName = await page.locator('h1[data-field="name"]').textContent();

    // редактируем description через contenteditable-поле (см. detailView.js)
    const descField = page.locator('[data-field="description"]');
    await descField.click();
    await descField.fill('Здесь обитает уникальный текстовый маркер жуккоящер.');
    await descField.blur();
    await page.waitForTimeout(300); // debounce автосохранения текстовых полей

    await page.click('[data-view="map"]');
    await page.fill('#searchbox', 'жуккоящер');

    // мгновенный слой (по имени) вряд ли найдёт — ждём полнотекстовый (debounce ~250мс)
    await expect(page.locator('.sr-fts-divider')).toBeVisible({ timeout: 3000 });
    const ftsItem = page.locator('.sr-item-fts', { hasText: islandName.trim() });
    await expect(ftsItem).toBeVisible();
    await expect(ftsItem.locator('mark')).toContainText('жуккоящер', { ignoreCase: true });
  });

  test('пустой ввод скрывает выпадающий список', async ({ page })=>{
    await gotoReady(page);
    await page.fill('#searchbox', 'что-то');
    await expect(page.locator('#searchResults')).toHaveClass(/show/);
    await page.fill('#searchbox', '');
    await expect(page.locator('#searchResults')).not.toHaveClass(/show/);
  });

  test('явно бессмысленный запрос показывает "ничего не найдено", а не падает', async ({ page })=>{
    await gotoReady(page);
    await page.fill('#searchbox', 'zzzzzzzzzнеттакогослова');
    await page.waitForTimeout(500);
    await expect(page.locator('.sr-empty')).toBeVisible();
  });

});
