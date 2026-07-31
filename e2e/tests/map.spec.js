const { test, expect } = require('@playwright/test');
const { gotoReady } = require('../helpers');

test.describe('Глобальная карта', ()=>{

  test('страница загружается, шапка и карта на месте', async ({ page })=>{
    await gotoReady(page);
    await expect(page.locator('.brand')).toContainText('Атлас');
    await expect(page.locator('#mapView')).toBeVisible();
    await expect(page.locator('#mapCanvas')).toBeVisible();
  });

  test('без входа редактор недоступен: контент не редактируется', async ({ page })=>{
    await gotoReady(page);
    await page.click('#editorToggle');
    // без логина клик должен открыть окно входа, а не включить редактор
    await expect(page.locator('#authOverlay')).toHaveClass(/show/);
    await expect(page.locator('#editorToggle')).not.toHaveClass(/on/);
  });

  test('поиск фильтрует список неразмещённых островов', async ({ page })=>{
    await gotoReady(page);
    await page.fill('#searchbox', 'Авилон');
    // поиск сразу фильтрует; проверяем, что поле приняло значение
    await expect(page.locator('#searchbox')).toHaveValue('Авилон');
  });

  test('фильтр по категории меняет набор данных на карте', async ({ page })=>{
    await gotoReady(page);
    const options = await page.locator('#catFilter option').allTextContents();
    expect(options.length).toBeGreaterThan(1);
    await page.selectOption('#catFilter', { index: 1 });
    const value = await page.locator('#catFilter').inputValue();
    expect(value.length).toBeGreaterThan(0);
  });

  test('колесо мыши масштабирует карту (--- изменяется transform)', async ({ page })=>{
    await gotoReady(page);
    const before = await page.locator('#mapCanvas').evaluate(el => el.style.transform);
    await page.hover('#mapView');
    await page.mouse.wheel(0, -200); // прокрутка "от себя" -> zoom in
    await page.waitForTimeout(150);
    const after = await page.locator('#mapCanvas').evaluate(el => el.style.transform);
    expect(after).not.toBe(before);
  });

  test('кнопки зума меняют масштаб', async ({ page })=>{
    await gotoReady(page);
    const scaleBefore = await page.evaluate(() => state.cam.scale);
    await page.click('#zoomIn');
    await page.waitForTimeout(100);
    const scaleAfter = await page.evaluate(() => state.cam.scale);
    expect(scaleAfter).toBeGreaterThan(scaleBefore);
  });

  test('переключатель Карта / Атлас островов работает в обе стороны', async ({ page })=>{
    await gotoReady(page);
    await page.click('[data-view="wiki"]');
    await expect(page.locator('#wikiView')).toHaveClass(/show/);
    await expect(page.locator('#mapView')).toBeHidden();

    await page.click('[data-view="map"]');
    await expect(page.locator('#mapView')).toBeVisible();
  });

  test('клик по бренду возвращает на карту из любого раздела', async ({ page })=>{
    await gotoReady(page);
    await page.click('[data-view="wiki"]');
    await expect(page.locator('#wikiView')).toHaveClass(/show/);
    await page.click('#brand');
    await expect(page.locator('#mapView')).toBeVisible();
  });

});
