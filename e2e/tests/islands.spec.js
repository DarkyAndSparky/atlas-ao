const { test, expect } = require('@playwright/test');
const { loginViaUI, enableEditor, gotoReady } = require('../helpers');

test.describe('Создание и удаление острова', ()=>{

  test('без входа кнопки создания/удаления не видны', async ({ page })=>{
    await gotoReady(page);
    await expect(page.locator('#addAllodBtn')).toBeHidden(); // сам #tray скрыт вне режима редактора
    await page.evaluate(() => openDetail('a025'));
    await expect(page.locator('#delAllodBtn')).toBeHidden();
  });

  test('создание нового острова из лотка неразмещённых', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);

    const before = await page.evaluate(() => state.data.length);

    page.once('dialog', dialog => dialog.accept('E2E Новый остров'));
    await page.click('#addAllodBtn');
    await page.waitForTimeout(500);

    // после создания сразу открывается страница нового острова
    await expect(page.locator('#detailView')).toHaveClass(/show/);
    await expect(page.locator('.detail-hero h1')).toContainText('E2E Новый остров');

    const after = await page.evaluate(() => state.data.length);
    expect(after).toBe(before + 1);

    // остров создаётся без координат — значит, попадает в неразмещённые
    const created = await page.evaluate(() => state.data.find(a => a.name === 'E2E Новый остров'));
    expect(created.mapX).toBeNull();
    expect(created.locations).toEqual([]);

    // видно предупреждение «не на карте» на его собственной странице
    await expect(page.locator('.tag-unplaced')).toBeVisible();
  });

  test('созданный остров появляется в списке лотка неразмещённых', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);

    page.once('dialog', dialog => dialog.accept('E2E Остров В Лотке'));
    await page.click('#addAllodBtn');
    await page.waitForTimeout(500);

    await page.evaluate(() => showMap());
    await page.waitForTimeout(200);
    await expect(page.locator('#trayList')).toContainText('E2E Остров В Лотке');
  });

  test('удаление острова убирает его отовсюду и возвращает на карту', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);

    page.once('dialog', dialog => dialog.accept('E2E Остров На Удаление'));
    await page.click('#addAllodBtn');
    await page.waitForTimeout(500);

    const id = await page.evaluate(() => state.currentId);
    expect(id).toBeTruthy();

    page.once('dialog', dialog => dialog.accept()); // подтверждение удаления
    await page.click('#delAllodBtn');
    await page.waitForTimeout(500);

    // вернулись на карту
    await expect(page.locator('#mapView')).toBeVisible();

    // острова больше нет ни в состоянии на клиенте, ни на сервере
    const stillInState = await page.evaluate((id) => state.data.some(a => a.id === id), id);
    expect(stillInState).toBe(false);

    const serverCheck = await page.evaluate(async (id) => (await fetch('/api/allods/'+id)).status, id);
    expect(serverCheck).toBe(404);
  });

  test('удалённый остров пропадает из лотка неразмещённых', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);

    page.once('dialog', dialog => dialog.accept('E2E Остров Исчезнет Из Лотка'));
    await page.click('#addAllodBtn');
    await page.waitForTimeout(500);

    page.once('dialog', dialog => dialog.accept());
    await page.click('#delAllodBtn');
    await page.waitForTimeout(500);

    await expect(page.locator('#trayList')).not.toContainText('E2E Остров Исчезнет Из Лотка');
  });

});

test.describe('Клик по тегу возвращает туда, откуда пришли', ()=>{

  test('с карты — фильтрует и остаётся на карте', async ({ page })=>{
    await gotoReady(page);
    const { id, field, value } = await page.evaluate(() => {
      const item = state.data.find(a => a.faction);
      return { id: item.id, field: 'faction', value: item.faction };
    });
    await page.evaluate((id) => openDetail(id), id);
    await page.click(`.tag.clickable[data-field="${field}"]`);
    await page.waitForTimeout(200);

    await expect(page.locator('#mapView')).toBeVisible();
    const activeFilter = await page.evaluate(() => state.filters.faction);
    expect(activeFilter).toBe(value);
  });

  test('из вики — фильтрует и остаётся в вики', async ({ page })=>{
    await gotoReady(page);
    await page.click('[data-view="wiki"]');
    const link = page.locator('.wiki-island-link').first();
    await link.click();
    await expect(page.locator('#detailView')).toHaveClass(/show/);

    const field = await page.evaluate(() => {
      const el = document.querySelector('.tag.clickable[data-field]');
      return el ? el.dataset.field : null;
    });
    test.skip(!field, 'у первого острова из вики нет ни одного тега — редкий случай для сид-данных');

    await page.click(`.tag.clickable[data-field="${field}"]`);
    await page.waitForTimeout(200);

    await expect(page.locator('#wikiView')).toHaveClass(/show/);
    await expect(page.locator('#mapView')).toBeHidden();
  });

});
