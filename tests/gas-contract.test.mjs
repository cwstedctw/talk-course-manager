import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const backend = await readFile(new URL('../src/gas-admin/Code.gs', import.meta.url), 'utf8');

function functionChunk(name, nextName) {
  const start = backend.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `找不到 ${name}`);
  const end = nextName ? backend.indexOf(`function ${nextName}(`, start + 1) : backend.length;
  assert.notEqual(end, -1, `找不到 ${nextName}`);
  return backend.slice(start, end);
}

test('同網域版包含永久安裝標記與完整必要工作表', () => {
  assert.match(backend, /installedMarkerProperty:\s*'TCM_INSTALLED_AT'/);
  assert.match(backend, /spreadsheetProperty:\s*'TCM_SPREADSHEET_ID'/);
  assert.match(backend, /Transactions:\s*\[/);
  assert.match(backend, /Object\.keys\(TCM\.sheets\)\.every/);
});

test('每次寫入只接受一筆操作並使用列級更新', () => {
  assert.match(backend, /maxBatchSize:\s*1/);
  const writer = functionChunk('writeRecords_', 'readSettings_');
  assert.doesNotMatch(writer, /clearContent\s*\(/);
  assert.match(writer, /keyField/);
  assert.match(writer, /setValues\(\[values\]\)/);
  assert.match(writer, /appendRow\(values\)/);
});

test('資料與設定寫入都先復原交易，再於鎖內重新驗證角色', () => {
  for (const [name, next] of [['saveBatch', 'importCourseConfig'], ['importCourseConfig', 'healthCheck']]) {
    const chunk = functionChunk(name, next);
    const recovery = chunk.indexOf('recoverPendingTransactions_();');
    const authorization = chunk.indexOf('requireRole_(');
    assert.ok(recovery >= 0, `${name} 缺少交易復原`);
    assert.ok(authorization > recovery, `${name} 必須在復原後重新驗證角色`);
    assert.match(chunk, /withSystemLock_/);
    assert.match(chunk, /appendTransaction_/);
    assert.match(chunk, /markTransactionCommitted_/);
  }
});

test('交易復原同時涵蓋 entity 與 courseConfig 設定', () => {
  const recovery = functionChunk('recoverPendingTransactions_', 'parseTransactionJson_');
  assert.match(recovery, /entity === 'settings'/);
  assert.match(recovery, /writeRecords_\('Settings', \[repairedSetting\]\)/);
  assert.match(recovery, /writeRecords_\(sheetName, \[after\]\)/);
  assert.match(recovery, /TRANSACTION_REVISION_MISMATCH/);
  assert.match(recovery, /markTransactionCommitted_\(transaction\.id\)/);
});

test('寫入前保留伺服器端權限與關聯資料驗證', () => {
  const save = functionChunk('saveBatch', 'importCourseConfig');
  assert.match(save, /enforceEntityPermission_\(viewer\.role, operation\.entity\)/);
  assert.match(save, /validateState_\(states, viewer\.email\)/);
  assert.match(backend, /Object\.create\(null\)/);
  assert.match(backend, /requireId_/);
});
