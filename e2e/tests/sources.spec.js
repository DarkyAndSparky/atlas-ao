const { test, expect } = require('@playwright/test');
const { gotoReady, loginAndEnableEditor } = require('../helpers');

// Диалоги (prompt/confirm) в этом UI идут строго по порядку — очередь
// ответов, которую по одному раздаём подряд приходящим page.on('dialog').
function queueDialogs(page, answers){
  const queue = [...answers];
  page.on('dialog', async (dialog)=>{
    const next = queue.shift();
    if(next === undefined || next === null){ await dialog.dismiss(); return; }
    await dialog.accept(String(next));
  });
}

test.describe('Источники', ()=>{

  test('глобальная страница показывает 3 засеянных источника', async ({ page })=>{
    await gotoReady(page);
    await page.click('[data-view="sources"]');
    await expect(page.locator('#sourcesView')).toHaveClass(/show/);
    await expect(page.locator('.source-card')).toHaveCount(3);
    await expect(page.locator('.source-card-title')).toContainText(['Введение в историю вселенной Аллодов']);
  });

  test('добавление источника с глобальной страницы и последующее редактирование', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('[data-view="sources"]');

    queueDialogs(page, ['E2E тестовый источник', 'https://example.com/e2e', 'заметка про источник']);
    await page.click('#addGlobalSourceBtn');
    await expect(page.locator('.source-card-title', { hasText: 'E2E тестовый источник' })).toBeVisible();

    const card = page.locator('.source-card', { hasText: 'E2E тестовый источник' });
    queueDialogs(page, ['E2E источник (изменён)', 'https://example.com/e2e-2', 'новая заметка']);
    await card.locator('[data-action="edit-source"]').click();
    await expect(page.locator('.source-card-title', { hasText: 'E2E источник (изменён)' })).toBeVisible();
  });

  test('привязка источника к аллоду показывается и в блоке аллода, и на глобальной странице', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);

    // открываем первый попавшийся остров
    await page.click('[data-view="wiki"]');
    const firstLink = page.locator('.wiki-island-link').first();
    const rawName = await firstLink.textContent();
    const allodName = rawName.replace('●','').trim();
    await firstLink.click();
    await expect(page.locator('#detailView')).toHaveClass(/show/);

    // порядковый номер источника в prompt-списке зависит от истории прошлых
    // тестов (сортировка по дате создания) — не хардкодим "1", а парсим
    // текст самого диалога и отвечаем номером строки с известным заголовком
    page.once('dialog', async (dialog)=>{
      const line = dialog.message().split('\n').find(l => l.includes('Введение в историю вселенной Аллодов'));
      const num = line ? line.match(/^(\d+)\./)[1] : '1';
      await dialog.accept(num);
      page.once('dialog', d2 => d2.accept('взято отсюда'));
    });
    await page.locator('#sourcesSection .add-source-btn').scrollIntoViewIfNeeded();
    await page.locator('#sourcesSection .add-source-btn').click();

    await expect(page.locator('#sourcesSection .entity-source-item')).toHaveCount(1);
    await expect(page.locator('#sourcesSection .entity-source-item .note')).toContainText('взято отсюда');

    // на глобальной странице у этого источника должна появиться ссылка-чип на остров
    await page.click('[data-view="sources"]');
    const linkedCard = page.locator('.source-card', { hasText: 'Введение в историю вселенной Аллодов' });
    await expect(linkedCard.locator('.source-ref-chip', { hasText: allodName })).toBeVisible();
  });

  test('отвязка источника от аллода убирает его из блока', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('[data-view="wiki"]');
    const firstLink = page.locator('.wiki-island-link').first();
    await firstLink.click();

    page.once('dialog', async (dialog)=>{
      const line = dialog.message().split('\n').find(l => l.includes('Введение в историю вселенной Аллодов'));
      const num = line ? line.match(/^(\d+)\./)[1] : '1';
      await dialog.accept(num);
      page.once('dialog', d2 => d2.accept(''));
    });
    await page.locator('#sourcesSection .add-source-btn').click();
    await expect(page.locator('#sourcesSection .entity-source-item')).toHaveCount(1);

    await page.locator('#sourcesSection .entity-source-remove').click();
    await expect(page.locator('#sourcesSection .entity-source-item')).toHaveCount(0);
  });

});
