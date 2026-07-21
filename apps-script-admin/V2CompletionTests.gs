/**
 * v2 production hardening 實機測試。
 * 只在 dev/staging Sheet 執行；會建立 v2c_ 前綴假資料並在結束時清除。
 */
function runV2CompletionSuite() {
  assertOwnerSelf_();
  assertDestructiveTestsAllowed_();
  bootstrapSchema();
  ensureSelfInUsers_();
  v2cCleanup_();

  const results = [];
  const t = function(name, fn) {
    try {
      fn();
      results.push({ name: name, pass: true, detail: 'OK' });
    } catch (e) {
      results.push({ name: name, pass: false, detail: String(e && e.message ? e.message : e) });
    }
  };

  t('自薦報名原子轉入新講者', function() {
    v2cSeedSubmission_('v2c_sub_self', {
      mode: 'self', name: 'V2C 自薦講者', contact: 'v2c@example.invalid', org: '範例單位',
      topicsJson: '["AI 應用"]', proposedTitle: 'V2C 擬講題', preferredWeeksJson: '[]',
      anyWeek: true, message: '測試留言', rawJson: '{"recordPref":"可錄影"}'
    });
    const result = importSubmission({ submissionId: 'v2c_sub_self', target: { type: 'speaker' }, patch: {} });
    v2cAssert_(result.ok === true && result.createdIds.length === 1, JSON.stringify(result));
    const speaker = w1Find_('Speakers', result.createdIds[0], false);
    v2cAssert_(speaker && speaker.name === 'V2C 自薦講者' && speaker.status === '接洽中', '講者轉入內容錯誤');
    v2cAssert_(!w1Find_('Submissions', 'v2c_sub_self', false), '原報名沒有軟刪除');
    const deleted = w1Find_('Submissions', 'v2c_sub_self', true);
    v2cAssert_(deleted && asBool_(deleted.isDeleted), 'includeDeleted 找不到原報名');
  });

  t('同一筆報名不可重複轉入', function() {
    const result = importSubmission({ submissionId: 'v2c_sub_self', target: { type: 'speaker' }, patch: {} });
    v2cAssert_(result.ok === false && result.error.code === 'not_found', JSON.stringify(result));
  });

  t('推薦報名轉入新講者，AuditLog 不含聯絡內容', function() {
    v2cSeedSubmission_('v2c_sub_recommend', {
      mode: 'recommend', name: 'V2C 推薦人', contact: 'recommender@example.invalid',
      recName: 'V2C 被推薦講者', recOrg: '推薦單位', recWhy: '具實務經驗',
      recContact: 'recommended@example.invalid', topicsJson: '[]', preferredWeeksJson: '[]', rawJson: '{}'
    });
    const result = importSubmission({ submissionId: 'v2c_sub_recommend', target: { type: 'speaker' }, patch: {} });
    v2cAssert_(result.ok === true && result.createdIds.length === 1, JSON.stringify(result));
    const speaker = w1Find_('Speakers', result.createdIds[0], false);
    v2cAssert_(speaker && speaker.name === 'V2C 被推薦講者' && speaker.status === '口袋名單', '推薦轉入內容錯誤');
    const logs = readTable_('AuditLog', true).filter(function(row) { return row.entityId === result.createdIds[0]; });
    v2cAssert_(logs.length >= 1, '推薦轉入沒有 AuditLog');
    v2cAssert_(logs.every(function(row) {
      return String(row.detailJson || '').indexOf('recommended@example.invalid') === -1 &&
        String(row.detailJson || '').indexOf('recommender@example.invalid') === -1;
    }), 'AuditLog 洩漏報名聯絡內容');
  });

  t('報名可轉入既有場次並推進構想中狀態', function() {
    upsertSeedRow_('Talks', {
      id: 'v2c_talk_existing', no: 99, status: '構想中', date: '', time: '', venue: '',
      title: '', abstract: '', moeJson: '[]', speakerId: '', speakerName: '', speakerTitle: '',
      speakerOrg: '', speakerEmail: '', speakerPhone: '', notes: ''
    }, nowIso_());
    v2cSeedSubmission_('v2c_sub_talk', {
      mode: 'self', name: 'V2C 場次講者', contact: 'talk@example.invalid', org: '場次單位',
      topicsJson: '[]', proposedTitle: 'V2C 場次講題', preferredWeeksJson: '[]', anyWeek: true, rawJson: '{}'
    });
    const result = importSubmission({
      submissionId: 'v2c_sub_talk',
      target: { type: 'talk', id: 'v2c_talk_existing' },
      patch: {}
    });
    v2cAssert_(result.ok === true && result.updatedIds[0] === 'v2c_talk_existing', JSON.stringify(result));
    const talk = w1Find_('Talks', 'v2c_talk_existing', false);
    v2cAssert_(talk.speakerName === 'V2C 場次講者' && talk.title === 'V2C 場次講題', '場次轉入內容錯誤');
    v2cAssert_(talk.status === '邀約中', '構想中場次沒有推進為邀約中');
  });

  t('既有講者空白欄位不被清掉，明確 patch 優先', function() {
    upsertSeedRow_('Speakers', {
      id: 'v2c_spk_existing', name: 'V2C 既有講者', title: '教授', org: '原單位',
      field: '原專長', email: 'old@example.invalid', phone: '0900000000', status: '已合作過', notes: '舊備註'
    }, nowIso_());
    v2cSeedSubmission_('v2c_sub_existing', {
      mode: 'self', name: 'V2C 既有講者', contact: '', org: '', topicsJson: '[]',
      preferredWeeksJson: '[]', anyWeek: false, message: '', rawJson: '{}'
    });
    const result = importSubmission({
      submissionId: 'v2c_sub_existing',
      target: { type: 'speaker', id: 'v2c_spk_existing' },
      patch: { title: '講座教授' }
    });
    v2cAssert_(result.ok === true && result.updatedIds[0] === 'v2c_spk_existing', JSON.stringify(result));
    const speaker = w1Find_('Speakers', 'v2c_spk_existing', false);
    v2cAssert_(speaker.title === '講座教授', '明確 patch 未優先');
    v2cAssert_(speaker.org === '原單位' && speaker.email === 'old@example.invalid' && speaker.status === '已合作過', '空白投稿清掉既有資料');
  });

  t('略過報名保留軟刪與 AuditLog', function() {
    v2cSeedSubmission_('v2c_sub_dismiss', {
      mode: 'self', name: 'V2C 略過', contact: 'skip@example.invalid', org: '',
      topicsJson: '[]', preferredWeeksJson: '[]', anyWeek: true, rawJson: '{}'
    });
    const result = dismissSubmission({ submissionId: 'v2c_sub_dismiss', reason: '測試略過' });
    v2cAssert_(result.ok === true, JSON.stringify(result));
    v2cAssert_(!w1Find_('Submissions', 'v2c_sub_dismiss', false), '略過後仍出現在 active snapshot');
    const logs = readTable_('AuditLog', true).filter(function(row) {
      return row.entityId === 'v2c_sub_dismiss' && row.action === 'dismissSubmission';
    });
    v2cAssert_(logs.length >= 1, '沒有 dismissSubmission AuditLog');
  });

  t('Editor snapshot 欄位白名單', function() {
    const tables = snapshotTablesForRole_('editor');
    v2cAssert_(tables.indexOf('Submissions') !== -1, 'Editor 應能讀 Submissions');
    v2cAssert_(tables.indexOf('Users') === -1 && tables.indexOf('AuditLog') === -1, 'Editor 不應讀 Users/AuditLog');
  });

  t('JSON 欄位 PII 與大小護欄', function() {
    const pii = v2cCatchCode_(function() { sanitizeJson_('{"idNumber":"A123456789"}', 'rawJson'); });
    v2cAssert_(pii === 'pii_detected', 'PII code=' + pii);
    const lowerPii = v2cCatchCode_(function() { sanitizeJson_('{"note":"a123456789"}', 'rawJson'); });
    v2cAssert_(lowerPii === 'pii_detected', 'lower PII code=' + lowerPii);
    const lowerPlainPii = v2cCatchCode_(function() { sanitizeValue_('Speakers', 'notes', 'a123456789'); });
    v2cAssert_(lowerPlainPii === 'pii_detected', 'lower plain PII code=' + lowerPlainPii);
    ['national_id_number', 'bank_account_number', 'studentId', 'receiptImage'].forEach(function(key) {
      const value = {};
      value[key] = 'hidden';
      const code = v2cCatchCode_(function() { sanitizeJson_(JSON.stringify(value), 'rawJson'); });
      v2cAssert_(code === 'pii_detected', key + ' code=' + code);
    });
    const big = v2cCatchCode_(function() { sanitizeJson_(JSON.stringify({ value: new Array(50002).join('x') }), 'rawJson'); });
    v2cAssert_(big === 'payload_too_large', 'big code=' + big);
  });

  const failed = results.filter(function(result) { return !result.pass; });
  try { v2cCleanup_(); } catch (e) {}
  Logger.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results: results }));
  if (failed.length) throw new Error('V2 completion suite failed: ' + JSON.stringify(failed));
  return { passed: results.length, failed: 0, results: results };
}

