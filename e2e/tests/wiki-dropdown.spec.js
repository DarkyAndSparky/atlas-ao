const { test, expect } = require('@playwright/test');
const { gotoReady } = require('../helpers');

test.describe('Выпадающее меню "Вики" (топбар)', ()=>{

  test('меню закрыто по умолчанию, открывается по клику на триггер', async ({ page })=>{
    await gotoReady(page);
    await expect(page.locator('#wikiDropdown')).not.toHaveClass(/open/);
    await page.click('#wikiDropdownBtn');
    await expect(page.locator('#wikiDropdown')).toHaveClass(/open/);
    await expect(page.locator('[data-view="sources"]')).toBeVisible();
  });

  test('клик по разделу переходит на него и закрывает меню', async ({ page })=>{
    await gotoReady(page);
    await page.click('#wikiDropdownBtn');
    await page.click('[data-view="sources"]');
    await expect(page.locator('#sourcesView')).toHaveClass(/show/);
    await expect(page.locator('#wikiDropdown')).not.toHaveClass(/open/);
  });

  test('клик снаружи закрывает меню без перехода', async ({ page })=>{
    await gotoReady(page);
    await page.click('#wikiDropdownBtn');
    await expect(page.locator('#wikiDropdown')).toHaveClass(/open/);
    await page.click('#mapView', { position: { x: 50, y: 50 } });
    await expect(page.locator('#wikiDropdown')).not.toHaveClass(/open/);
    // остались на карте — клик снаружи не считается выбором раздела
    await expect(page.locator('.view-toggle-btn[data-view="map"]')).toHaveClass(/active/);
  });

  test('Escape закрывает меню', async ({ page })=>{
    await gotoReady(page);
    await page.click('#wikiDropdownBtn');
    await expect(page.locator('#wikiDropdown')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#wikiDropdown')).not.toHaveClass(/open/);
  });

  test('открытие раздела из меню верно выставляет active на сам пункт меню, а не на "Карта"', async ({ page })=>{
    await gotoReady(page);
    await page.click('#wikiDropdownBtn');
    await page.click('[data-view="timeline"]');
    await expect(page.locator('[data-view="timeline"]')).toHaveClass(/active/);
    await expect(page.locator('.view-toggle-btn[data-view="map"]')).not.toHaveClass(/active/);
  });

});
