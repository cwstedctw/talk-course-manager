/**
 * W1 驗收套件 — PHASE2-PLAN W1：saveBatch 衝突／權限拒絕／atomic 回滾 實機驗收
 * 跑法：編輯器選 runW1Suite 執行（僅限指令碼擁有者本人）；結果寫 dev Sheet 的 TestResults 分頁。
 * 原則：「語法通過≠執行完成」——每個斷言都對真 Sheet 讀回驗證，不信回傳值單面之詞。
 * 權限矩陣（B 組）用假 who 物件走真 planChange_／assertWritable_ 邏輯；
 * 真多帳號身分流（getActiveUser→allowlist）Phase 0 已實證、W5 三帳號實測再覆蓋一次。
 */

const W1_RESULTS_SHEET = 'TestResults';

function runW1Suite() {
  assertOwnerSelf_();
  assertDestructiveTestsAllowed_();
  const startedAt = nowIso_();
  const results = [];
  const t = function(caseId, name, fn) {
    try {
      const detail = fn();
      results.push({ caseId: caseId, name: name, pass: true, detail: detail || 'OK' });
    } catch (e) {
      results.push({ caseId: caseId, name: name, pass: false, detail: String(e && e.message ? e.message : e) });
    }
  };

  // ── 前置：schema＋種子＋擁有者真帳號入 Users（不然真身分呼叫全被拒）──
  bootstrapSchema();
  seedFakeData();
  seedBudgetLinesOfficial({ overwriteExisting: true });
  ensureSelfInUsers_();
  w1Cleanup_();   // 清上次殘留，讓本輪從乾淨狀態開始

  // ══ A. 公開路徑（真身分＝owner 走 saveBatch／getSnapshot／whoami）══

  t('A1', 'whoami 回 owner＋permissions', function() {
    const r = whoami();
    w1Assert_(r.ok === true, 'ok!=true: ' + JSON.stringify(r.error || r));
    w1Assert_(r.role === 'owner', 'role=' + r.role);
    w1Assert_((r.permissions || []).indexOf('manageUsers') !== -1, 'permissions 缺 manageUsers');
    return 'role=owner, permissions=' + r.permissions.length + ' 項';
  });

  t('A2', 'saveBatch 新建（無 base）→ version 1＋讀回一致', function() {
    const r = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Speakers', 'w1_spk_a', null, { name: 'W1 測試講者', status: '邀約中' })]));
    w1Assert_(r.ok === true, JSON.stringify(r));
    w1Assert_(r.accepted[0].version === 1, 'version=' + r.accepted[0].version);
    const rec = w1Find_('Speakers', 'w1_spk_a', false);
    w1Assert_(rec && rec.name === 'W1 測試講者', '讀回失敗: ' + JSON.stringify(rec));
    w1Assert_(rec.updatedBy === Session.getActiveUser().getEmail().toLowerCase(), 'updatedBy=' + rec.updatedBy);
    return 'created v1, updatedBy=' + rec.updatedBy;
  });

  t('A3', 'saveBatch 正確 base 更新 → version 2', function() {
    const cur = w1Find_('Speakers', 'w1_spk_a', false);
    const r = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Speakers', 'w1_spk_a', w1Base_(cur), { org: 'W1 大學' })]));
    w1Assert_(r.ok === true, JSON.stringify(r));
    w1Assert_(r.accepted[0].version === 2, 'version=' + r.accepted[0].version);
    const rec = w1Find_('Speakers', 'w1_spk_a', false);
    w1Assert_(rec.org === 'W1 大學' && rec.name === 'W1 測試講者', '部分更新壞了其他欄: ' + JSON.stringify(rec));
    return 'v1→v2，未帶欄位不動';
  });

  t('A4', 'stale base → conflict（格式照契約 §C）', function() {
    const r = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Speakers', 'w1_spk_a',
      { updatedAt: '2020-01-01T00:00:00.000Z', version: 1 }, { org: '過期大學' })]));
    w1Assert_(r.ok === false, '該衝突卻成功');
    w1Assert_(r.error && r.error.code === 'conflict', 'code=' + (r.error && r.error.code));
    const c = (r.conflicts || [])[0] || {};
    w1Assert_(c.reason === 'stale_record', 'reason=' + c.reason);
    w1Assert_(c.clientBase && c.clientBase.version === 1, '缺 clientBase');
    w1Assert_(c.server && c.server.version === 2 && c.server.record, '缺 server.record');
    w1Assert_(c.clientRecord && c.clientRecord.org === '過期大學', '缺 clientRecord');
    const rec = w1Find_('Speakers', 'w1_spk_a', false);
    w1Assert_(rec.org === 'W1 大學', '衝突卻寫入了！org=' + rec.org);
    return 'conflict 三件套齊、未寫入';
  });

  t('A5', '批次原子性（計畫階段）：一好一衝突 → 整批不寫', function() {
    saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Speakers', 'w1_spk_b', null, { name: 'W1 乙' })]));
    const a = w1Find_('Speakers', 'w1_spk_a', false);
    const r = saveBatch(w1Env_([
      w1Change_('c1', 'upsert', 'Speakers', 'w1_spk_a', w1Base_(a), { notes: '這筆合法' }),
      w1Change_('c2', 'upsert', 'Speakers', 'w1_spk_b', { updatedAt: '2020-01-01T00:00:00.000Z', version: 9 }, { name: '這筆衝突' })
    ]));
    w1Assert_(r.ok === false && r.error.code === 'conflict', JSON.stringify(r.error || r));
    const a2 = w1Find_('Speakers', 'w1_spk_a', false);
    w1Assert_(a2.notes !== '這筆合法' && Number(a2.version) === Number(a.version), '合法那筆被寫入＝沒有整批擋下');
    return '整批拒絕、合法筆未寫入';
  });

  t('A6', 'schemaVersion 不符 → schema_mismatch', function() {
    /* 送出「非現行版本」的 envelope 才驗得到 mismatch（現行 SCHEMA_VERSION=2，故送 99） */
    const r = saveBatch({ schemaVersion: 99, clientBatchId: 'w1bad', changes: [w1Change_('c1', 'upsert', 'Speakers', 'w1_x', null, { name: 'x' })] });
    w1Assert_(r.ok === false && r.error.code === 'schema_mismatch', JSON.stringify(r.error || r));
    return 'schema_mismatch';
  });

  t('A7', 'envelope 帶契約外欄位 → unknown_fields', function() {
    const r = saveBatch({ schemaVersion: 1, clientBatchId: 'w1bad2', changes: [], hack: true });
    w1Assert_(r.ok === false && r.error.code === 'unknown_fields', JSON.stringify(r.error || r));
    return 'unknown_fields';
  });

  t('A8', 'changes 空陣列 → validation', function() {
    const r = saveBatch(w1Env_([]));
    w1Assert_(r.ok === false && r.error.code === 'validation', JSON.stringify(r.error || r));
    return 'validation';
  });

  t('A9', '單批 51 筆 → validation（拆批護欄）', function() {
    const changes = [];
    for (var i = 0; i < 51; i++) changes.push(w1Change_('c' + i, 'upsert', 'Speakers', 'w1_bulk_' + i, null, { name: 'x' }));
    const r = saveBatch(w1Env_(changes));
    w1Assert_(r.ok === false && r.error.code === 'validation', JSON.stringify(r.error || r));
    w1Assert_(!w1Find_('Speakers', 'w1_bulk_0', true), '護欄失效：有筆被寫入');
    return '51 筆整批擋下';
  });

  t('A10', '同批重複同一筆 → validation', function() {
    const r = saveBatch(w1Env_([
      w1Change_('c1', 'upsert', 'Speakers', 'w1_dup', null, { name: 'a' }),
      w1Change_('c2', 'upsert', 'Speakers', 'w1_dup', null, { name: 'b' })
    ]));
    w1Assert_(r.ok === false && r.error.code === 'validation', JSON.stringify(r.error || r));
    return '重複 key 擋下';
  });

  t('A11', 'softDelete → 預設快照隱藏、includeDeleted 可見、version 續跳', function() {
    const b = w1Find_('Speakers', 'w1_spk_b', false);
    const r = saveBatch(w1Env_([w1Change_('c1', 'softDelete', 'Speakers', 'w1_spk_b', w1Base_(b), undefined)]));
    w1Assert_(r.ok === true, JSON.stringify(r));
    w1Assert_(!w1Find_('Speakers', 'w1_spk_b', false), '預設快照仍看得到已刪');
    const gone = w1Find_('Speakers', 'w1_spk_b', true);
    w1Assert_(gone && asBool_(gone.isDeleted) === true && Number(gone.version) === Number(b.version) + 1, 'includeDeleted 讀不到或 version 沒跳');
    const snap = getSnapshot({ includeDeleted: 'false' });   // P1 嚴格布林回歸：字串 'false' 不得當 true
    const inSnap = (snap.tables.Speakers || []).some(function(x) { return x.id === 'w1_spk_b'; });
    w1Assert_(!inSnap, "getSnapshot({includeDeleted:'false'}) 誤含已刪＝嚴格布林壞了");
    return '軟刪＋嚴格布林都對';
  });

  t('A12', 'softDelete 不存在的 id → not_found', function() {
    const r = saveBatch(w1Env_([w1Change_('c1', 'softDelete', 'Speakers', 'w1_ghost', { updatedAt: '2020-01-01T00:00:00.000Z', version: 1 }, undefined)]));
    w1Assert_(r.ok === false && r.error.code === 'not_found', JSON.stringify(r.error || r));
    return 'not_found';
  });

  t('A13', '公式注入：name=「=1+1」→ 存文字不執行', function() {
    const r = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Speakers', 'w1_formula', null, { name: '=1+1' })]));
    w1Assert_(r.ok === true, JSON.stringify(r));
    const state = tableState_(ss_(), {}, 'Speakers');
    const hit = state.byId['w1_formula'];
    w1Assert_(hit, '找不到列');
    const sh = state.sheet;
    const nameCol = schemaHeaders_('Speakers').indexOf('name') + 1;
    const formula = sh.getRange(hit.rowIndex, nameCol).getFormula();
    const display = String(sh.getRange(hit.rowIndex, nameCol).getDisplayValue());
    w1Assert_(formula === '', '儲存格變成公式了: ' + formula);
    w1Assert_(display.indexOf('1+1') !== -1 && display !== '2', 'display=' + display);
    return 'cell 無公式、顯示 ' + display;
  });

  t('A14', 'PII 哨兵：身分證字號 → pii_detected', function() {
    const r = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Speakers', 'w1_pii', null, { notes: '身分證 A123456789 勿存' })]));
    w1Assert_(r.ok === false && r.error.code === 'pii_detected', JSON.stringify(r.error || r));
    w1Assert_(!w1Find_('Speakers', 'w1_pii', true), 'PII 筆被寫入了');
    return 'pii_detected 且未寫入';
  });

  t('A15', '單欄超長（>50k）→ payload_too_large', function() {
    var big = new Array(50002).join('x');
    const r = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Speakers', 'w1_big', null, { notes: big })]));
    w1Assert_(r.ok === false && r.error.code === 'payload_too_large', JSON.stringify(r.error || r));
    return 'payload_too_large';
  });

  t('A16', 'Owner 寫 Users（合法路徑）→ ok', function() {
    const u = w1Find_('Users', 'user_fake_editor', false);
    w1Assert_(u, '種子 user_fake_editor 不在');
    const r = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Users', 'user_fake_editor', w1Base_(u), { note: '請改為助理或 TA 的真實學校帳號' })]));
    w1Assert_(r.ok === true, JSON.stringify(r));
    return 'owner 可寫 Users';
  });

  t('A17', 'client 直寫 AuditLog → unauthorized', function() {
    const r = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'AuditLog', 'w1_log', null, { action: 'hack' })]));
    w1Assert_(r.ok === false && r.error.code === 'unauthorized', JSON.stringify(r.error || r));
    return 'AuditLog 擋下';
  });

  t('A18', 'client 直寫 Submissions → unauthorized（管理台只讀）', function() {
    const r = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Submissions', 'w1_sub', null, { name: 'hack' })]));
    w1Assert_(r.ok === false && r.error.code === 'unauthorized', JSON.stringify(r.error || r));
    return 'Submissions 擋下';
  });

  t('A19', 'AuditLog：成功批次留跡（筆數＋requestId＋result=ok）', function() {
    const before = readTable_('AuditLog', true).length;
    const batchId = 'w1batch_audit_' + Utilities.getUuid();
    const r = saveBatch({ schemaVersion: 1, clientBatchId: batchId, changes: [
      w1Change_('c1', 'upsert', 'Speakers', 'w1_audit_1', null, { name: '甲' }),
      w1Change_('c2', 'upsert', 'Speakers', 'w1_audit_2', null, { name: '乙' })
    ] });
    w1Assert_(r.ok === true, JSON.stringify(r));
    const rows = readTable_('AuditLog', true);
    w1Assert_(rows.length === before + 2, '筆數 ' + before + '→' + rows.length + '（該 +2）');
    const mine = rows.filter(function(x) { return x.requestId === batchId; });
    w1Assert_(mine.length === 2, 'requestId 對上 ' + mine.length + ' 筆');
    w1Assert_(mine.every(function(x) { return x.result === 'ok' && x.action === 'create'; }), '內容不對: ' + JSON.stringify(mine));
    return '+2 筆、requestId／result／action 全對';
  });

  t('A20', '日期保真：date=2026-09-15 進出原樣（序號位移 bug 回歸）', function() {
    const r = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Talks', 'w1_talk_date', null, { no: 99, date: '2026-09-15', time: '10:00-12:00', title: 'W1 日期測試' })]));
    w1Assert_(r.ok === true, JSON.stringify(r));
    const rec = w1Find_('Talks', 'w1_talk_date', false);
    w1Assert_(rec.date === '2026-09-15', 'date 讀回=' + JSON.stringify(rec.date) + '（W1 前的 bug：變序號→ISO 位移一天）');
    w1Assert_(rec.time === '10:00-12:00', 'time 讀回=' + JSON.stringify(rec.time));
    const seeded = w1Find_('Talks', 'talk_fake_001', false);
    w1Assert_(seeded && seeded.date === '2026-09-15', '種子 talk_fake_001.date 讀回=' + JSON.stringify(seeded && seeded.date) + '（migration 沒生效）');
    return '新寫＋舊種子 date 都原樣';
  });

  t('A21', 'BudgetLines 12 科目就位、合計 300,000（示範經費表）', function() {
    const rows = readTable_('BudgetLines', false);
    w1Assert_(rows.length === 12, '筆數=' + rows.length);
    const total = rows.reduce(function(s, x) { return s + Number(x.budgetAmount || 0); }, 0);
    w1Assert_(total === 300000, '合計=' + total);
    return '12 科目、合計 300000';
  });

  t('A22', 'Expenses：數字欄強制＋evidenceUrl https 限定', function() {
    const bad = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Expenses', 'w1_exp_bad', null, { budgetLineId: 'bl_misc', amount: 100, evidenceUrl: 'http://evil.example' })]));
    w1Assert_(bad.ok === false && bad.error.code === 'validation', 'http:// 沒擋: ' + JSON.stringify(bad.error || bad));
    const bad2 = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Expenses', 'w1_exp_bad2', null, { budgetLineId: 'bl_misc', amount: 'not-a-number' })]));
    w1Assert_(bad2.ok === false && bad2.error.code === 'validation', '非數字 amount 沒擋');
    const ok = saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Expenses', 'w1_exp_a', null, { budgetLineId: 'bl_misc', date: '2026-10-01', amount: 1234, desc: 'W1 測試支出', evidenceUrl: 'https://drive.google.com/file/d/w1test', status: '已送件' })]));
    w1Assert_(ok.ok === true, JSON.stringify(ok));
    const rec = w1Find_('Expenses', 'w1_exp_a', false);
    w1Assert_(rec.amount === 1234 && rec.date === '2026-10-01' && rec.evidenceUrl === 'https://drive.google.com/file/d/w1test', '讀回: ' + JSON.stringify(rec));
    return 'http 擋、https 過、數字保真';
  });

  // ══ B. 權限矩陣（假 who 走真 planChange_／assertWritable_；真多帳號＝Phase 0 已證＋W5 再測）══

  const editorWho = { email: 'w1editor@example.invalid', role: 'editor' };

  t('B1', 'editor 寫 Talks → 允許（計畫成形）', function() {
    const plan = planChange_(ss_(), {}, editorWho, w1Change_('b1', 'upsert', 'Talks', 'w1_b1', null, { title: 'editor 可排場次' }), {});
    w1Assert_(plan && !plan.conflict && plan.action === 'create', JSON.stringify(plan));
    return 'editor 可寫營運資料';
  });

  t('B2', 'editor 寫 Users → unauthorized', function() {
    const code = w1CatchCode_(function() { planChange_(ss_(), {}, editorWho, w1Change_('b2', 'upsert', 'Users', 'w1_b2', null, { email: 'x@x', role: 'editor' }), {}); });
    w1Assert_(code === 'unauthorized', 'code=' + code);
    return 'Users 限 Owner ✓';
  });

  t('B3', 'editor 寫 Settings → unauthorized', function() {
    const code = w1CatchCode_(function() { planChange_(ss_(), {}, editorWho, w1Change_('b3', 'upsert', 'Settings', 'set_settings', null, { key: 'settings', valueJson: '{}' }), {}); });
    w1Assert_(code === 'unauthorized', 'code=' + code);
    return 'Settings 限 Owner ✓';
  });

  t('B4', '連 owner 也不可直寫 AuditLog／Submissions（assertWritable_）', function() {
    const c1 = w1CatchCode_(function() { assertWritable_('AuditLog', 'owner'); });
    const c2 = w1CatchCode_(function() { assertWritable_('Submissions', 'owner'); });
    w1Assert_(c1 === 'unauthorized' && c2 === 'unauthorized', 'AuditLog=' + c1 + ' Submissions=' + c2);
    return '伺服器專屬表雙擋 ✓';
  });

  // ══ C. atomic 回滾（commitPlans_ 實機：真寫入→中途炸→驗證 Sheet 已還原）══

  const ownerWho = { email: 'w1owner@example.invalid', role: 'owner' };
  const poison = { changeId: 'boom', op: 'upsert', action: 'create', table: 'W1Boom', id: 'w1_boom', rowIndex: null, before: null, after: {}, changedFields: [] };

  t('C1', 'insert 回滾：新列寫入後中途炸 → 列消失、AuditLog 無跡', function() {
    const plan = planChange_(ss_(), {}, ownerWho, w1Change_('rb1', 'upsert', 'Speakers', 'w1_rb_ins', null, { name: '回滾測試甲' }), {});
    const code = w1CatchCode_(function() { commitPlans_([plan, poison], ownerWho, 'w1rb1'); });
    w1Assert_(code === 'validation', '毒計畫沒炸: ' + code);
    w1Assert_(!w1Find_('Speakers', 'w1_rb_ins', true), '回滾失敗：w1_rb_ins 還在表上');
    const traces = readTable_('AuditLog', true).filter(function(x) { return x.requestId === 'w1rb1'; });
    w1Assert_(traces.length === 0, 'AuditLog 留下 ' + traces.length + ' 筆孤兒');
    return '列已刪、無孤兒 audit';
  });

  t('C2', 'update 回滾：改值後中途炸 → 舊值原樣、version 未跳', function() {
    saveBatch(w1Env_([w1Change_('c1', 'upsert', 'Speakers', 'w1_rb_upd', null, { name: '回滾前原值' })]));
    const before = w1Find_('Speakers', 'w1_rb_upd', false);
    const plan = planChange_(ss_(), {}, ownerWho, w1Change_('rb2', 'upsert', 'Speakers', 'w1_rb_upd', w1Base_(before), { name: '不該留下的新值' }), {});
    const code = w1CatchCode_(function() { commitPlans_([plan, poison], ownerWho, 'w1rb2'); });
    w1Assert_(code === 'validation', '毒計畫沒炸: ' + code);
    const after = w1Find_('Speakers', 'w1_rb_upd', false);
    w1Assert_(after.name === '回滾前原值' && Number(after.version) === Number(before.version), '回滾失敗: ' + JSON.stringify(after));
    return '舊值還原、version 不動';
  });

  t('C3', '多筆 insert 回滾（同表兩列＋毒）→ 兩列全消、不留空列', function() {
    const shBefore = tableState_(ss_(), {}, 'Speakers').sheet.getLastRow();
    const p1 = planChange_(ss_(), {}, ownerWho, w1Change_('rb3a', 'upsert', 'Speakers', 'w1_rb_m1', null, { name: '多筆甲' }), {});
    const p2 = planChange_(ss_(), {}, ownerWho, w1Change_('rb3b', 'upsert', 'Speakers', 'w1_rb_m2', null, { name: '多筆乙' }), {});
    const code = w1CatchCode_(function() { commitPlans_([p1, p2, poison], ownerWho, 'w1rb3'); });
    w1Assert_(code === 'validation', '毒計畫沒炸: ' + code);
    w1Assert_(!w1Find_('Speakers', 'w1_rb_m1', true) && !w1Find_('Speakers', 'w1_rb_m2', true), '有列沒回滾');
    const shAfter = tableState_(ss_(), {}, 'Speakers').sheet.getLastRow();
    w1Assert_(shAfter === shBefore, 'lastRow ' + shBefore + '→' + shAfter + '（留了空列）');
    return '兩列全回滾、行數復原';
  });

  // ── 收尾：清測試資料（保留 TestResults 與 AuditLog 史）──
  var cleanupNote = 'OK';
  try { w1Cleanup_(); } catch (e) { cleanupNote = '清理失敗: ' + e.message; }

  const passed = results.filter(function(r) { return r.pass; }).length;
  const summary = {
    suite: 'W1', startedAt: startedAt, finishedAt: nowIso_(),
    passed: passed, failed: results.length - passed, total: results.length, cleanup: cleanupNote
  };
  w1WriteResults_(results, summary);
  Logger.log(JSON.stringify(summary));
  return summary;
}

