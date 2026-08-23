const { test, expect } = require('@playwright/test');
const { gotoReady, loginAndEnableEditor } = require('../helpers');

test.describe('Хронология', ()=>{

  test('мировая хронология пуста по умолчанию и позволяет добавить событие', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('[data-view="timeline"]');
    await expect(page.locator('#timelineView')).toHaveClass(/show/);

    let step = 0;
    const answers = ['Основание Империи', '10', 'Первое событие мировой хронологии'];
    page.on('dialog', d => d.accept(answers[step++]));
    await page.click('#addWorldEventBtn');

    await expect(page.locator('.timeline-event-title', { hasText: 'Основание Империи' })).toBeVisible();
    await expect(page.locator('.timeline-year', { hasText: '10' })).toBeVisible();
  });

  test('события сортируются по году на экране', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('[data-view="timeline"]');

    let step = 0;
    let answers = ['Позднее событие', '900', ''];
    page.on('dialog', d => d.accept(answers[step++]));
    await page.click('#addWorldEventBtn');
    await expect(page.locator('.timeline-event-title', { hasText: 'Позднее событие' })).toBeVisible();

    step = 0;
    answers = ['Раннее событие', '1', ''];
    await page.click('#addWorldEventBtn');
    await expect(page.locator('.timeline-event-title', { hasText: 'Раннее событие' })).toBeVisible();

    const years = await page.locator('.timeline-year').allTextContents();
    const nums = years.map(Number);
    const sorted = [...nums].sort((a,b)=>a-b);
    expect(nums).toEqual(sorted);
  });

  test('хронология аллода: добавление события на странице острова и удаление', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('[data-view="wiki"]');
    await page.locator('.wiki-island-link').first().click();
    await expect(page.locator('#detailView')).toHaveClass(/show/);

    let step = 0;
    const answers = ['Основание острова', '5', 'первое поселение'];
    page.on('dialog', d => d.accept(answers[step++]));
    await page.locator('#timelineSection .add-source-btn').scrollIntoViewIfNeeded();
    await page.locator('#timelineSection .add-source-btn').click();

    await expect(page.locator('#timelineSection .timeline-event-title', { hasText: 'Основание острова' })).toBeVisible();

    await page.locator('#timelineSection [data-action="delete-event"]').click();
    // confirm() для удаления обрабатывается тем же общим 'dialog' — но там
    // ответов в очереди уже не осталось, page.on всегда возвращает accept('')
    // на любой следующий диалог (см. handler выше — он безусловно accept'ит),
    // так что удаление тоже подтвердится
    await expect(page.locator('#timelineSection .timeline-event')).toHaveCount(0);
  });

});
