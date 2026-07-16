import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const admin = await readFile(new URL('../src/admin/app.js', import.meta.url), 'utf8');
const backend = await readFile(new URL('../src/gas-admin/Code.gs', import.meta.url), 'utf8');

test('管理台與 Apps Script 使用相同狀態值', () => {
  for (const value of ['planned', 'confirmed', 'completed', 'cancelled', 'pending', 'in_progress', 'done']) {
    assert.match(admin, new RegExp(`['\"]${value}['\"]`), `admin 缺少 ${value}`);
    assert.match(backend, new RegExp(`['\"]${value}['\"]`), `backend 缺少 ${value}`);
  }
  for (const stale of ["'planning'", "'inviting'", "'todo'", "'doing'"]) {
    assert.equal(admin.includes(stale), false, `admin 仍含舊狀態 ${stale}`);
  }
});

test('設定精靈發布物為單檔，不依賴遺漏的 setup.js 或 styles.css', async () => {
  const html = await readFile(new URL('../dist/pages/setup/index.html', import.meta.url), 'utf8');
  assert.equal(/<script[^>]+src=["'][^"']*setup\.js/.test(html), false);
  assert.equal(/<link[^>]+href=["'][^"']*styles\.css/.test(html), false);
  assert.equal(/<script>\/\*__SETUP_JS__\*\/<\/script>/.test(html), false);
  assert.equal(/<style>\/\*__SETUP_CSS__\*\/<\/style>/.test(html), false);
  assert.match(html, /課程設定精靈/);
});

test('管理台建置保留雙錢字符號，不被 String.replace 當成替換語法', async () => {
  const html = await readFile(new URL('../dist/pages/demo.html', import.meta.url), 'utf8');
  assert.match(html, /function \$\$\(selector, root = document\)/);
  assert.match(html, /\$\$\("#nav button"\)\.forEach/);
  assert.doesNotMatch(html, /(?<!\$)\$\("#nav button"\)\.forEach/);
});
