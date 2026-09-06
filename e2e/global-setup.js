const { request } = require('@playwright/test');
const { TEST_USERNAME, TEST_PASSWORD, BOOTSTRAP_USERNAME, BOOTSTRAP_PASSWORD } = require('./constants');

// /api/auth/register требует администраторские права ЛИБО совсем пустую базу
// (первая в жизни регистрация — тогда она же становится bootstrap-админом).
// Раньше этот файл рассчитывал на второй случай — но сервер САМ сажает в
// пустую базу дефолтный аккаунт admin при самом первом старте (см. db.js),
// так что база к моменту этого вызова уже не пуста, и голая регистрация без
// входа получает 401. Логинимся под тем самым дефолтным админом и
// регистрируем тестового редактора уже от его имени.
//
// Пароль дефолтного админа обычно генерируется случайно при каждом старте
// (защита от захардкоженного 'admin0000' в проде — см. комментарий в
// db.js), но playwright.config.js фиксирует его через
// ATLAS_BOOTSTRAP_PASSWORD, чтобы здесь можно было логиниться
// детерминированно, не читая консоль/файл сервера.
// Playwright запускает 2 полностью независимых сервера (см.
// playwright.config.js — desktop-chrome и mobile-iphone больше не делят
// одну БД, иначе второй проход по тем же хардкоженным ID островов задваивал
// данные: галерея 1→2, локации 2→4 и т.п.). Поэтому весь bootstrap-флоу
// ниже прогоняется для КАЖДОГО проекта отдельно, на его собственном baseURL.
async function setupProject(baseURL){
  const ctx = await request.newContext({ baseURL });

  const login = await ctx.post('/api/auth/login', { data: { username: BOOTSTRAP_USERNAME, password: BOOTSTRAP_PASSWORD } });
  if(!login.ok()){
    throw new Error(`Не удалось войти дефолтным админом в global-setup (${baseURL}) (проверь, что ATLAS_BOOTSTRAP_PASSWORD в playwright.config.js совпадает с BOOTSTRAP_PASSWORD в constants.js): ` + login.status());
  }

  // роль 'admin', не 'editor': config.spec.js/users.spec.js ("Панель
  // конфига (админ)") логинятся именно этим аккаунтом и рассчитывают на
  // #configBtn, который показывается только isAdmin (см. authUI.js) —
  // остальным тестам (auth.spec.js и т.д.) admin ничем не мешает, у него
  // те же права редактирования, что и у editor, плюс доступ к конфигу.
  const res = await ctx.post('/api/auth/register', { data: { username: TEST_USERNAME, password: TEST_PASSWORD, role: 'admin' } });
  if(!res.ok()){
    throw new Error(`Не удалось создать тестовый аккаунт редактора в global-setup (${baseURL}): ` + res.status());
  }
  await ctx.dispose();

  // Приглашённые (не bootstrap) пользователи регистрируются с
  // must_change_password=1 (см. routes/auth.js) — при первом входе браузер
  // показывает #forcePassOverlay поверх всего интерфейса и блокирует клики
  // по #editorToggle и остальным элементам, из-за чего абсолютно все тесты,
  // логинящиеся тестовым редактором, зависали/падали таймаутом. Снимаем флаг
  // здесь же, логинясь под свежесозданным редактором отдельным контекстом.
  // POST /api/auth/password при must_change_password=1 не требует текущий
  // пароль — но с недавних пор (см. roadmap #13) сервер отдельно проверяет
  // newPassword напрямую против реального хэша и отвергает "смену" на тот
  // же самый пароль. Поэтому меняем на временный и сразу обратно на
  // TEST_PASSWORD (второй раз currentPassword уже обязателен, раз флаг
  // must_change_password снят первым вызовом, — передаём его).
  const editorCtx = await request.newContext({ baseURL });
  const editorLogin = await editorCtx.post('/api/auth/login', { data: { username: TEST_USERNAME, password: TEST_PASSWORD } });
  if(!editorLogin.ok()){
    throw new Error(`Не удалось войти только что созданным тестовым редактором в global-setup (${baseURL}): ` + editorLogin.status());
  }
  const TEMP_PASSWORD = 'e2e-temp-password-for-flag-clear-1';
  const clearFlag = await editorCtx.post('/api/auth/password', { data: { newPassword: TEMP_PASSWORD } });
  if(!clearFlag.ok()){
    throw new Error(`Не удалось снять must_change_password с тестового редактора в global-setup (${baseURL}): ` + clearFlag.status());
  }
  const restorePassword = await editorCtx.post('/api/auth/password', { data: { currentPassword: TEMP_PASSWORD, newPassword: TEST_PASSWORD } });
  if(!restorePassword.ok()){
    throw new Error(`Не удалось вернуть тестовому редактору исходный пароль в global-setup (${baseURL}): ` + restorePassword.status());
  }
  await editorCtx.dispose();
}

module.exports = async (config) => {
  for(const project of config.projects){
    await setupProject(project.use.baseURL);
  }
};
