# UI/e2e тесты Атласа Аллодов

Отдельный пакет (не тянется при обычной установке сервера), использует Playwright.
Поднимает настоящий сервер на изолированной тестовой базе и гоняет браузер против него.

## Установка (один раз)

```bash
cd e2e
npm install
npm run install-browsers   # скачивает Chromium для Playwright
```

## Запуск

```bash
npm test              # весь набор, оба профиля (desktop + мобильный)
npm run test:headed   # то же самое, но с видимым окном браузера — удобно смотреть глазами
```

Можно гонять отдельные файлы или профили:
```bash
npx playwright test tests/map.spec.js
npx playwright test --project=desktop-chrome
npx playwright test --project=mobile-iphone
```

После падения тестов Playwright сохраняет скриншот, трассировку и HTML-отчёт:
```bash
npx playwright show-report
npx playwright show-trace test-results/.../trace.zip
```

## Что покрыто

- `tests/map.spec.js` — глобальная карта: загрузка, поиск, фильтры, зум/панорама мышью, переключатель Карта/Вики
- `tests/auth.spec.js` — вход, выход, блокировка редактора без авторизации
- `tests/detail.spec.js` — страница острова: правки полей, undo-тост, локации, галерея, лайтбокс, скрытие пустых полей
- `tests/dragdrop.spec.js` — перетаскивание острова на карту, сортировка локаций, мини-карта локаций (мышью — тот же код что и touch, см. `startPointerDrag`)
- `tests/wiki.spec.js` — «Атлас островов»: группировка по фракции/размеру, переходы на страницы островов
- `tests/projects.spec.js` — переключатель проектов и фильтрация данных по нему
- `tests/legal.spec.js` — футер с дисклеймером и копирайтом, окно «О системе»
- `tests/mobile.spec.js` — тач-панорама/pinch-zoom, адаптивная шапка (профиль `mobile-iphone`)

## Изоляция от реальных данных

Конфиг (`playwright.config.js`) поднимает сервер с `ATLAS_DB_PATH`/`ATLAS_UPLOAD_DIR`/
`ATLAS_BACKUPS_DIR`, указывающими на временную папку (`os.tmpdir()`), которая
удаляется после прогона. Реальный `atlas.db` и `uploads/` не трогаются.
`global-setup.js` один раз создаёт тестовый аккаунт редактора
(пароль — `e2e/constants.js`), которым пользуются все тесты.
