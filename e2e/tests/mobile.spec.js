const { test, expect } = require('@playwright/test');
const { gotoReady } = require('../helpers');

test.describe('Мобильная версия', ()=>{

  test.skip(({ isMobile }) => !isMobile, 'только для мобильного профиля');

  test('шапка переносится на несколько строк, поиск и фильтры не спрятаны', async ({ page })=>{
    await gotoReady(page);
    await expect(page.locator('#searchbox')).toBeVisible();
    await expect(page.locator('.filters')).toBeVisible();
    const topbarHeight = await page.locator('#topbar').evaluate(el => el.offsetHeight);
    expect(topbarHeight).toBeGreaterThan(60); // шапка выше однострочной — значит перенеслась
  });

  test('CSS-переменная высоты шапки совпадает с реальной высотой', async ({ page })=>{
    await gotoReady(page);
    await page.waitForTimeout(200);
    const topbarHeight = await page.locator('#topbar').evaluate(el => el.offsetHeight);
    const cssVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'));
    expect(cssVar.trim()).toBe(topbarHeight + 'px');
  });

  test('один палец панорамирует карту', async ({ page })=>{
    await gotoReady(page);
    await page.waitForTimeout(300);
    const camBefore = await page.evaluate(() => JSON.stringify(state.cam));

    const box = await page.locator('#mapView').boundingBox();
    const cx = box.x + box.width/2, cy = box.y + box.height/2;
    await page.touchscreen.tap(cx, cy); // прогрев
    await page.evaluate(({cx, cy}) => {
      const el = document.getElementById('mapView');
      const mk = (type,x,y) => new TouchEvent(type, {
        touches: type==='touchend' ? [] : [new Touch({identifier:1, target: el, clientX:x, clientY:y})],
        changedTouches: [new Touch({identifier:1, target: el, clientX:x, clientY:y})],
        bubbles: true, cancelable: true
      });
      el.dispatchEvent(mk('touchstart', cx, cy));
      el.dispatchEvent(mk('touchmove', cx+80, cy+40));
      el.dispatchEvent(mk('touchend', cx+80, cy+40));
    }, {cx, cy});
    await page.waitForTimeout(200);

    const camAfter = await page.evaluate(() => JSON.stringify(state.cam));
    expect(camAfter).not.toBe(camBefore);
  });

  test('два пальца (pinch) масштабируют карту', async ({ page })=>{
    await gotoReady(page);
    await page.waitForTimeout(300);
    const scaleBefore = await page.evaluate(() => state.cam.scale);

    await page.evaluate(() => {
      const el = document.getElementById('mapView');
      const mk = (type, pts) => new TouchEvent(type, {
        touches: type==='touchend' ? [] : pts.map((p,i)=>new Touch({identifier:i, target: el, clientX:p[0], clientY:p[1]})),
        changedTouches: pts.map((p,i)=>new Touch({identifier:i, target: el, clientX:p[0], clientY:p[1]})),
        bubbles: true, cancelable: true
      });
      el.dispatchEvent(mk('touchstart', [[150,400],[250,400]]));
      el.dispatchEvent(mk('touchmove', [[100,400],[300,400]]));
      el.dispatchEvent(mk('touchend', [[100,400],[300,400]]));
    });
    await page.waitForTimeout(200);

    const scaleAfter = await page.evaluate(() => state.cam.scale);
    expect(scaleAfter).toBeGreaterThan(scaleBefore);
  });

  test('легальный футер помещается внизу и не перекрывает элементы управления зумом', async ({ page })=>{
    await gotoReady(page);
    const footerBox = await page.locator('#legalFooter').boundingBox();
    const zoomBox = await page.locator('#zoomCtrl').boundingBox();
    expect(zoomBox.y + zoomBox.height).toBeLessThanOrEqual(footerBox.y + 2);
  });

});
