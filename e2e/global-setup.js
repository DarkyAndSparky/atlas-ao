const { request } = require('@playwright/test');
const { TEST_USERNAME, TEST_PASSWORD } = require('./constants');

module.exports = async (config) => {
  const baseURL = config.projects[0].use.baseURL;
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/auth/register', { data: { username: TEST_USERNAME, password: TEST_PASSWORD } });
  if(!res.ok()){
    throw new Error('Не удалось создать тестовый аккаунт редактора в global-setup: ' + res.status());
  }
  await ctx.dispose();
};
