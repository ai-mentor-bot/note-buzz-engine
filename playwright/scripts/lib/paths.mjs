import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.join(__dirname, '..', '..', '..');
export const SLUGS = new Set(['pitapizza', 'bread-burger']);

export function authPath(slug) {
  return path.join(REPO_ROOT, 'playwright', '.auth', `${slug}.json`);
}

export function loadBrands() {
  const p = path.join(REPO_ROOT, 'playwright', 'brands.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function requireSlug(a) {
  if (!SLUGS.has(a)) {
    throw new Error(`brand は pitapizza か bread-burger: 渡された値=${a}`);
  }
}
