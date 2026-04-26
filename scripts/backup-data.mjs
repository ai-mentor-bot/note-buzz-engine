/**
 * data.sqlite（または DB_PATH）のファイルコピー。週1手動で十分なケース想定。
 * 高負荷で書き込み中のコピーは理論上リスクあり。心配ならサーバ停止後に実行。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.join(root, '.env') });
} catch {
  // optional
}

const src = process.env.DB_PATH
  ? path.resolve(root, process.env.DB_PATH)
  : path.join(root, 'data.sqlite');
const outDir = path.join(root, 'backups');

if (!fs.existsSync(src)) {
  console.log('[data:backup] スキップ: DB が存在しません →', src);
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date()
  .toISOString()
  .replace(/T/, '_')
  .replace(/[:.]/g, '-')
  .slice(0, 19);
const dest = path.join(outDir, `data_${stamp}.sqlite`);
fs.copyFileSync(src, dest);
const { size } = fs.statSync(dest);
console.log('[data:backup] 完了', dest, `(${size} bytes)`);
