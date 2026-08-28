const { test, expect } = require('@playwright/test');
const { gotoReady, loginAndEnableEditor } = require('../helpers');

test.describe('История правок', ()=>{

  test('гость не видит секцию истории на странице острова', async ({ page })=>{
    await gotoReady(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="wiki"]');
    await page.locator('.wiki-island-link').first().click();
    await expect(page.locator('#detailView')).toHaveClass(/show/);
    await expect(page.locator('#historySection')).toBeEmpty();
  });

  test('после правки описания в истории появляется запись, "Посмотреть" раскрывает старое значение', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="wiki"]');
    await page.locator('.wiki-island-link').first().click();

    const descField = page.locator('[data-field="description"]');
    await descField.click();
    await descField.fill('Значение до правки, которое должно попасть в историю.');
    await descField.blur();
    await page.waitForTimeout(300);

    // вторая правка — именно она создаёт запись со снимком "значения до правки" выше
    await descField.click();
    await descField.fill('Новое значение после второй правки.');
    await descField.blur();
    await page.waitForTimeout(300);

    await page.reload();
    await page.waitForTimeout(500);

    const firstEntry = page.locator('.history-item').first();
    await expect(firstEntry).toBeVisible();
    await expect(firstEntry.locator('.history-author')).toContainText('admin');

    await firstEntry.locator('[data-action="view-snapshot"]').click();
    await expect(firstEntry.locator('.history-snapshot-body')).toContainText('Значение до правки');
  });

});
