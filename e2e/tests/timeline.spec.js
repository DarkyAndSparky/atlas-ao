const { test, expect } = require('@playwright/test');
const { gotoReady, loginAndEnableEditor, fillEventForm, confirmModalAccept } = require('../helpers');

test.describe('Хронология', ()=>{

  test('мировая хронология пуста по умолчанию и позволяет добавить событие', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="timeline"]');
    await expect(page.locator('#timelineView')).toHaveClass(/show/);

    await page.click('#addWorldEventBtn');
    await fillEventForm(page, { title: 'Основание Империи', year: 10, description: 'Первое событие мировой хронологии' });

    await expect(page.locator('.timeline-event-title', { hasText: 'Основание Империи' })).toBeVisible();
    await expect(page.locator('.timeline-year', { hasText: '10' })).toBeVisible();
  });

  test('события сортируются по году на экране', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="timeline"]');

    await page.click('#addWorldEventBtn');
    await fillEventForm(page, { title: 'Позднее событие', year: 900 });
    await expect(page.locator('.timeline-event-title', { hasText: 'Позднее событие' })).toBeVisible();

    await page.click('#addWorldEventBtn');
    await fillEventForm(page, { title: 'Раннее событие', year: 1 });
    await expect(page.locator('.timeline-event-title', { hasText: 'Раннее событие' })).toBeVisible();

    const years = await page.locator('.timeline-year').allTextContents();
    const nums = years.map(Number);
    const sorted = [...nums].sort((a,b)=>a-b);
    expect(nums).toEqual(sorted);
  });

  test('хронология аллода: добавление события на странице острова и удаление', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="wiki"]');
    await page.locator('.wiki-island-link').first().click();
    await expect(page.locator('#detailView')).toHaveClass(/show/);

    await page.locator('#timelineSection .add-source-btn').scrollIntoViewIfNeeded();
    await page.locator('#timelineSection .add-source-btn').click();
    await fillEventForm(page, { title: 'Основание острова', year: 5, description: 'первое поселение' });

    await expect(page.locator('#timelineSection .timeline-event-title', { hasText: 'Основание острова' })).toBeVisible();

    await page.locator('#timelineSection [data-action="delete-event"]').click();
    await confirmModalAccept(page);
    await expect(page.locator('#timelineSection .timeline-event')).toHaveCount(0);
  });

});
