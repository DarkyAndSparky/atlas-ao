const { test, expect } = require('@playwright/test');
const { gotoReady, loginAndEnableEditor } = require('../helpers');

test.describe('Общий журнал изменений', ()=>{

  test('кнопка скрыта у гостя, появляется после входа', async ({ page })=>{
    await gotoReady(page);
    await expect(page.locator('#recentChangesBtn')).toBeHidden();
    await loginAndEnableEditor(page);
    await expect(page.locator('#recentChangesBtn')).toBeVisible();
  });

  test('правка острова появляется в общем журнале со ссылкой на этот остров', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="wiki"]');
    await page.locator('.wiki-island-link').first().click();
    const islandName = (await page.locator('h1[data-field="name"]').textContent()).trim();

    const descField = page.locator('[data-field="description"]');
    await descField.click();
    await descField.fill('Правка для проверки общего журнала изменений.');
    await descField.blur();
    await page.waitForTimeout(300);

    await page.click('#recentChangesBtn');
    await expect(page.locator('#recentChangesView')).toHaveClass(/show/);
    const entry = page.locator('.history-target', { hasText: islandName }).first();
    await expect(entry).toBeVisible();

    await entry.click();
    await expect(page.locator('#detailView')).toHaveClass(/show/);
    await expect(page.locator('h1[data-field="name"]')).toContainText(islandName);
  });

});
