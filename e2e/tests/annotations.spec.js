const { test, expect } = require('@playwright/test');
const { gotoReady, loginAndEnableEditor, useIsolatedDrawingProject } = require('../helpers');

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
    const project = await useIsolatedDrawingProject(page);

    page.once('dialog', dialog => dialog.accept('E2E Подпись На Карте'));
    await page.click('.draw-tool[data-tool="text"]');
    await page.click('#mapCanvas', { position: { x: 400, y: 300 } });

    const text = page.locator('#annotLayer text', { hasText: 'E2E Подпись На Карте' });
    await expect(text).toHaveCount(1);
    const tagName = await text.evaluate(el => el.tagName.toLowerCase());
    expect(tagName).toBe('text');

    await page.reload();
    await page.evaluate((project) => { state.project = project; }, project);
    await page.waitForFunction(() => typeof state !== 'undefined' && Array.isArray(state.data) && state.data.length > 0);
    await page.evaluate(async () => { await loadAnnotations(); });
    await expect(page.locator('#annotLayer text', { hasText: 'E2E Подпись На Карте' })).toHaveCount(1);
  });

  test('линия рисуется перетаскиванием и сохраняется на сервере', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await useIsolatedDrawingProject(page);

    await page.click('.draw-tool[data-tool="line"]');
    const canvas = page.locator('#mapCanvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 160, { steps: 8 });
    await page.mouse.move(box.x + 250, box.y + 220, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator('#annotLayer line')).toHaveCount(1, { timeout: 5000 });
    await expect.poll(() => page.evaluate(() => state.annotations.length)).toBe(1);
  });

  test('слишком короткое перетаскивание (случайный клик) не создаёт линию', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await useIsolatedDrawingProject(page);

    await page.click('.draw-tool[data-tool="line"]');
    const canvas = page.locator('#mapCanvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);

    await expect(page.locator('#annotLayer line')).toHaveCount(0);
    const after = await page.evaluate(() => state.annotations.length);
    expect(after).toBe(0);
  });

  test('стрелка: наконечник указывает на конечную точку, а не улетает за неё', async ({ page })=>{
    // Регрессия: раньше половинный угол раствора наконечника считался от
    // "прямого" направления линии почти развёрнутым (~147.6°), из-за чего
    // оба крыла треугольника оказывались геометрически ВПЕРЕДИ конечной
    // точки — наконечник визуально "убегал" за пределы стрелки вместо
    // того, чтобы указывать на неё (см. annotations.js, arrowHeadPoints).
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await useIsolatedDrawingProject(page);

    await page.click('.draw-tool[data-tool="arrow"]');
    const canvas = page.locator('#mapCanvas');
    const box = await canvas.boundingBox();
    const start = { x: box.x + 100, y: box.y + 220 };
    const end = { x: box.x + 300, y: box.y + 100 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x - 50, end.y + 40, { steps: 8 });
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();

    const arrowGroup = page.locator('#annotLayer g.annot-el');
    await expect(arrowGroup).toHaveCount(1, { timeout: 5000 });

    const geom = await arrowGroup.evaluate(g => {
      const line = g.querySelector('line');
      const head = g.querySelector('polygon');
      const [tipStr, ...wingStrs] = head.getAttribute('points').trim().split(/\s+/);
      const [tipX, tipY] = tipStr.split(',').map(Number);
      const wings = wingStrs.map(s => s.split(',').map(Number));
      return {
        x1: Number(line.getAttribute('x1')), y1: Number(line.getAttribute('y1')),
        x2: Number(line.getAttribute('x2')), y2: Number(line.getAttribute('y2')),
        tipX, tipY, wings,
      };
    });

    // остриё наконечника должно совпадать с концом линии (куда отпустили мышь)
    expect(Math.abs(geom.tipX - geom.x2)).toBeLessThan(1);
    expect(Math.abs(geom.tipY - geom.y2)).toBeLessThan(1);

    // оба "крыла" треугольника должны лежать БЛИЖЕ к началу линии, чем
    // остриё — то есть проекция крыла на направление линии должна быть
    // МЕНЬШЕ проекции острия. Если крыло уходит вперёд (как в баге),
    // проекция окажется больше проекции острия.
    const dirX = geom.x2 - geom.x1, dirY = geom.y2 - geom.y1;
    const dirLen = Math.hypot(dirX, dirY);
    const proj = (px, py) => ((px - geom.x1) * dirX + (py - geom.y1) * dirY) / dirLen;
    const tipProj = proj(geom.tipX, geom.tipY);
    for (const [wx, wy] of geom.wings) {
      expect(proj(wx, wy)).toBeLessThan(tipProj);
    }
  });

  test('прямоугольник и круг рисуются перетаскиванием', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await useIsolatedDrawingProject(page);
    const canvas = page.locator('#mapCanvas');
    const box = await canvas.boundingBox();

    await page.click('.draw-tool[data-tool="rect"]');
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 85, { steps: 8 });
    await page.mouse.move(box.x + 150, box.y + 120, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('#annotLayer rect')).toHaveCount(1, { timeout: 5000 });

    await page.click('.draw-tool[data-tool="circle"]');
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 300, { steps: 8 });
    await page.mouse.move(box.x + 340, box.y + 300, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('#annotLayer circle')).toHaveCount(1, { timeout: 5000 });
  });

  test('инструмент "стереть" удаляет пометку по клику', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await useIsolatedDrawingProject(page);

    page.once('dialog', dialog => dialog.accept('E2E Подпись На Удаление'));
    await page.click('.draw-tool[data-tool="text"]');
    await page.click('#mapCanvas', { position: { x: 500, y: 400 } });
    const target = page.locator('#annotLayer text', { hasText: 'E2E Подпись На Удаление' });
    await expect(target).toHaveCount(1);

    await page.click('.draw-tool[data-tool="erase"]');
    page.once('dialog', dialog => dialog.accept());
    await target.click();

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

    await page.click('#editorToggle');
    const drawTool = await page.evaluate(() => state.drawTool);
    expect(drawTool).toBeNull();
  });

  test('инструмент "украшение": открывается пикер со стартовым набором картинок', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await expect(page.locator('#decoPicker')).toHaveClass(/hidden/);

    await page.click('.draw-tool[data-tool="icon"]');
    await expect(page.locator('#decoPicker')).not.toHaveClass(/hidden/);
    await expect(page.locator('.deco-picker-item')).toHaveCount(10);
  });

  test('размещение украшения на карте кликом после выбора картинки', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await useIsolatedDrawingProject(page);

    await page.click('.draw-tool[data-tool="icon"]');
    await page.click('.deco-picker-item >> nth=0');
    await expect(page.locator('.deco-picker-item >> nth=0')).toHaveClass(/active/);

    await page.click('#mapCanvas', { position: { x: 350, y: 250 } });

    await expect(page.locator('#annotLayer image.annot-icon')).toHaveCount(1, { timeout: 5000 });
    await expect.poll(() => page.evaluate(() => state.annotations.length)).toBe(1);
  });

  test('без выбранной картинки клик по карте инструментом "украшение" ничего не создаёт', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await useIsolatedDrawingProject(page);

    await page.click('.draw-tool[data-tool="icon"]');
    await page.click('#mapCanvas', { position: { x: 600, y: 450 } });
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => state.annotations.length);
    expect(after).toBe(0);
  });

  test('инструмент "стереть" удаляет и размещённое украшение', async ({ page })=>{
    await gotoReady(page);
    await loginAndEnableEditor(page);
    await useIsolatedDrawingProject(page);

    await page.click('.draw-tool[data-tool="icon"]');
    await page.click('.deco-picker-item >> nth=0');
    await page.click('#mapCanvas', { position: { x: 700, y: 500 } });
    await expect(page.locator('#annotLayer image.annot-icon')).toHaveCount(1, { timeout: 5000 });

    await page.click('.draw-tool[data-tool="erase"]');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#annotLayer image.annot-icon').click();

    await expect(page.locator('#annotLayer image.annot-icon')).toHaveCount(0);
  });

});