function v2cSeedSubmission_(id, partial) {
  const record = {
    id: id, receivedAt: nowIso_(), mode: 'self', name: '', contact: '', org: '',
    topicsJson: '[]', proposedTitle: '', preferredWeeksJson: '[]', anyWeek: false,
    message: '', recName: '', recOrg: '', recWhy: '', recContact: '', source: 'v2c-test',
    clientId: 'v2c-client', rawJson: '{}'
  };
  Object.keys(partial || {}).forEach(function(key) { record[key] = partial[key]; });
  upsertSeedRow_('Submissions', record, nowIso_());
}

function v2cCleanup_() {
  ['Speakers', 'Talks', 'Submissions'].forEach(function(table) {
    const state = tableState_(ss_(), {}, table);
    const rows = [];
    Object.keys(state.byId).forEach(function(id) {
      const record = state.byId[id].record;
      if (id.indexOf('v2c_') === 0 || (record.name && String(record.name).indexOf('V2C ') === 0)) {
        rows.push(state.byId[id].rowIndex);
      }
    });
    rows.sort(function(a, b) { return b - a; }).forEach(function(rowIndex) { state.sheet.deleteRow(rowIndex); });
  });
}

function v2cAssert_(condition, message) {
  if (!condition) throw new Error('斷言失敗：' + message);
}

function v2cCatchCode_(fn) {
  try { fn(); return 'NO_THROW'; }
  catch (e) { return e && e.code ? e.code : 'THROW:' + String(e && e.message || e); }
}
