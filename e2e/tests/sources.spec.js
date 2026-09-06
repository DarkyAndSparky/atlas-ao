const { test, expect } = require('@playwright/test');
const { gotoReady, loginAndEnableEditor, fillSourceForm, pickFromListByText, fillTextPrompt } = require('../helpers');

test.describe('Источники', ()=>{

  test('глобальная страница показывает 3 засеянных источника', async ({ page })=>{
    await gotoReady(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="sources"]');
    await expect(page.locator('#sourcesView')).toHaveClass(/show/);
    await expect(page.locator('.source-card')).toHaveCount(3);
    await expect(page.locator('.source-card-title')).toContainText(['Введение в историю вселенной Аллодов']);
  });

  test('добавление источника с глобальной страницы и последующее редактирование', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="sources"]');
    await page.click('#addGlobalSourceBtn');
    await fillSourceForm(page, { title: 'E2E тестовый источник', url: 'https://example.com/e2e', note: 'заметка про источник' });
    await expect(page.locator('.source-card-title', { hasText: 'E2E тестовый источник' })).toBeVisible();

    const card = page.locator('.source-card', { hasText: 'E2E тестовый источник' });
    await card.locator('[data-action="edit-source"]').click();
    await fillSourceForm(page, { title: 'E2E источник (изменён)', url: 'https://example.com/e2e-2', note: 'новая заметка' });
    await expect(page.locator('.source-card-title', { hasText: 'E2E источник (изменён)' })).toBeVisible();
  });

  test('привязка источника к аллоду показывается и в блоке аллода, и на глобальной странице', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);

    // открываем первый попавшийся остров
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="wiki"]');
    const firstLink = page.locator('.wiki-island-link').first();
    const rawName = await firstLink.textContent();
    const allodName = rawName.replace('●','').trim();
    await firstLink.click();
    await expect(page.locator('#detailView')).toHaveClass(/show/);

    await page.locator('#sourcesSection .add-source-btn').scrollIntoViewIfNeeded();
    await page.locator('#sourcesSection .add-source-btn').click();
    await pickFromListByText(page, 'Введение в историю вселенной Аллодов');
    await fillTextPrompt(page, 'взято отсюда'); // заметка о привязке

    await expect(page.locator('#sourcesSection .entity-source-item')).toHaveCount(1);
    await expect(page.locator('#sourcesSection .entity-source-item .note')).toContainText('взято отсюда');

    // на глобальной странице у этого источника должна появиться ссылка-чип на остров
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="sources"]');
    const linkedCard = page.locator('.source-card', { hasText: 'Введение в историю вселенной Аллодов' });
    await expect(linkedCard.locator('.source-ref-chip', { hasText: allodName })).toBeVisible();
  });

  test('отвязка источника от аллода убирает его из блока', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="wiki"]');
    const firstLink = page.locator('.wiki-island-link').first();
    await firstLink.click();

    await page.locator('#sourcesSection .add-source-btn').click();
    await pickFromListByText(page, 'Введение в историю вселенной Аллодов');
    await fillTextPrompt(page, ''); // заметка о привязке — оставляем пустой
    await expect(page.locator('#sourcesSection .entity-source-item')).toHaveCount(1);

    await page.locator('#sourcesSection .entity-source-remove').click();
    await expect(page.locator('#sourcesSection .entity-source-item')).toHaveCount(0);
  });

});
