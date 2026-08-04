const { test, expect } = require('@playwright/test');
const { loginViaUI, enableEditor, gotoReady } = require('../helpers');

test.describe('Страница острова', ()=>{

  test('открывается по id, показывает название и сведения', async ({ page })=>{
    await gotoReady(page);
    await page.evaluate(() => openDetail('a020'));
    await expect(page.locator('#detailView')).toHaveClass(/show/);
    await expect(page.locator('.detail-hero h1')).not.toBeEmpty();
  });

  test('хлебная крошка "Атлас" возвращает на карту', async ({ page })=>{
    await gotoReady(page);
    await page.evaluate(() => openDetail('a020'));
    await page.click('.breadcrumb >> text=Атлас');
    await expect(page.locator('#mapView')).toBeVisible();
  });

  test('редактирование описания сохраняется и показывает undo-тост', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);
    await page.evaluate(() => openDetail('a021'));

    const desc = page.locator('[data-field="description"]');
    await desc.click();
    await desc.fill('E2E тестовое описание острова');
    await page.locator('[data-field="history"]').click(); // blur через клик на другое поле
    await page.waitForTimeout(400);

    await expect(page.locator('#toast')).toHaveClass(/show/);
    await expect(page.locator('#toastUndo')).toBeVisible();

    // сохранилось по-настоящему
    const saved = await page.evaluate(async () => {
      const r = await fetch('/api/allods/a021');
      return (await r.json()).description;
    });
    expect(saved).toBe('E2E тестовое описание острова');
  });

  test('кнопка Отменить в тосте откатывает правку', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);
    await page.evaluate(() => openDetail('a022'));

    const desc = page.locator('[data-field="description"]');
    await desc.click();
    await desc.fill('Текст, который должен быть отменён');
    await page.locator('[data-field="history"]').click();
    await page.waitForTimeout(400);

    await page.click('#toastUndo');
    await page.waitForTimeout(400);

    const saved = await page.evaluate(async () => {
      const r = await fetch('/api/allods/a022');
      return (await r.json()).description;
    });
    expect(saved).not.toBe('Текст, который должен быть отменён');
  });

  test('добавление и удаление локации', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);
    await page.evaluate(() => openDetail('a023'));

    page.once('dialog', dialog => dialog.accept('E2E Локация'));
    await page.click('#addLocBtn');
    await page.waitForTimeout(400);
    await expect(page.locator('.location-block')).toHaveCount(1);
    await expect(page.locator('.loc-name')).toContainText('E2E Локация');

    page.once('dialog', dialog => dialog.accept());
    await page.click('.location-block .del');
    await page.waitForTimeout(400);
    await expect(page.locator('.location-block')).toHaveCount(0);
  });

  test('галерея: добавление по ссылке и открытие лайтбокса', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);
    await page.evaluate(() => openDetail('a024'));

    page.once('dialog', dialog => {
      dialog.dismiss(); // "файл или ссылка" -> Отмена = вставить ссылку
      page.once('dialog', dialog2 => dialog2.accept('https://picsum.photos/seed/e2e/400/300'));
    });
    await page.click('.gallery-add');
    await page.waitForTimeout(500);
    await expect(page.locator('#galleryWrap .gallery-item')).toHaveCount(1);

    await page.click('#galleryWrap .gallery-item img');
    await expect(page.locator('#lightbox')).toHaveClass(/show/);
    await page.click('#lbClose');
    await expect(page.locator('#lightbox')).not.toHaveClass(/show/);
  });

  test('пустые поля скрываются в сайдбаре, а не показывают прочерк', async ({ page })=>{
    await gotoReady(page);
    await page.evaluate(() => openDetail('a025'));
    const factsText = await page.locator('.sidebar-fact').allTextContents();
    for(const t of factsText){
      expect(t).not.toContain('—');
    }
  });

  test('фракцию/категорию/климат/размер можно редактировать (раньше — нельзя было вообще)', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);
    await page.evaluate(() => openDetail('a025'));

    // вписываем совершенно новое значение категории через prompt()
    page.once('dialog', dialog => dialog.accept('Испытательный полигон E2E'));
    await page.click('[data-action="edit-tag"][data-field="category"]');
    await page.waitForTimeout(400);

    await expect(page.locator('.tag[data-action="edit-tag"][data-field="category"]')).toContainText('Испытательный полигон E2E');

    // значение реально сохранилось на сервере, не только в DOM
    const saved = await page.evaluate(async () => {
      const r = await fetch('/api/allods/a025');
      return (await r.json()).category;
    });
    expect(saved).toBe('Испытательный полигон E2E');
  });

  test('пустое поле фракции показывает призрачную кнопку "+ фракцию" в редакторе', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);

    // остров без фракции (создаём заведомо пустой, чтобы не зависеть от сид-данных)
    const id = await page.evaluate(async () => {
      const created = await (await fetch('/api/allods', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name: 'E2E Остров Без Фракции' }),
      })).json();
      return created.id;
    });
    await page.evaluate((id) => openDetail(id), id);

    const ghost = page.locator('.tag-add-ghost[data-field="faction"]');
    await expect(ghost).toBeVisible();
    await expect(ghost).toContainText('фракцию');
  });

  test('иконка фракции показывается рядом с тегом, если для неё есть иконка в библиотеке', async ({ page })=>{
    await gotoReady(page);
    await loginViaUI(page);
    await enableEditor(page);

    const id = await page.evaluate(async () => {
      const created = await (await fetch('/api/allods', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name: 'E2E Остров Гиберлингов' }),
      })).json();
      await fetch(`/api/allods/${created.id}`, {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ faction: 'гиберлинги' }), // другой регистр — иконка всё равно должна найтись
      });
      return created.id;
    });
    await page.evaluate((id) => openDetail(id), id);

    await expect(page.locator('.tag[data-field="faction"] .tag-faction-icon')).toHaveCount(1);
  });

});
