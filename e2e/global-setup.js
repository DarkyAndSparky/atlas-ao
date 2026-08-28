const { request } = require('@playwright/test');
const { TEST_USERNAME, TEST_PASSWORD } = require('./constants');

// /api/auth/register требует администраторские права ЛИБО совсем пустую базу
// (первая в жизни регистрация — тогда она же становится bootstrap-админом).
// Раньше этот файл рассчитывал на второй случай — но сервер САМ сажает в
// пустую базу дефолтный аккаунт admin/admin0000 при самом первом старте
// (см. db.js), так что база к моменту этого вызова уже не пуста, и голая
// регистрация без входа получает 401. Логинимся под тем самым дефолтным
// админом и регистрируем тестового редактора уже от его имени.
module.exports = async (config) => {
  const baseURL = config.projects[0].use.baseURL;
  const ctx = await request.newContext({ baseURL });

  const login = await ctx.post('/api/auth/login', { data: { username: 'admin', password: 'admin0000' } });
  if(!login.ok()){
    throw new Error('Не удалось войти дефолтным админом (admin/admin0000) в global-setup: ' + login.status());
  }

  const res = await ctx.post('/api/auth/register', { data: { username: TEST_USERNAME, password: TEST_PASSWORD, role: 'editor' } });
  if(!res.ok()){
    throw new Error('Не удалось создать тестовый аккаунт редактора в global-setup: ' + res.status());
  }
  await ctx.dispose();
};
