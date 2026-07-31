const { test, expect } = require('@playwright/test');
const { gotoReady, loginViaUI } = require('../helpers');

test.describe('Атлас островов (вики)', ()=>{

  test('показывает группы по фракциям и общее число островов', async ({ page })=>{
    await gotoReady(page);
    await page.click('[data-view="wiki"]');
    await expect(page.locator('#wikiView')).toHaveClass(/show/);

    const groups = await page.locator('.wiki-faction-title').allTextContents();
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.join(' ')).toMatch(/Империя|Лига|Нейтральные|Эльфийские|Другие/);

    const links = page.locator('.wiki-island-link');
    await expect(links.first()).toBeVisible();
    const count = await links.count();
    expect(count).toBeGreaterThan(100); // 318 островов в проекте по умолчанию
  });

  test('клик по острову из вики открывает его страницу', async ({ page })=>{
    await gotoReady(page);
    await page.click('[data-view="wiki"]');
    const firstLink = page.locator('.wiki-island-link').first();
    const rawName = await firstLink.textContent();
    const name = rawName.replace('●','').trim();
    await firstLink.click();
    await expect(page.locator('#detailView')).toHaveClass(/show/);
    await expect(page.locator('.detail-hero h1')).toHaveText(name);
  });

  test('внутри каждой группы острова разбиты по размеру', async ({ page })=>{
    await gotoReady(page);
    await page.click('[data-view="wiki"]');
    const sizeTitles = await page.locator('.wiki-size-title').allTextContents();
    expect(sizeTitles.length).toBeGreaterThan(0);
  });

  test('остров с нестандартным значением size не пропадает из списка (регрессия)', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);

    // создаём остров и выставляем size в значение, которого нет среди
    // стандартных 4 категорий — раньше такой остров молча пропадал бы
    // из вики целиком, хотя оставался бы на карте и в общем счётчике
    const islandName = 'E2E Остров Странного Размера';
    await page.evaluate(async (name) => {
      const created = await (await fetch('/api/allods', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name }),
      })).json();
      await fetch(`/api/allods/${created.id}`, {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ size: 'Совершенно новая категория размера' }),
      });
    }, islandName);

    await page.click('[data-view="wiki"]');
    await expect(page.locator('#wikiView')).toHaveClass(/show/);
    await expect(page.locator('.wiki-island-list')).toContainText(islandName);
    await expect(page.locator('.wiki-size-title', { hasText: 'Другой размер' })).toBeVisible();
  });

  test('включение режима редактора на странице вики не перекидывает на карту (регрессия)', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await page.click('[data-view="wiki"]');
    await expect(page.locator('#wikiView')).toHaveClass(/show/);

    await page.click('#editorToggle');
    await expect(page.locator('#editorToggle')).toHaveClass(/on/);

    // раньше здесь безусловно вызывался renderDetail(), который при отсутствии
    // открытого острова (currentId===null) откатывал на карту — пользователя
    // молча выкидывало из вики
    await expect(page.locator('#wikiView')).toHaveClass(/show/);
    await expect(page.locator('#mapView')).toBeHidden();
  });

});