/** 把目前執行者（＝擁有者本人）以 owner 身分放進 Users allowlist（id 固定、可重跑） */
function ensureSelfInUsers_() {
  const email = normalizeEmail_(Session.getActiveUser().getEmail() || '');
  if (!email) throw appError_('unauthenticated', '取不到執行者 email', false);
  const rows = readTable_('Users', true);
  const hit = rows.find(function(r) { return normalizeEmail_(r.email) === email; });
  if (hit && hit.role === 'owner' && !asBool_(hit.isDeleted)) return;
  upsertSeedRow_('Users', { id: 'user_owner_self', email: email, role: 'owner', note: 'W1 自動設定（擁有者本人）' }, nowIso_());
}

// ── 小工具（皆私有，google.script.run 呼叫不到）──

function w1Env_(changes) {
  return { schemaVersion: 1, clientBatchId: 'w1batch_' + Utilities.getUuid(), changes: changes };
}

function w1Change_(changeId, op, table, id, base, record) {
  const c = { changeId: changeId, op: op, table: table, id: id };
  if (base) c.base = base;
  if (record !== undefined) c.record = record;
  return c;
}

function w1Base_(rec) {
  return { updatedAt: String(rec.updatedAt || ''), version: Number(rec.version || 0) };
}

function w1Find_(table, id, includeDeleted) {
  return readTable_(table, includeDeleted).find(function(r) { return r.id === id; }) || null;
}

