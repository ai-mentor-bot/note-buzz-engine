/**
 * ブラウザで手動ログイン → Cookie を playwright/.auth/<brand>.json に保存
 * 使い方: npm run pw:auth:store / pw:auth:affi-seminar / pw:auth:ai-main
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
  console.error('Usage: node auth-note.mjs <store|affi-seminar|ai-main|pitapizza|bread-burger>');
  process.exit(1);
}

const authDir = path.join(REPO_ROOT, 'playwright', '.auth');
const out = authPath(slug);
fs.mkdirSync(authDir, { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: 'ja-JP' });
const page = await context.newPage();
await page.goto('https://note.com/login', { waitUntil: 'domcontentloaded' });
console.log('');
console.log('──────── いまからあなたがやること（3 ステップ）────────');
console.log('  1）上に開いたブラウザで、いつもの note にログインする（2FA もここで）');
console.log('  2）マイページなど、ログイン済みだと分かる画面まで行く');
console.log('  3）この黒い画面に戻り、下の行が出たら Enter を 1 回');
console.log('──────── ブランド:', slug, '────────');
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
console.log(`次: npm run pw:verify:${slug}`);
await browser.close();
