/**
 * ブラウザで手動ログイン → Cookie を playwright/.auth/<brand>.json に保存
 * 使い方: npm run pw:auth:pitapizza  または  pw:auth:bread-burger
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { authPath, requireSlug, REPO_ROOT } from './lib/paths.mjs';

const slug = process.argv[2];
try {
  requireSlug(slug);
} catch (e) {
  console.error('Usage: node auth-note.mjs <pitapizza|bread-burger>');
  process.exit(1);
}

const authDir = path.join(REPO_ROOT, 'playwright', '.auth');
const out = authPath(slug);
fs.mkdirSync(authDir, { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: 'ja-JP' });
const page = await context.newPage();
await page.goto('https://note.com/login', { waitUntil: 'domcontentloaded' });
console.log(`[${slug}] 表示されたブラウザで note にログインし、必要なら 2FA まで完了してください。`);
console.log(`[${slug}] マイページに入れる状態になったら、このターミナルで Enter を押してください。`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await new Promise((resolve) => {
  rl.question('ログイン完了後に Enter... ', () => {
    rl.close();
    resolve();
  });
});

await context.storageState({ path: out });
console.log(`[${slug}] 保存しました: ${out}`);
console.log('次: npm run pw:test:' + (slug === 'bread-burger' ? 'bread-burger' : 'pitapizza'));
await browser.close();