function w1Assert_(cond, msg) {
  if (!cond) throw new Error('斷言失敗：' + msg);
}

function w1CatchCode_(fn) {
  try { fn(); return 'NO_THROW'; } catch (e) { return e && e.code ? e.code : ('THROW:' + e.message); }
}

/** 刪掉 w1_ 前綴的測試列（實體刪列，dev Sheet 專用；由下往上刪防位移） */
function w1Cleanup_() {
  ['Speakers', 'Talks', 'Expenses'].forEach(function(table) {
    const state = tableState_(ss_(), {}, table);
    const rows = [];
    Object.keys(state.byId).forEach(function(id) {
      if (id.indexOf('w1_') === 0) rows.push(state.byId[id].rowIndex);
    });
    rows.sort(function(a, b) { return b - a; }).forEach(function(ri) { state.sheet.deleteRow(ri); });
  });
}

function w1WriteResults_(results, summary) {
  const ss = ss_();
  let sh = ss.getSheetByName(W1_RESULTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(W1_RESULTS_SHEET);
    sh.getRange(1, 1, 1, 6).setValues([['runAt', 'suite', 'caseId', 'name', 'result', 'detail']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  const runAt = summary.finishedAt;
  const rows = results.map(function(r) {
    return [runAt, 'W1', r.caseId, r.name, r.pass ? 'PASS' : 'FAIL', String(r.detail).slice(0, 1000)];
  });
  rows.push([runAt, 'W1', 'SUMMARY',
    'passed ' + summary.passed + '/' + summary.total + '（cleanup: ' + summary.cleanup + '）',
    summary.failed === 0 ? 'PASS' : 'FAIL',
    JSON.stringify({ startedAt: summary.startedAt, finishedAt: summary.finishedAt })]);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
}
