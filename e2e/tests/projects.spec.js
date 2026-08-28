const { test, expect } = require('@playwright/test');
const { gotoReady } = require('../helpers');

test.describe('Переключатель проектов', ()=>{

  test('показывает 4 вкладки-логотипа, одна активна по умолчанию', async ({ page })=>{
    await gotoReady(page);
    const tabs = page.locator('.project-tab');
    await expect(tabs).toHaveCount(4);
    await expect(page.locator('.project-tab.active')).toHaveCount(1);
  });

  test('переключение проекта меняет активную вкладку и обновляет данные', async ({ page })=>{
    await gotoReady(page);
    const initialProject = await page.evaluate(() => state.project);

    const otherTab = page.locator('.project-tab:not(.active)').first();
    const otherProjectId = await otherTab.getAttribute('data-project');
    await otherTab.click();
    await page.waitForTimeout(200);

    const newProject = await page.evaluate(() => state.project);
    expect(newProject).not.toBe(initialProject);
    expect(newProject).toBe(otherProjectId);
    // переключатель полностью перерисовывается после клика — ищем активную вкладку заново
    await expect(page.locator(`.project-tab[data-project="${otherProjectId}"]`)).toHaveClass(/active/);
  });

  test('переключение проекта прямо на странице вики остаётся в вики и обновляет список (регрессия)', async ({ page })=>{
    await gotoReady(page);
    await page.click('#wikiDropdownBtn'); // 4 раздела вики теперь в выпадающем меню (см. UX-аудит)
    await page.click('[data-view="wiki"]');
    await expect(page.locator('#wikiView')).toHaveClass(/show/);
    const totalDefault = await page.locator('.wiki-island-link').count();

    // переключаем проект БЕЗ захода на карту — раньше showMap() внутри
    // обработчика клика по вкладке безусловно перекидывал на карту, а
    // проверка "остались ли в вики" технически была мёртвым кодом ниже
    // (state.view уже стало 'map' к моменту проверки)
    const otherTab = page.locator('.project-tab:not(.active)').first();
    await otherTab.click();
    await page.waitForTimeout(200);

    await expect(page.locator('#wikiView')).toHaveClass(/show/, { timeout: 3000 });
    await expect(page.locator('#mapView')).toBeHidden();

    const totalOther = await page.locator('.wiki-island-link').count();
    expect(totalOther).not.toBe(totalDefault);
  });

  test('переключение проекта со страницы карты остаётся на карте', async ({ page })=>{
    await gotoReady(page);
    const otherTab = page.locator('.project-tab:not(.active)').first();
    await otherTab.click();
    await page.waitForTimeout(200);
    await expect(page.locator('#mapView')).toBeVisible();
    await expect(page.locator('#wikiView')).toBeHidden();
  });

});
