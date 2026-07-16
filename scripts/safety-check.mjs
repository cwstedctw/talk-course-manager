import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const blocked = [
  /gms\.ndhu\.edu\.tw/i,
  /docs\.google\.com\/spreadsheets\/d\//i,
  /script\.google\.com\/macros\/s\/AKfy/i,
  /1LyfUWA3C/i,
  /19I2-BIjF/i,
];
const ignored = new Set(['.git', 'node_modules', 'dist']);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const base = fileURLToPath(root);
const failures = [];
for (const file of await walk(base)) {
  if (file.endsWith('safety-check.mjs') || file.endsWith('safety.yml')) continue;
  const body = await readFile(file, 'utf8').catch(() => '');
  if (blocked.some((pattern) => pattern.test(body))) failures.push(relative(base, file));
}
if (failures.length) {
  console.error(`安全掃描失敗：${failures.join(', ')}`);
  process.exit(1);
}
console.log('安全掃描通過。');
