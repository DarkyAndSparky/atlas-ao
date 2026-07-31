const { test, expect } = require('@playwright/test');
const { gotoReady } = require('../helpers');

test.describe('Копирайты и дисклеймер', ()=>{

  test('футер с дисклеймером виден на карте, острове и в вики', async ({ page })=>{
    await gotoReady(page);
    await expect(page.locator('#legalFooter')).toBeVisible();
    await expect(page.locator('.legal-copy')).toContainText('ASTRUM LAB LLC');

    await page.evaluate(() => openDetail('a030'));
    await expect(page.locator('#legalFooter')).toBeVisible();

    await page.click('#brand');
    await page.click('[data-view="wiki"]');
    await expect(page.locator('#legalFooter')).toBeVisible();
  });

  test('окно "О системе" содержит полный дисклеймер и копирайт', async ({ page })=>{
    await gotoReady(page);
    await page.click('#aboutBtn');
    await expect(page.locator('#aboutOverlay')).toBeVisible();
    await expect(page.locator('.about-legal')).toContainText('неофициальный');
    await expect(page.locator('.about-legal')).toContainText('ASTRUM ENTERTAINMENT');
    await expect(page.locator('.about-copyright')).toContainText('© 2026 ASTRUM LAB LLC');
  });

});
