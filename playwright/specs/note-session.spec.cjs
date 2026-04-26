const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const brands = require('../brands.json');

const authFile = (slug) =>
  path.join(__dirname, '..', '.auth', `${slug}.json`);

test.beforeEach(({}, testInfo) => {
  const slug = testInfo.project.name;
  if (!fs.existsSync(authFile(slug))) {
    test.skip(
      true,
      `先に npm run pw:auth:${slug} で ${authFile(slug)} を生成してください。`
    );
  }
});

test('保存済みセッションで note マイページに到達できる', async (
  { page },
  testInfo
) => {
  const slug = testInfo.project.name;
  const cfg = brands[slug];
  if (!cfg?.noteMypageUrl) {
    test.skip(true, `playwright/brands.json に ${slug}.noteMypageUrl がありません。`);
  }
  await page.goto(cfg.noteMypageUrl, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/note\.com/);
  const login = page.getByRole('link', { name: 'ログイン' });
  await expect(login).toBeHidden({ timeout: 10000 });
  await expect(
    page.getByText(/マイページ|記事|下書き|新規|作成/iu).first()
  ).toBeVisible({ timeout: 20000 });
});
