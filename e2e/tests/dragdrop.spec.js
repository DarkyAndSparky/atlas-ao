const { test, expect } = require('@playwright/test');
const { loginViaUI, enableEditor, gotoReady } = require('../helpers');

test.describe('Drag-and-drop в редакторе', ()=>{

  test('перетаскивание острова из лотка на карту ставит метку', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);

    const trayItem = page.locator('.tray-item').first();
    await expect(trayItem).toBeVisible();
    const trayBox = await trayItem.boundingBox();
    const mapBox = await page.locator('#mapView').boundingBox();

    await page.mouse.move(trayBox.x + 10, trayBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(mapBox.x + mapBox.width/2, mapBox.y + mapBox.height/2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    await expect(page.locator('.marker')).toHaveCount(1);
  });

  test('сортировка локаций перетаскиванием сохраняется на сервере', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);
    await page.evaluate(() => openDetail('a040'));

    for(const name of ['Локация Один', 'Локация Два']){
      page.once('dialog', dialog => dialog.accept(name));
      await page.click('#addLocBtn');
      await page.waitForTimeout(300);
    }
    await expect(page.locator('.location-block')).toHaveCount(2);

    const idsBefore = await page.locator('.location-block').evaluateAll(
      els => els.map(e => e.dataset.locId)
    );

    const handles = page.locator('.loc-drag');
    const handle0 = await handles.nth(0).boundingBox();
    const blocks = await page.locator('.location-block').evaluateAll(
      els => els.map(e => e.getBoundingClientRect().bottom)
    );

    await page.mouse.move(handle0.x + 5, handle0.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle0.x + 5, blocks[1] + 40, { steps: 12 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(500);

    const idsAfter = await page.locator('.location-block').evaluateAll(
      els => els.map(e => e.dataset.locId)
    );
    expect(idsAfter).not.toEqual(idsBefore);
    expect([...idsAfter].sort()).toEqual([...idsBefore].sort());

    const serverOrder = await page.evaluate(async () => {
      const r = await fetch('/api/allods/a040');
      const d = await r.json();
      return d.locations.map(l => l.id);
    });
    expect(serverOrder).toEqual(idsAfter);
  });

  test('мини-карта локаций: перетаскивание метки на изображение карты', async ({ page })=>{
    await page.setViewportSize({ width: 1280, height: 2000 });
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);

    await page.evaluate(async () => {
      await fetch('/api/allods/a041', {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ hasMap: true, location_map_url: '/assets/map-bg.svg' })
      });
      await fetch('/api/allods/a041/locations', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name: 'Локация для мини-карты' })
      });
    });
    await page.reload(); // подтягиваем свежий state.data с сервера после ручного patch выше
    await page.waitForFunction(() => typeof state !== 'undefined' && state.data && state.data.length > 0);
    await enableEditor(page); // editorOn — чисто клиентское состояние, после reload сбрасывается
    await page.evaluate(() => openDetail('a041'));
    await page.waitForTimeout(400);

    const chip = page.locator('.locmap-chip').first();
    await chip.scrollIntoViewIfNeeded();
    await expect(chip).toBeVisible();
    const chipBox = await chip.boundingBox();
    const img = page.locator('#locmapImg');
    await img.scrollIntoViewIfNeeded();
    const imgBox = await img.boundingBox();

    await page.mouse.move(chipBox.x + 5, chipBox.y + 5);
    await page.mouse.down();
    await page.mouse.move(imgBox.x + imgBox.width*0.5, imgBox.y + imgBox.height*0.5, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    await expect(page.locator('.locmap-marker')).toHaveCount(1);
  });

});
