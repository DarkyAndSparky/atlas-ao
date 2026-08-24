const { test, expect } = require('@playwright/test');
const { gotoReady, loginAndEnableEditor } = require('../helpers');

test.describe('Слайдер динамики островов', ()=>{

  test('без заполненных year_appeared/year_disappeared слайдер не показывается', async ({ page })=>{
    await gotoReady(page);
    await expect(page.locator('#timelineSliderBar')).not.toHaveClass(/show/);
  });

  test('слайдер появляется после заполнения годов, фильтрует остров по существованию на выбранный год', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);

    // берём остров, уже размещённый на карте
    await page.click('[data-view="map"]');
    const marker = page.locator('.marker').first();
    const allodId = await marker.getAttribute('data-id');
    await marker.click();
    await expect(page.locator('#detailView')).toHaveClass(/show/);

    page.once('dialog', d => d.accept('500'));
    await page.locator('.sidebar-fact[data-field="year_appeared"]').click();
    page.once('dialog', d => d.accept('600'));
    await page.locator('.sidebar-fact[data-field="year_disappeared"]').click();

    await page.click('[data-view="map"]');
    await expect(page.locator('#timelineSliderBar')).toHaveClass(/show/);

    const thisMarker = page.locator(`.marker[data-id="${allodId}"]`);

    // год до появления острова — маркер скрыт
    await page.fill('#timelineYearInput', '400');
    await page.locator('#timelineYearInput').dispatchEvent('change');
    await expect(thisMarker).toHaveCount(0);

    // год существования острова — маркер виден
    await page.fill('#timelineYearInput', '550');
    await page.locator('#timelineYearInput').dispatchEvent('change');
    await expect(thisMarker).toHaveCount(1);

    // год после исчезновения — маркер снова скрыт
    await page.fill('#timelineYearInput', '650');
    await page.locator('#timelineYearInput').dispatchEvent('change');
    await expect(thisMarker).toHaveCount(0);

    // "Показать все острова" отменяет фильтр по году
    await page.check('#timelineShowAllCheckbox');
    await expect(thisMarker).toHaveCount(1);
  });

});
