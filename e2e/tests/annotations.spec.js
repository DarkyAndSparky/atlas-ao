const { test, expect } = require('@playwright/test');
const { gotoReady, loginAndEnableEditor } = require('../helpers');

test.describe('Векторный слой рисования на карте', ()=>{

  test('без входа панель инструментов не видна', async ({ page })=>{
    await gotoReady(page);
    await expect(page.locator('#drawToolbar')).toBeHidden();
  });

  test('в режиме редактора панель инструментов появляется', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await expect(page.locator('#drawToolbar')).toBeVisible();
  });

  test('текстовая подпись: создаётся как SVG-текст и остаётся после перезагрузки страницы', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);

    page.once('dialog', dialog => dialog.accept('E2E Подпись На Карте'));
    await page.click('.draw-tool[data-tool="text"]');
    await page.click('#mapCanvas', { position: { x: 400, y: 300 } });
    await page.waitForTimeout(400);

    const text = page.locator('#annotLayer text', { hasText: 'E2E Подпись На Карте' });
    await expect(text).toHaveCount(1);
    // это настоящий SVG-элемент, а не растровая картинка/canvas-пиксели
    const tagName = await text.evaluate(el => el.tagName.toLowerCase());
    expect(tagName).toBe('text');

    await page.reload();
    await page.waitForFunction(() => Array.isArray(state.annotations) && state.annotations.length > 0);
    await expect(page.locator('#annotLayer text', { hasText: 'E2E Подпись На Карте' })).toHaveCount(1);
  });

  test('линия рисуется перетаскиванием и сохраняется на сервере', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);

    const before = await page.evaluate(() => state.annotations.length);

    await page.click('.draw-tool[data-tool="line"]');
    const canvas = page.locator('#mapCanvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 220, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => state.annotations.length);
    expect(after).toBe(before + 1);
    await expect(page.locator('#annotLayer line')).toHaveCount(1);
  });

  test('слишком короткое перетаскивание (случайный клик) не создаёт линию', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);

    const before = await page.evaluate(() => state.annotations.length);
    await page.click('.draw-tool[data-tool="line"]');
    const canvas = page.locator('#mapCanvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.up(); // отпустили сразу же, без перетаскивания
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => state.annotations.length);
    expect(after).toBe(before);
  });

  test('прямоугольник и круг рисуются перетаскиванием', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    const canvas = page.locator('#mapCanvas');
    const box = await canvas.boundingBox();

    await page.click('.draw-tool[data-tool="rect"]');
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 120, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(page.locator('#annotLayer rect')).toHaveCount(1);

    await page.click('.draw-tool[data-tool="circle"]');
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 340, box.y + 300, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(page.locator('#annotLayer circle')).toHaveCount(1);
  });

  test('инструмент "стереть" удаляет пометку по клику', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);

    page.once('dialog', dialog => dialog.accept('E2E Подпись На Удаление'));
    await page.click('.draw-tool[data-tool="text"]');
    await page.click('#mapCanvas', { position: { x: 500, y: 400 } });
    await page.waitForTimeout(300);
    const target = page.locator('#annotLayer text', { hasText: 'E2E Подпись На Удаление' });
    await expect(target).toHaveCount(1);

    await page.click('.draw-tool[data-tool="erase"]');
    page.once('dialog', dialog => dialog.accept());
    await target.click();
    await page.waitForTimeout(300);

    await expect(page.locator('#annotLayer text', { hasText: 'E2E Подпись На Удаление' })).toHaveCount(0);
  });

  test('повторный клик по тому же инструменту выключает его', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    const tool = page.locator('.draw-tool[data-tool="rect"]');
    await tool.click();
    await expect(tool).toHaveClass(/active/);
    await tool.click();
    await expect(tool).not.toHaveClass(/active/);
  });

  test('выход из режима редактора выключает активный инструмент рисования', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await page.click('.draw-tool[data-tool="rect"]');
    await expect(page.locator('.draw-tool[data-tool="rect"]')).toHaveClass(/active/);

    await page.click('#editorToggle'); // выключаем редактор
    const drawTool = await page.evaluate(() => state.drawTool);
    expect(drawTool).toBeNull();
  });

  test('инструмент "украшение": открывается пикер со стартовым набором картинок', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await expect(page.locator('#decoPicker')).toHaveClass(/hidden/);

    await page.click('.draw-tool[data-tool="icon"]');
    await expect(page.locator('#decoPicker')).not.toHaveClass(/hidden/);
    // стартовый набор — 10 картинок (астрал/турель/обломки/аномалии и т.д.), не хардкод в JS, а из БД
    await expect(page.locator('.deco-picker-item')).toHaveCount(10);
  });

  test('размещение украшения на карте кликом после выбора картинки', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    const before = await page.evaluate(() => state.annotations.length);

    await page.click('.draw-tool[data-tool="icon"]');
    await page.click('.deco-picker-item >> nth=0');
    await expect(page.locator('.deco-picker-item >> nth=0')).toHaveClass(/active/);

    await page.click('#mapCanvas', { position: { x: 350, y: 250 } });
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => state.annotations.length);
    expect(after).toBe(before + 1);
    await expect(page.locator('#annotLayer image.annot-icon')).toHaveCount(1);
  });

  test('без выбранной картинки клик по карте инструментом "украшение" ничего не создаёт', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    const before = await page.evaluate(() => state.annotations.length);

    await page.click('.draw-tool[data-tool="icon"]');
    // картинку не выбираем — сразу кликаем по карте
    await page.click('#mapCanvas', { position: { x: 600, y: 450 } });
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => state.annotations.length);
    expect(after).toBe(before);
  });

  test('инструмент "стереть" удаляет и размещённое украшение', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);

    await page.click('.draw-tool[data-tool="icon"]');
    await page.click('.deco-picker-item >> nth=0');
    await page.click('#mapCanvas', { position: { x: 700, y: 500 } });
    await page.waitForTimeout(300);
    await expect(page.locator('#annotLayer image.annot-icon')).toHaveCount(1);

    await page.click('.draw-tool[data-tool="erase"]');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#annotLayer image.annot-icon').click();
    await page.waitForTimeout(300);

    await expect(page.locator('#annotLayer image.annot-icon')).toHaveCount(0);
  });

});
