const { defineConfig } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const authPath = (slug) =>
  path.join(__dirname, 'playwright', '.auth', `${slug}.json`);

/** 未認証のときは未設定（毎回ログアウト状態）。先に pw:auth:* を実行。 */
function useStorageState(slug) {
  const p = authPath(slug);
  return fs.existsSync(p) ? p : undefined;
}

module.exports = defineConfig({
  testDir: path.join(__dirname, 'playwright', 'specs'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'https://note.com',
    headless: process.env.HEADED === '1' ? false : true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'ja-JP',
  },
  projects: [
    {
      name: 'pitapizza',
      use: { storageState: useStorageState('pitapizza') },
    },
    {
      name: 'bread-burger',
      use: { storageState: useStorageState('bread-burger') },
    },
  ],
});
