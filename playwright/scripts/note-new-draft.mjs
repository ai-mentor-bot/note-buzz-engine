/**
 * 分離した storageState で note 新規下書き画面を開く。必要なら本文を流し込み（ベストエフォート）。
 * --dry   画面を開いてスクショのみ（既定はヘッド付き。CI向けに HEADED=0 で headless 可）
 * --file  UTF-8 テキストを本文エリアに貼る試行。UI 変更で失敗し得る → 手動追記でOK
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import {
  authPath,
  loadBrands,
  requireSlug,
  REPO_ROOT,
} from './lib/paths.mjs';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry') || process.env.DRY_RUN === '1';
const rest = argv.filter((a) => a !== '--dry');
let bodyFile = null;
const fi = rest.indexOf('--file');
if (fi >= 0) {
  bodyFile = path.resolve(rest[fi + 1]);
  rest.splice(fi, 2);
}
const slug = rest[0];
try {
  requireSlug(slug);
} catch {
  console.error(
    'Usage: node note-new-draft.mjs <pitapizza|bread-burger> [--dry] [--file path/to/body.md]'
  );
  process.exit(1);
}

const statePath = authPath(slug);
if (!fs.existsSync(statePath)) {
  console.error(`先に: npm run pw:auth:${slug}  — 不足: ${statePath}`);
  process.exit(1);
}

const brands = loadBrands();
const newUrl = brands[slug]?.noteNewUrl;
if (!newUrl) {
  console.error(`playwright/brands.json の ${slug}.noteNewUrl を設定してください。`);
  process.exit(1);
}

const headless = process.env.HEADED === '0' || process.env.HEADED === 'false';
const outDir = path.join(REPO_ROOT, 'playwright', 'artifacts', slug);
fs.mkdirSync(outDir, { recursive: true });
const shot = path.join(
  outDir,
  `draft-open-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
);

const browser = await chromium.launch({ headless });
const context = await browser.newContext({
  storageState: statePath,
  locale: 'ja-JP',
});
const page = await context.newPage();
await page.goto(newUrl, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: shot, fullPage: false });

if (dry) {
  console.log(`[${slug}][dry] 新規下書き URL を開きました: ${newUrl}`);
  console.log(`[${slug}][dry] スクショ: ${shot}`);
  if (!headless) {
    console.log(`[${slug}][dry] ブラウザを閉じるには Enter...`);
    await new Promise((r) => process.stdin.once('data', r));
  }
  await browser.close();
  process.exit(0);
}

if (bodyFile) {
  if (!fs.existsSync(bodyFile)) {
    console.error('ファイルが見つかりません:', bodyFile);
    await browser.close();
    process.exit(1);
  }
  const text = fs.readFileSync(bodyFile, 'utf8');
  const editors = page.locator(
    'div[contenteditable="true"], [data-testid="editor"] textarea, article [contenteditable="true"]'
  );
  try {
    const el = editors.first();
    await el.waitFor({ state: 'visible', timeout: 20000 });
    await el.click();
    await el.fill(''); // clear best-effort
    await el.pressSequentially(text.slice(0, 50000), { delay: 0 });
    console.log(`[${slug}] 本文を流し込み（最大5万文字）: ${bodyFile}`);
  } catch (e) {
    console.warn(
      '[warn] エディタ自動入力に失敗。note UI が変わった可能性。手で貼り付け可。',
      e.message
    );
  }
}

console.log(`[${slug}] 下書き画面: ${newUrl}`);
console.log(`[${slug}] スクショ: ${shot}`);
console.log('公開は手動。終了はブラウザを閉じるか、ターミナルで Enter。');
if (!headless) {
  await new Promise((r) => process.stdin.once('data', r));
}
await browser.close();
