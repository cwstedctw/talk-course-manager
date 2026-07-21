/**
 * 演講管理台 v2 — 專案 A（私有管理台後端）
 * 契約基準：INTERFACE_CONTRACT.md v0.2.2。
 * 驗收：W1Tests.gs 的 runW1Suite() 與 V2CompletionTests.gs 的 runV2CompletionSuite()；只在 dev/staging Sheet 執行。
 */

const SHEET_ID_PROPERTY = 'SHEET_ID';
/* v2（2026-07-20，成果報告改版）：Talks +reportBlurb/evidenceJson/eventUuid、Speakers +education/experience、
   Settings +courseInstanceId；moeJson 值域改負責任 AI 六面向。既有 Sheet 由 migrateToV2()（Owner 執行）一次升版。 */
const SCHEMA_VERSION = 2;
const LOCK_WAIT_MS = 5000;
const MAX_PAYLOAD_CHARS = 500000;

const COMMON_FIELDS = ['id', 'updatedAt', 'updatedBy', 'version', 'isDeleted'];
const TABLE_ORDER = [
  'Speakers', 'Talks', 'Weeks', 'Tasks', 'Reimbursements',
  'BudgetLines', 'Expenses',
  'Submissions', 'Users', 'AuditLog', 'Settings'
];

/* v2 新欄位一律附加在各表尾端：欄位「位置」不可動（既有列按位置讀寫）。 */
const TABLE_FIELDS = {
  Speakers: ['name', 'title', 'org', 'field', 'email', 'phone', 'status', 'notes', 'education', 'experience'],
  Talks: ['no', 'status', 'date', 'time', 'venue', 'title', 'abstract', 'moeJson', 'speakerId', 'speakerName', 'speakerTitle', 'speakerOrg', 'speakerEmail', 'speakerPhone', 'notes', 'reportBlurb', 'evidenceJson', 'eventUuid'],
  Weeks: ['no', 'date', 'holiday', 'note', 'talkId'],
  Tasks: ['talkId', 'off', 'label', 'done', 'doneDate'],
  Reimbursements: ['talkId', 'hours', 'rate', 'transport', 'other', 'status', 'itemsJson', 'sentDate', 'paidDate', 'note'],
  BudgetLines: ['category', 'item', 'unitPrice', 'unit', 'qty', 'budgetAmount', 'note'],
  Expenses: ['budgetLineId', 'date', 'amount', 'desc', 'talkId', 'evidenceUrl', 'status'],
  Submissions: ['receivedAt', 'mode', 'name', 'contact', 'org', 'topicsJson', 'proposedTitle', 'preferredWeeksJson', 'anyWeek', 'message', 'recName', 'recOrg', 'recWhy', 'recContact', 'source', 'clientId', 'rawJson'],
  Users: ['email', 'role', 'note'],
  AuditLog: ['eventAt', 'actorEmail', 'actorRole', 'action', 'entityType', 'entityId', 'beforeVersion', 'afterVersion', 'requestId', 'result', 'detailJson'],
  Settings: ['key', 'valueJson']
};

/* W1 驗收修正：日期／時間類欄位一律鎖文字格式。
   實測 bug：seedFakeData 寫 '2026-09-15' 進 Talks.date，Sheets 自動轉 Date（cell 值變序號 46280），
   getValues 讀回 Date → cell_ 轉 ISO 變 '2026-09-14T16:00:00Z'——日期位移一天。真值必須原樣進出。 */
const TEXT_FORMAT_FIELDS = ['updatedAt', 'date', 'time', 'sentDate', 'paidDate', 'doneDate', 'receivedAt', 'eventAt',
  'phone', 'speakerPhone', 'contact', 'recContact'];

const SETTINGS_KEYS = ['schemaVersion', 'settings', 'checklistTpl', 'reimbTpl', 'templates', 'lastBackup', 'courseInstanceId'];

function sheetId_() {
  const id = String(
    PropertiesService.getScriptProperties().getProperty(SHEET_ID_PROPERTY) || ''
  ).trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(id)) {
    throw appError_('internal', 'SHEET_ID 指令碼屬性未設定或格式錯誤', false);
  }
  return id;
}

function ss_() {
  return SpreadsheetApp.openById(sheetId_());
}

/* 前端本機草稿的資料環境命名空間。只回不可逆摘要，不把 Sheet ID 暴露給瀏覽器。 */
function dataStoreKey_() {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'talk-course-manager:v2:' + sheetId_(),
    Utilities.Charset.UTF_8
  );
  return 'ds_' + bytes.map(function(b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('').slice(0, 24);
}

/** W5：HtmlService 服務管理台（Index.html＝admin-v2 前端，google.script.run 走 ApiGas）。
 *  身分與資料閘全在伺服器端 API（whoami/getSnapshot/saveBatch…）——doGet 只發皮，denied 開頁也拿不到資料。 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('演講課管理台 v2')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** P0 修：bootstrap/seed 僅限指令碼擁有者本人（編輯器執行或本人開頁）。
 *  防同網域訪客從 devtools 以 google.script.run 直呼（複驗 C1）。 */
function assertOwnerSelf_() {
  const active = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const effective = (Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (!active || active !== effective) throw appError_('unauthorized', '此函式僅限指令碼擁有者本人執行', false);
}

/**
 * 破壞性測試／重設只能在 dev 或 staging 專案明確開啟。
 * 正式專案不得設定 ALLOW_DESTRUCTIVE_TESTS=true。
 */
function assertDestructiveTestsAllowed_() {
  const allowed = PropertiesService.getScriptProperties().getProperty('ALLOW_DESTRUCTIVE_TESTS') === 'true';
  if (!allowed) {
    throw appError_(
      'unauthorized',
      '破壞性測試未啟用；只可在 dev/staging 設定 ALLOW_DESTRUCTIVE_TESTS=true',
      false
    );
  }
}

function bootstrapSchema() {
  assertOwnerSelf_();
  const ss = ss_();
  TABLE_ORDER.forEach(function(table) {
    const sh = ensureSheet_(ss, table);
    applyTextLocks_(sh, table);   // 既有分頁補鎖（migration）；新分頁在 ensureSheet_ 已鎖，重跑無害
  });
  return { ok: true, schemaVersion: SCHEMA_VERSION, serverTime: nowIso_(), sheets: TABLE_ORDER };
}

/**
 * 乾淨正式 Sheet 的一次性初始化：建 schema、把部署擁有者列為 Owner、
 * 寫入 schemaVersion 與官方經費科目。刻意不建立任何講者、場次或報名假資料。
 * 可重跑；同一 email 與固定 seed id 會更新，不會一直新增。
 */
function bootstrapProduction(options) {
  return withScriptLock_(function() {
    assertOwnerSelf_();
    const input = sanitizeObject_(options || {}, ['overwriteExisting']);
    const overwriteExisting = input.overwriteExisting === true;
    if (overwriteExisting) assertDestructiveTestsAllowed_();
    bootstrapSchema();

    const email = normalizeEmail_(Session.getActiveUser().getEmail() || '');
    if (!email) throw appError_('unauthenticated', '取不到部署擁有者 email', false);
    const who = { email: email, role: 'owner' };
    const ss = ss_();
    const cache = {};
    const plans = [];

    const users = tableState_(ss, cache, 'Users');
    const userIds = Object.keys(users.byId);
    let ownerHit = null;
    for (let i = 0; i < userIds.length; i += 1) {
      const candidate = users.byId[userIds[i]];
      if (normalizeEmail_(candidate.record.email) === email) {
        ownerHit = candidate;
        break;
      }
    }
    let ownerId = ownerHit ? ownerHit.record.id : 'user_owner_self';
    if (!ownerHit && users.byId[ownerId]) ownerId = 'user_owner_' + Utilities.getUuid();
    const ownerAfter = ownerHit ? clone_(ownerHit.record) : blankRecord_('Users');
    ownerAfter.email = email;
    ownerAfter.role = 'owner';
    ownerAfter.note = ownerHit && ownerHit.record.note ? ownerHit.record.note : '正式版部署擁有者';
    ownerAfter.isDeleted = false;
    validateMergedRecord_('Users', ownerAfter, ownerId);
    plans.push(makePlan_(
      'bootstrap-owner-' + Utilities.getUuid(),
      'schemaMigrate',
      'Users',
      ownerId,
      ownerHit,
      ownerAfter,
      ['email', 'role', 'note', 'isDeleted']
    ));

    const settings = tableState_(ss, cache, 'Settings');
    const settingIds = Object.keys(settings.byId);
    let schemaHit = null;
    for (let j = 0; j < settingIds.length; j += 1) {
      const candidate = settings.byId[settingIds[j]];
      if (candidate.record.key === 'schemaVersion') {
        schemaHit = candidate;
        break;
      }
    }
    let schemaId = schemaHit ? schemaHit.record.id : 'set_schemaVersion';
    if (!schemaHit && settings.byId[schemaId]) schemaId = 'set_schemaVersion_' + Utilities.getUuid();
    const schemaAfter = schemaHit ? clone_(schemaHit.record) : blankRecord_('Settings');
    schemaAfter.key = 'schemaVersion';
    schemaAfter.valueJson = String(SCHEMA_VERSION);
    schemaAfter.isDeleted = false;
    validateMergedRecord_('Settings', schemaAfter, schemaId);
    const schemaPlan = makePlan_(
      'bootstrap-schema-' + Utilities.getUuid(),
      'schemaMigrate',
      'Settings',
      schemaId,
      schemaHit,
      schemaAfter,
      ['key', 'valueJson', 'isDeleted']
    );
    plans.push(schemaPlan);

    const budgetState = tableState_(ss, cache, 'BudgetLines');
    const lines = officialBudgetLines_();
    let budgetCreated = 0;
    let budgetReset = 0;
    let budgetPreserved = 0;
    lines.forEach(function(line) {
      const hit = budgetState.byId[line.id] || null;
      if (hit && !overwriteExisting) {
        budgetPreserved += 1;
        return;
      }
      const after = blankRecord_('BudgetLines');
      after.category = '';
      after.item = line.item;
      after.unitPrice = '';
      after.unit = '';
      after.qty = '';
      after.budgetAmount = line.budgetAmount;
      after.note = line.note;
      after.isDeleted = false;
      validateMergedRecord_('BudgetLines', after, line.id);
      plans.push(makePlan_(
        'bootstrap-budget-' + Utilities.getUuid(),
        'schemaMigrate',
        'BudgetLines',
        line.id,
        hit,
        after,
        ['category', 'item', 'unitPrice', 'unit', 'qty', 'budgetAmount', 'note', 'isDeleted']
      ));
      if (hit) budgetReset += 1;
      else budgetCreated += 1;
    });

    schemaPlan.auditDetail = {
      bootstrapProduction: true,
      overwriteExisting: overwriteExisting,
      budgetCreated: budgetCreated,
      budgetReset: budgetReset,
      budgetPreserved: budgetPreserved
    };
    const committed = commitPlans_(plans, who, 'bootstrapProduction:' + Utilities.getUuid());
    return {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      owner: email,
      budgetLineCount: lines.length,
      budgetTotal: lines.reduce(function(total, line) { return total + line.budgetAmount; }, 0),
      budgetCreated: budgetCreated,
      budgetReset: budgetReset,
      budgetPreserved: budgetPreserved,
      overwriteExisting: overwriteExisting,
      auditLogIds: committed.auditLogIds,
      serverTime: nowIso_()
    };
  });
}

/**
 * schema v1 → v2 一次性遷移（Owner 在 Apps Script 編輯器執行；冪等、可重跑）：
 * 1) bootstrapSchema()：新欄位寫進表頭並套文字鎖（欄位一律附加尾端，位置不動）。
 * 2) Talks（含軟刪除列）：moeJson 舊值轉負責任 AI 六面向——legal/ethical→b1_ethics 併同去重；
 *    application 無對應面向、自 moeJson 移除並記到 notes；eventUuid 空值補 ev_+UUID。
 * 3) Settings：schemaVersion → '2'；courseInstanceId 不存在則種入 ci_+UUID。
 * 全程走 commitPlans_（AuditLog action=schemaMigrate、失敗 rollback）。
 */
function migrateToV2() {
  return withScriptLock_(function() {
    assertOwnerSelf_();
    bootstrapSchema();
    const email = normalizeEmail_(Session.getActiveUser().getEmail() || '');
    if (!email) throw appError_('unauthenticated', '取不到執行者 email', false);
    const who = { email: email, role: 'owner' };
    const ss = ss_();
    const cache = {};
    const plans = [];
    const moeMap = { legal: 'b1_ethics', ethical: 'b1_ethics' };
    const allowedMoe = ['b1_ethics', 'b1_rights', 'b2_risk', 'b2_verify', 'b3_impact', 'b3_account'];
    let talksMigrated = 0;
    let applicationMoved = 0;

    const talks = tableState_(ss, cache, 'Talks');
    Object.keys(talks.byId).forEach(function(id) {
      const hit = talks.byId[id];
      const before = hit.record;
      let moe = [];
      try { moe = JSON.parse(String(before.moeJson || '[]')); } catch (e) { moe = []; }
      if (!Array.isArray(moe)) moe = [];
      const out = [];
      let hadApplication = false;
      moe.forEach(function(k) {
        if (typeof k !== 'string') return;
        if (k === 'application') { hadApplication = true; return; }
        const nk = moeMap[k] || k;
        if (allowedMoe.indexOf(nk) !== -1 && out.indexOf(nk) === -1) out.push(nk);
      });
      const newMoeJson = JSON.stringify(out);
      const changed = [];
      const after = clone_(before);
      if (newMoeJson !== String(before.moeJson || '[]')) { after.moeJson = newMoeJson; changed.push('moeJson'); }
      if (hadApplication) {
        after.notes = joinNotes_(String(before.notes || ''), '【舊指標】應用（2026-07-20 指標改版，請改勾負責任 AI 六面向）', 500);
        changed.push('notes');
        applicationMoved += 1;
      }
      if (!cleanString_(before.eventUuid || '').trim()) {
        after.eventUuid = 'ev_' + Utilities.getUuid();
        changed.push('eventUuid');
      }
      if (!changed.length) return;
      plans.push(makePlan_('migrate-talk-' + id, 'schemaMigrate', 'Talks', id, hit, after, changed));
      talksMigrated += 1;
    });

    const settings = tableState_(ss, cache, 'Settings');
    const findKey = function(key) {
      const ids = Object.keys(settings.byId);
      for (let i = 0; i < ids.length; i += 1) {
        if (settings.byId[ids[i]].record.key === key) return settings.byId[ids[i]];
      }
      return null;
    };
    const schemaHit = findKey('schemaVersion');
    if (!schemaHit || String(schemaHit.record.valueJson) !== String(SCHEMA_VERSION)) {
      const schemaId = schemaHit ? schemaHit.record.id : 'set_schemaVersion';
      const schemaAfter = schemaHit ? clone_(schemaHit.record) : blankRecord_('Settings');
      schemaAfter.key = 'schemaVersion';
      schemaAfter.valueJson = String(SCHEMA_VERSION);
      schemaAfter.isDeleted = false;
      validateMergedRecord_('Settings', schemaAfter, schemaId);
      plans.push(makePlan_('migrate-schemaVersion', 'schemaMigrate', 'Settings', schemaId, schemaHit, schemaAfter, ['key', 'valueJson', 'isDeleted']));
    }
    if (!findKey('courseInstanceId')) {
      const ciAfter = blankRecord_('Settings');
      ciAfter.key = 'courseInstanceId';
      ciAfter.valueJson = JSON.stringify('ci_' + Utilities.getUuid());
      ciAfter.isDeleted = false;
      validateMergedRecord_('Settings', ciAfter, 'set_courseInstanceId');
      plans.push(makePlan_('migrate-courseInstanceId', 'schemaMigrate', 'Settings', 'set_courseInstanceId', null, ciAfter, ['key', 'valueJson', 'isDeleted']));
    }

    if (!plans.length) {
      return { ok: true, schemaVersion: SCHEMA_VERSION, talksMigrated: 0, applicationMoved: 0, note: '已是 v2、無需變更', serverTime: nowIso_() };
    }
    const committed = commitPlans_(plans, who, 'migrateToV2:' + Utilities.getUuid());
    return {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      talksMigrated: talksMigrated,
      applicationMoved: applicationMoved,
      settingsPlans: plans.length,
      auditLogIds: committed.auditLogIds,
      serverTime: nowIso_()
    };
  });
}

function seedFakeData() {
  assertOwnerSelf_();
  assertDestructiveTestsAllowed_();
  bootstrapSchema();
  const now = nowIso_();
  const seedByTable = {
    Speakers: [{ id: 'spk_fake_001', name: '測試講者', title: '助理教授', org: '範例大學', field: '人工智慧', email: 'speaker@example.invalid', phone: '', status: '接洽中', notes: '假資料，無真個資' }],   // status 用講者 CRM 字彙（W2 抓到：原「邀約中」是場次字彙，會被前端 enum 矯正成幽靈 diff
    Talks: [{ id: 'talk_fake_001', no: 1, status: '構想中', date: '2026-09-15', time: '10:00-12:00', venue: '理工二館 ZT講堂 C101', title: 'AI 與未來社會', abstract: '假資料摘要', moeJson: '["b1_ethics"]', speakerId: 'spk_fake_001', speakerName: '測試講者', speakerTitle: '助理教授', speakerOrg: '範例大學', speakerEmail: 'speaker@example.invalid', speakerPhone: '', notes: '假資料', reportBlurb: '', evidenceJson: '', eventUuid: 'ev_fake_001' }],
    Weeks: [{ id: 'week_fake_001', no: 1, date: '2026-09-15', holiday: '', note: '假排程', talkId: 'talk_fake_001' }],
    Tasks: [{ id: 'task_fake_001', talkId: 'talk_fake_001', off: -14, label: '寄送邀請信', done: false, doneDate: '' }],
    Reimbursements: [{ id: 'reimb_fake_001', talkId: 'talk_fake_001', hours: 2, rate: 2000, transport: 0, other: 0, status: '未開始', itemsJson: '[]', sentDate: '', paidDate: '', note: '假資料' }],
    Expenses: [{ id: 'exp_fake_001', budgetLineId: 'bl_misc', date: '2026-09-20', amount: 500, desc: '假支出：講義影印', talkId: '', evidenceUrl: '', status: '未開始' }],
    Submissions: [{ id: 'sub_fake_001', receivedAt: now, mode: 'self', name: '範例投稿者', contact: 'submitter@example.invalid', org: '範例單位', topicsJson: '["AI"]', proposedTitle: '範例題目', preferredWeeksJson: '[]', anyWeek: true, message: '假資料', recName: '', recOrg: '', recWhy: '', recContact: '', source: 'seedFakeData', clientId: 'fake-client', rawJson: '{}' }],
    Users: [{ id: 'user_fake_owner', email: 'owner@example.invalid', role: 'owner', note: '請改為部署擁有者的真實學校帳號' }, { id: 'user_fake_editor', email: 'editor@example.invalid', role: 'editor', note: '請改為助理或 TA 的真實學校帳號' }],
    Settings: [
      { id: 'set_schemaVersion', key: 'schemaVersion', valueJson: '2' },
      { id: 'set_courseInstanceId', key: 'courseInstanceId', valueJson: '"ci_fake_115_1"' },
      /* 課程參數真值＝v1 COURSE_PROFILE.course（前端 defaultSettings() 同源；W2 起 settings 鍵展開照 v1 全鍵） */
      { id: 'set_settings', key: 'settings', valueJson: JSON.stringify({ courseName: 'AI 未來應用與趨勢探索（示範課）', shortName: 'AI未來應用與趨勢探索', semester: '115-1', weekday: '週五 第 4–6 節・09:10–12:00', room: '理工二館 ZT講堂 C101', school: '示範大學', organizer: '王示範', fundSource: '（示範）教育部AA計畫補助', talkWindow: '09:30–11:30', talkDayFlow: '09:10 課程開場與講者介紹 → 09:30–11:30 專題演講 → 11:30–12:00 Q&A 交流與收尾', arriveBy: '09:15', defaultHours: 3, defaultRate: 2000, budgetTotal: 0, hubStartTime: '09:30', signRows: 45 }) },
      { id: 'set_checklistTpl', key: 'checklistTpl', valueJson: '[]' },
      { id: 'set_reimbTpl', key: 'reimbTpl', valueJson: '{}' },
      { id: 'set_templates', key: 'templates', valueJson: '{}' },
      { id: 'set_lastBackup', key: 'lastBackup', valueJson: 'null' }
    ],
    AuditLog: [{ id: 'log_seed_fake_001', eventAt: now, actorEmail: 'seed@example.invalid', actorRole: 'owner', action: 'schemaMigrate', entityType: 'Settings', entityId: 'set_schemaVersion', beforeVersion: 0, afterVersion: 1, requestId: 'seedFakeData', result: 'ok', detailJson: '{"note":"fake seed"}' }]
  };

  Object.keys(seedByTable).forEach(function(table) {
    seedByTable[table].forEach(function(r) { upsertSeedRow_(table, r, now); });
  });
  return { ok: true, schemaVersion: SCHEMA_VERSION, serverTime: nowIso_() };
}

/** 「執行經費表」12 科目種子（示範金額，clone 後請照你的核定經費表逐科目改）：id 沿用 demo BUDGET_LINES 的 k 鍵，前端對照零轉換。
 *  示範合計 300,000；預設只補缺少 id，不覆寫已調整科目；測試或明確重設才傳 {overwriteExisting:true}。 */
function seedBudgetLinesOfficial(options) {
  return withScriptLock_(function() {
    assertOwnerSelf_();
    const input = sanitizeObject_(options || {}, ['overwriteExisting']);
    const overwriteExisting = input.overwriteExisting === true;
    if (overwriteExisting) assertDestructiveTestsAllowed_();
    bootstrapSchema();
    const now = nowIso_();
    const lines = officialBudgetLines_();
    const state = tableState_(ss_(), {}, 'BudgetLines');
    let created = 0;
    let reset = 0;
    let preserved = 0;
    lines.forEach(function(l) {
      const hit = state.byId[l.id] || null;
      if (hit && !overwriteExisting) {
        preserved += 1;
        return;
      }
      upsertSeedRow_('BudgetLines', { id: l.id, category: '', item: l.item, unitPrice: '', unit: '', qty: '', budgetAmount: l.budgetAmount, note: l.note }, now);
      if (hit) reset += 1;
      else created += 1;
    });
    return {
      ok: true,
      count: lines.length,
      total: lines.reduce(function(s, l) { return s + l.budgetAmount; }, 0),
      created: created,
      reset: reset,
      preserved: preserved,
      overwriteExisting: overwriteExisting
    };
  });
}

function officialBudgetLines_() {
  return [
    { id: 'bl_fee',       item: '講座鐘點費',     budgetAmount: 100000, note: '由場次資料自動彙總（已完成／已入帳）' },
    { id: 'bl_fee_nhi',   item: '講座二代健保',   budgetAmount: 2110,   note: '由場次資料自動彙總（鐘點費×2.11%，四捨五入）' },
    { id: 'bl_trans',     item: '講師交通費',     budgetAmount: 20000,  note: '' },
    { id: 'bl_temp',      item: '臨時人員費',     budgetAmount: 40000,  note: '' },
    { id: 'bl_temp_ins',  item: '臨時人員勞健退', budgetAmount: 8000,   note: '' },
    { id: 'bl_host',      item: '主持費',         budgetAmount: 12000,  note: '' },
    { id: 'bl_host_nhi',  item: '主持費二代健保', budgetAmount: 253,    note: '' },
    { id: 'bl_guide',     item: '指導費',         budgetAmount: 12000,  note: '' },
    { id: 'bl_guide_nhi', item: '指導費二代健保', budgetAmount: 253,    note: '' },
    { id: 'bl_print',     item: '印刷費',         budgetAmount: 50000,  note: '' },
    { id: 'bl_misc',      item: '雜支',           budgetAmount: 28384,  note: '' },
    { id: 'bl_admin',     item: '行政管理費',     budgetAmount: 27000,  note: '' }
  ];
}

function whoami() {
  try {
    const who = resolveUser_();
    const base = { schemaVersion: SCHEMA_VERSION, serverTime: nowIso_() };
    if (!who.email) return Object.assign({ ok: false, error: errObj_('unauthenticated', '無法取得登入身分', false), role: 'denied', permissions: [] }, base);
    if (who.role !== 'owner' && who.role !== 'editor') {
      auditDeniedSafe_(who, 'loginDenied');
      return Object.assign({ ok: false, error: errObj_('unauthorized', '不在 Users allowlist 或角色不足', false), role: 'denied', permissions: [] }, base);   /* P1 修：denied 不回 email（契約「不回資料」；複驗 B1） */
    }
    return Object.assign({
      ok: true,
      email: who.email,
      role: who.role,
      permissions: permissionsFor_(who.role),
      dataStoreKey: dataStoreKey_()
    }, base);
  } catch (e) {
    return handleError_(e);
  }
}

function getSnapshot(args) {
  return withScriptLock_(function() {
    const ss = ss_();
    const who = authorize_(['owner', 'editor'], 'getSnapshot', ss);
    const input = sanitizeObject_(args || {}, ['includeDeleted']);
    /* 已刪資料可能仍含聯絡資訊，只有 Owner 可以要求讀取。 */
    const includeDeleted = who.role === 'owner' && input.includeDeleted === true;
    return buildSnapshot_(who, includeDeleted, ss);
  });
}

/* 開機專用：身分、權限與快照一次回傳，省掉第二次 Apps Script 冷啟動與網路往返。 */
function getBootstrap(args) {
  return withScriptLock_(function() {
    const ss = ss_();
    const who = authorize_(['owner', 'editor'], 'getBootstrap', ss);
    const input = sanitizeObject_(args || {}, ['includeDeleted']);
    const includeDeleted = who.role === 'owner' && input.includeDeleted === true;
    return Object.assign({
      ok: true,
      email: who.email,
      role: who.role,
      permissions: permissionsFor_(who.role),
      dataStoreKey: dataStoreKey_()
    }, buildSnapshot_(who, includeDeleted, ss));
  });
}

function buildSnapshot_(who, includeDeleted, ss) {
  const generatedAt = nowIso_();
  const tables = {};
  snapshotTablesForRole_(who.role).forEach(function(table) {
    tables[table] = readTable_(table, includeDeleted, ss);
  });
  /* 維持固定 envelope，Editor 看不到的伺服器管理表以空陣列表示。 */
  TABLE_ORDER.forEach(function(table) {
    if (!Object.prototype.hasOwnProperty.call(tables, table)) tables[table] = [];
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt,
    serverTime: generatedAt,
    tables: tables
  };
}

function snapshotTablesForRole_(role) {
  if (role === 'owner') return TABLE_ORDER.slice();
  if (role === 'editor') {
    return TABLE_ORDER.filter(function(table) {
      return table !== 'Users' && table !== 'AuditLog';
    });
  }
  return [];
}

function saveBatch(envelope) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return errorEnvelope_('busy', '系統忙碌，請稍後重試', true, { retryAfterSec: 5 });

  try {
    const who = authorize_(['owner', 'editor'], 'saveBatch');
    if (JSON.stringify(envelope || {}).length > MAX_PAYLOAD_CHARS) throw appError_('payload_too_large', 'payload 超限', false);

    const env = sanitizeObject_(envelope || {}, ['schemaVersion', 'clientBatchId', 'changes']);
    if (Number(env.schemaVersion) !== SCHEMA_VERSION) throw appError_('schema_mismatch', 'schemaVersion 不符', false);
    const clientBatchId = sanitizeId_(env.clientBatchId || Utilities.getUuid(), 'clientBatchId');
    if (!Array.isArray(env.changes) || env.changes.length === 0) throw appError_('validation', 'changes 必須為非空陣列', false);
    /* P0 修：單批上限——防大批次撞 6 分鐘牆讓 rollback 完全不執行（複驗 1.5／C4）；前端拆批 */
    if (env.changes.length > 50) throw appError_('validation', '單批最多 50 筆變更，請拆批送出', false);

    const ss = ss_();
    const cache = {};
    const seen = {};
    const plans = [];
    const conflicts = [];

    env.changes.forEach(function(change) {
      const plan = planChange_(ss, cache, who, change, seen);
      if (plan.conflict) conflicts.push(plan.conflict);
      else plans.push(plan);
    });

    if (conflicts.length) {
      return { ok: false, error: errObj_('conflict', '資料已被其他使用者更新', false), conflicts: conflicts };
    }

    const committed = commitPlans_(plans, who, clientBatchId);
    return {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      serverTime: nowIso_(),
      accepted: committed.accepted,
      auditLogIds: committed.auditLogIds
    };
  } catch (e) {
    return handleError_(e);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 將一筆公開報名轉入講者庫或既有場次，並在同一交易中軟刪除原收件。
 * Submissions 對管理台維持唯讀；只能走這條伺服器端路徑。
 */
function importSubmission(payload) {
  return withScriptLock_(function() {
    const who = authorize_(['owner', 'editor'], 'importSubmission');
    const input = sanitizeObject_(payload || {}, ['submissionId', 'target', 'patch']);
    const submissionId = sanitizeId_(input.submissionId, 'submissionId');
    const target = sanitizeImportTarget_(input.target);
    const ss = ss_();
    const cache = {};
    const submissionHit = tableState_(ss, cache, 'Submissions').byId[submissionId] || null;

    if (!submissionHit || asBool_(submissionHit.record.isDeleted)) {
      throw appError_('not_found', '指定報名不存在或已處理', false);
    }

    const submission = clone_(submissionHit.record);
    assertSubmissionContentNoPii_(submission);

    const targetState = tableState_(ss, cache, target.table);
    let targetHit = null;
    let targetId = target.id || '';

    if (targetId) {
      targetHit = targetState.byId[targetId] || null;
      if (!targetHit || asBool_(targetHit.record.isDeleted)) {
        throw appError_('not_found', '指定轉入目標不存在或已刪除', false);
      }
    } else {
      targetId = 'spk_' + Utilities.getUuid();
    }

    const before = targetHit ? clone_(targetHit.record) : null;
    const converted = sanitizeRecord_(target.table, convertSubmission_(submission, target.table, before));
    const patch = sanitizeRecord_(target.table, input.patch || {});
    const after = before ? clone_(before) : blankRecord_(target.table);

    Object.keys(converted).forEach(function(field) { after[field] = converted[field]; });
    Object.keys(patch).forEach(function(field) { after[field] = patch[field]; });
    after.isDeleted = false;
    validateMergedRecord_(target.table, after, targetId);

    const targetPlan = makePlan_(
      'import-target-' + Utilities.getUuid(),
      'importSubmission',
      target.table,
      targetId,
      targetHit,
      after,
      unique_(Object.keys(converted).concat(Object.keys(patch)))
    );

    const submissionAfter = clone_(submission);
    submissionAfter.isDeleted = true;
    const sourcePlan = makePlan_(
      'import-source-' + Utilities.getUuid(),
      'softDelete',
      'Submissions',
      submissionId,
      submissionHit,
      submissionAfter,
      ['isDeleted']
    );

    const committed = commitPlans_(
      [targetPlan, sourcePlan],
      who,
      'importSubmission:' + Utilities.getUuid()
    );

    return {
      ok: true,
      createdIds: targetHit ? [] : [targetId],
      updatedIds: targetHit ? [targetId] : [],
      auditLogIds: committed.auditLogIds
    };
  });
}

/** 將不採用或測試報名標為已處理，保留 AuditLog，不做實體刪除。 */
function dismissSubmission(payload) {
  return withScriptLock_(function() {
    const who = authorize_(['owner', 'editor'], 'dismissSubmission');
    const input = sanitizeObject_(payload || {}, ['submissionId', 'reason']);
    const submissionId = sanitizeId_(input.submissionId, 'submissionId');
    const reason = plainText_(input.reason || '', 'reason', 300);
    const state = tableState_(ss_(), {}, 'Submissions');
    const hit = state.byId[submissionId] || null;

    if (!hit || asBool_(hit.record.isDeleted)) {
      throw appError_('not_found', '指定報名不存在或已處理', false);
    }

    const after = clone_(hit.record);
    after.isDeleted = true;
    const plan = makePlan_(
      'dismiss-source-' + Utilities.getUuid(),
      'dismissSubmission',
      'Submissions',
      submissionId,
      hit,
      after,
      ['isDeleted']
    );
    /* AuditLog 只留安全摘要，避免使用者把聯絡方式或其他敏感文字填進略過理由。 */
    if (reason) plan.auditDetail = { reasonProvided: true, reasonLength: reason.length };
    const requestId = 'dismissSubmission:' + Utilities.getUuid();
    const committed = commitPlans_([plan], who, requestId);

    return { ok: true, dismissedId: submissionId, auditLogIds: committed.auditLogIds };
  });
}

// Phase 1 v0 stub：未來須沿用 Hub talks.schema.json，且不得輸出 email/phone/核銷/行政進度。
function exportPublicTalks() {
  return stub_('exportPublicTalks', ['owner', 'editor'], {}, []);
}

// Phase 1 v0 stub：永久備份只限 Owner；每日 trigger 規格待定。
function backup(payload) {
  return stub_('backup', ['owner'], payload || {}, ['reason']);
}

// Phase 1 v0 stub：只預覽、不寫入；PII pattern 掃描規格待定。
function restorePreview(payload) {
  return stub_('restorePreview', ['owner'], payload || {}, ['backupJson']);
}

// Phase 1 v0 stub：永久刪除只限 Owner。
function purgeDeleted(payload) {
  return stub_('purgeDeleted', ['owner'], payload || {}, ['table', 'ids', 'before']);
}

function planChange_(ss, cache, who, rawChange, seen) {
  const change = sanitizeObject_(rawChange || {}, ['changeId', 'op', 'table', 'id', 'base', 'record']);
  const changeId = sanitizeId_(change.changeId, 'changeId');
  const op = sanitizeEnum_(change.op, ['upsert', 'softDelete'], 'op');
  const table = sanitizeEnum_(change.table, TABLE_ORDER, 'table');
  const id = sanitizeId_(change.id, 'id');
  const key = table + ':' + id;

  if (seen[key]) throw appError_('validation', '同一批不可重複修改同一筆資料', false);
  seen[key] = true;
  assertWritable_(table, who.role);

  const state = tableState_(ss, cache, table);
  const existing = state.byId[id] || null;
  const base = sanitizeBase_(change.base || {});
  const clientRecord = op === 'upsert' ? sanitizeRecord_(table, change.record || {}) : {};

  if (op === 'softDelete' && !existing) throw appError_('not_found', '指定 id 不存在或已 purge', false);
  if (existing && !baseMatches_(base, existing.record)) {
    return { conflict: conflict_(changeId, table, id, 'stale_record', base, existing.record, clientRecord) };
  }
  if (!existing && baseHasVersion_(base)) throw appError_('not_found', '指定 id 不存在或已 purge', false);

  const before = existing ? clone_(existing.record) : null;
  const after = existing ? clone_(existing.record) : blankRecord_(table);
  if (op === 'upsert') {
    Object.keys(clientRecord).forEach(function(field) { after[field] = clientRecord[field]; });
    after.isDeleted = false;
  } else {
    if (change.record !== undefined) throw appError_('validation', 'softDelete 不接受 record', false);
    after.isDeleted = true;
  }

  /* v2：eventUuid 伺服器所有——更新一律保留既有值（client 傳空值不得抹掉）、新列或舊列空值由伺服器補發 */
  if (table === 'Talks' && op === 'upsert') {
    const keepUuid = existing ? cleanString_(existing.record.eventUuid || '').trim() : '';
    after.eventUuid = keepUuid || cleanString_(after.eventUuid || '').trim() || ('ev_' + Utilities.getUuid());
  }

  validateMergedRecord_(table, after, id);
  return {
    changeId: changeId,
    op: op,
    action: existing ? (op === 'softDelete' ? 'softDelete' : 'update') : 'create',
    table: table,
    id: id,
    rowIndex: existing ? existing.rowIndex : null,
    before: before,
    after: after,
    changedFields: op === 'softDelete' ? ['isDeleted'] : Object.keys(clientRecord)
  };
}

function commitPlans_(plans, who, requestId) {
  const ss = ss_();
  const rollback = [];
  const accepted = [];
  const auditLogIds = [];
  const stamp = nowIso_();

  try {
    plans.forEach(function(plan) {
      const sh = ensureSheet_(ss, plan.table);
      const headers = schemaHeaders_(plan.table);
      const beforeVersion = plan.before ? Number(plan.before.version || 0) : 0;

      plan.after.id = plan.id;
      plan.after.updatedAt = stamp;
      plan.after.updatedBy = who.email;
      plan.after.version = beforeVersion + 1;

      const row = headers.map(function(h) { return plan.after[h] === undefined ? '' : plan.after[h]; });
      if (plan.rowIndex) {
        const old = sh.getRange(plan.rowIndex, 1, 1, headers.length).getValues()[0];
        rollback.push({ type: 'update', sheet: sh, rowIndex: plan.rowIndex, values: old, width: headers.length });
        textLockRow_(sh, plan.table, plan.rowIndex);   /* P0 修＋W1 擴充：寫入前鎖該列全部文字欄（自動擴列不延續欄格式，複驗 1.1） */
        sh.getRange(plan.rowIndex, 1, 1, headers.length).setValues([row]);
      } else {
        const rowIndex = sh.getLastRow() + 1;
        rollback.push({ type: 'insert', sheet: sh, rowIndex: rowIndex });
        textLockRow_(sh, plan.table, rowIndex);
        sh.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
      }

      accepted.push({ changeId: plan.changeId, table: plan.table, id: plan.id, updatedAt: stamp, updatedBy: who.email, version: plan.after.version });
    });

    plans.forEach(function(plan) {
      const id = appendAuditLog_(who, {
        eventAt: stamp,
        action: plan.action,
        entityType: plan.table,
        entityId: plan.id,
        beforeVersion: plan.before ? Number(plan.before.version || 0) : 0,
        afterVersion: Number(plan.after.version || 0),
        requestId: requestId,
        result: 'ok',
        detailJson: JSON.stringify({
          changeId: plan.changeId,
          changedFields: plan.changedFields,
          context: plan.auditDetail || undefined
        })
      }, rollback);
      auditLogIds.push(id);
    });

    SpreadsheetApp.flush();
    return { accepted: accepted, auditLogIds: auditLogIds };
  } catch (e) {
    rollback.reverse().forEach(function(r) {
      if (r.type === 'update') r.sheet.getRange(r.rowIndex, 1, 1, r.width).setValues([r.values]);
      if (r.type === 'insert') r.sheet.deleteRow(r.rowIndex);
    });
    throw e;
  }
}

function appendAuditLog_(who, entry, rollback) {
  const sh = ensureSheet_(ss_(), 'AuditLog');
  const headers = schemaHeaders_('AuditLog');
  const id = 'log_' + Utilities.getUuid();
  const record = blankRecord_('AuditLog');
  record.id = id;
  record.updatedAt = entry.eventAt;
  record.updatedBy = who.email || '';
  record.version = 1;
  record.isDeleted = false;
  record.eventAt = entry.eventAt;
  record.actorEmail = who.email || '';
  record.actorRole = who.role || 'denied';
  record.action = entry.action;
  record.entityType = entry.entityType;
  record.entityId = entry.entityId || '';
  record.beforeVersion = entry.beforeVersion;
  record.afterVersion = entry.afterVersion;
  record.requestId = entry.requestId || '';
  record.result = entry.result;
  record.detailJson = entry.detailJson || '{}';

  const rowIndex = sh.getLastRow() + 1;
  if (rollback) rollback.push({ type: 'insert', sheet: sh, rowIndex: rowIndex });
  textLockRow_(sh, 'AuditLog', rowIndex);
  sh.getRange(rowIndex, 1, 1, headers.length).setValues([headers.map(function(h) { return record[h] === undefined ? '' : record[h]; })]);
  return id;
}

function resolveUser_(ss) {
  const email = normalizeEmail_(Session.getActiveUser().getEmail() || '');
  if (!email) return { email: '', role: 'denied' };

  const rows = readTable_('Users', false, ss);
  const hit = rows.find(function(r) { return normalizeEmail_(r.email) === email; });
  if (!hit) return { email: email, role: 'denied' };
  const role = String(hit.role || '').trim().toLowerCase();
  return { email: email, role: role === 'owner' ? 'owner' : (role === 'editor' ? 'editor' : 'denied') };
}

function authorize_(roles, action, ss) {
  const who = resolveUser_(ss);
  if (!who.email) throw appError_('unauthenticated', '無法取得登入身分', false);
  if (roles.indexOf(who.role) === -1) {
    auditDeniedSafe_(who, action || 'loginDenied');
    throw appError_('unauthorized', '不在 Users allowlist 或角色不足', false);
  }
  return who;
}

function auditDeniedSafe_(who, action) {
  try {
    /* P1 修：CacheService 節流——同帳號 10 分鐘只留一筆 denied，防同網域帳號灌爆 AuditLog（複驗 3.1–3.3） */
    if (!who.email) return;
    const cache = CacheService.getScriptCache();
    const cacheKey = 'denied_limit:' + who.email;
    if (cache.get(cacheKey)) return;
    cache.put(cacheKey, '1', 600);
    appendAuditLog_(who, {
      eventAt: nowIso_(),
      action: 'loginDenied',
      entityType: 'Users',
      entityId: '',
      beforeVersion: '',
      afterVersion: '',
      requestId: action || 'denied',
      result: 'unauthorized',
      detailJson: JSON.stringify({ action: action || 'denied' })
    });
  } catch (e) {}
}

function stub_(name, roles, payload, allowedFields) {
  try {
    authorize_(roles, name);
    sanitizeObject_(payload || {}, allowedFields);
    return errorEnvelope_('not_implemented', name + ' 尚未實作', false);
  } catch (e) {
    return handleError_(e);
  }
}

function withScriptLock_(work) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return errorEnvelope_('busy', '系統忙碌，請稍後重試', true, { retryAfterSec: 5 });
  }
  try {
    return work();
  } catch (e) {
    return handleError_(e);
  } finally {
    lock.releaseLock();
  }
}

function sanitizeImportTarget_(value) {
  const raw = sanitizeObject_(value || {}, ['type', 'id']);
  const type = sanitizeEnum_(cleanString_(raw.type || '').trim(), ['speaker', 'talk'], 'target.type');
  const id = raw.id ? sanitizeId_(raw.id, 'target.id') : '';
  if (type === 'talk' && !id) throw appError_('validation', '轉入場次需要 target.id', false);
  return { table: type === 'talk' ? 'Talks' : 'Speakers', id: id };
}

function convertSubmission_(submission, table, existing) {
  const mode = sanitizeEnum_(submission.mode || 'self', ['self', 'recommend'], 'Submissions.mode');
  const isRecommend = mode === 'recommend';
  const name = plainText_(isRecommend ? submission.recName : submission.name, '講者姓名', 60);
  if (!name) throw appError_('validation', '收件資料沒有可轉入的講者姓名', false);

  const org = plainText_(isRecommend ? submission.recOrg : submission.org, '講者單位', 120);
  const contact = plainText_(isRecommend ? submission.recContact : submission.contact, '講者聯絡方式', 120);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : '';
  const phone = email ? '' : contact;
  const topics = jsonStringArray_(submission.topicsJson, 'topicsJson', 30, 120);
  const preferredWeeks = jsonStringArray_(submission.preferredWeeksJson, 'preferredWeeksJson', 30, 120);
  const noteBits = [];

  if (isRecommend) {
    const recommender = plainText_(submission.name, '推薦人姓名', 60);
    const recommenderContact = plainText_(submission.contact, '推薦人聯絡方式', 120);
    let recommendation = '報名頁推薦：由 ' + recommender;
    if (recommenderContact) recommendation += '（' + recommenderContact + '）';
    recommendation += '推薦';
    const why = plainText_(submission.recWhy, '推薦理由', 600);
    if (why) recommendation += '——' + why;
    noteBits.push(recommendation);
  } else {
    noteBits.push('報名頁自薦');
  }

  const proposedTitle = plainText_(submission.proposedTitle, '擬講題', 120);
  if (proposedTitle) noteBits.push('擬講題：' + proposedTitle);
  if (asBool_(submission.anyWeek)) noteBits.push('週次都可');
  else if (preferredWeeks.length) noteBits.push('偏好：' + preferredWeeks.join('、'));

  let raw = {};
  try { raw = submission.rawJson ? JSON.parse(submission.rawJson) : {}; } catch (e) { raw = {}; }
  const recordPref = plainText_(raw.recordPref || '', '錄影意願', 20);
  if (recordPref) noteBits.push('錄影意願：' + recordPref);
  const message = plainText_(submission.message, '留言', 600);
  if (message) noteBits.push(message);

  const mergedNotes = joinNotes_(existing ? existing.notes : '', noteBits.join('｜'), 500);
  if (table === 'Speakers') {
    const speakerPatch = { name: name, notes: mergedNotes };
    const field = topics.map(function(topic) {
        const parts = topic.split('｜');
        return parts.length > 1 ? parts[1] : parts[0];
      }).join('、');
    if (!existing) {
      speakerPatch.title = '';
      speakerPatch.org = org;
      speakerPatch.field = field;
      speakerPatch.email = email;
      speakerPatch.phone = phone;
      speakerPatch.status = isRecommend ? '口袋名單' : '接洽中';
    } else {
      /* 空白報名欄位不得抹掉既有講者資料；明確 patch 仍可覆寫或清空。 */
      if (org) speakerPatch.org = org;
      if (field) speakerPatch.field = field;
      if (email) speakerPatch.email = email;
      if (phone) speakerPatch.phone = phone;
    }
    return speakerPatch;
  }

  const talkPatch = {
    speakerName: name,
    notes: mergedNotes
  };
  if (org) talkPatch.speakerOrg = org;
  if (email) talkPatch.speakerEmail = email;
  if (phone) talkPatch.speakerPhone = phone;
  if (proposedTitle) talkPatch.title = proposedTitle;
  if (existing && existing.status === '構想中') talkPatch.status = '邀約中';
  return talkPatch;
}

function makePlan_(changeId, action, table, id, hit, after, changedFields) {
  return {
    changeId: changeId,
    op: action === 'softDelete' || action === 'dismissSubmission' ? 'softDelete' : 'upsert',
    action: action,
    table: table,
    id: id,
    rowIndex: hit ? hit.rowIndex : null,
    before: hit ? clone_(hit.record) : null,
    after: after,
    changedFields: changedFields
  };
}

function plainText_(value, label, maxLength) {
  const text = cleanString_(value === undefined || value === null ? '' : value).trim();
  assertNoPiiText_(text, label);
  if (text.length > maxLength) throw appError_('validation', label + ' 超過長度限制', false);
  return text;
}

function jsonStringArray_(value, label, maxItems, maxLength) {
  if (value === '' || value === null || value === undefined) return [];
  let parsed;
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value; }
  catch (e) { throw appError_('validation', label + ' 不是有效 JSON', false); }
  if (!Array.isArray(parsed)) throw appError_('validation', label + ' 必須是陣列', false);
  if (parsed.length > maxItems) throw appError_('validation', label + ' 項目過多', false);
  return parsed.map(function(item) {
    if (typeof item !== 'string') throw appError_('validation', label + ' 只能包含字串', false);
    return plainText_(item, label, maxLength);
  });
}

function joinNotes_(left, right, maxLength) {
  return [left, right].filter(function(value) { return Boolean(value); }).join('｜').slice(0, maxLength);
}

function assertNoPiiText_(text, label) {
  if (hasTaiwanId_(text)) {
    throw appError_('pii_detected', label + ' 偵測到疑似不可入庫個資（身分證字號或居留證統一證號格式）', false);
  }
}

/**
 * 只掃描講者實際填寫的內容，不把 clientId、row id、時間戳記等系統中繼資料
 * 當成報名文字。convertSubmission_ 仍會在逐欄轉換時再次套用 plainText_ 防護。
 */
function assertSubmissionContentNoPii_(submission) {
  const fields = [
    'name', 'contact', 'org', 'topicsJson', 'proposedTitle',
    'preferredWeeksJson', 'message', 'recName', 'recOrg',
    'recWhy', 'recContact', 'rawJson'
  ];
  fields.forEach(function(field) {
    assertNoPiiText_(submission && submission[field], '報名內容.' + field);
  });
}

function hasTaiwanId_(value) {
  const text = String(value || '').replace(/\bW(?:[1-9]|1[0-8])\s+\d{4}-\d{2}-\d{2}\b/gi, '');
  return /(^|[^A-Za-z0-9])(?:(?:[A-Z][1289]|[A-Z][A-D])(?:[ -]?\d){8})(?![A-Za-z0-9])/i.test(text);
}

function unique_(items) {
  const seen = {};
  return items.filter(function(item) {
    const key = String(item);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function assertWritable_(table, role) {
  if (table === 'AuditLog') throw appError_('unauthorized', 'AuditLog 只能由伺服器寫入', false);
  if (table === 'Submissions') throw appError_('unauthorized', 'Submissions 在管理台為只讀，請走 importSubmission', false);
  if ((table === 'Users' || table === 'Settings') && role !== 'owner') throw appError_('unauthorized', 'Users/Settings 只有 Owner 可寫入', false);
}

function ensureSheet_(ss, table) {
  const headers = schemaHeaders_(table);
  let sh = ss.getSheetByName(table);
  if (!sh) {
    sh = ss.insertSheet(table);
    if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    /* W1 驗收修正：updatedAt＋所有日期時間類欄位鎖文字格式——防 Sheets 自動轉 Date
       （updatedAt 壞 baseMatches_ 衝突偵測；date 壞成序號＋時區位移一天，W1 實測） */
    applyTextLocks_(sh, table);
  }
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  const currentHeaders = sh.getRange(1, 1, 1, headers.length).getValues()[0].map(cell_);
  const headersMatch = currentHeaders.every(function(value, index) { return value === headers[index]; });
  if (!headersMatch) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (sh.getFrozenRows() !== 1) sh.setFrozenRows(1);
  return sh;
}

/** 該表要鎖文字格式的欄位序號（1-based） */
function textCols_(table) {
  const headers = schemaHeaders_(table);
  const cols = [];
  headers.forEach(function(h, i) { if (TEXT_FORMAT_FIELDS.indexOf(h) !== -1) cols.push(i + 1); });
  return cols;
}

/** 整欄鎖文字格式（建表與 bootstrap migration 用） */
function applyTextLocks_(sh, table) {
  textCols_(table).forEach(function(col) {
    sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
  });
}

/** 單列鎖文字格式（每次寫入前呼叫——自動擴列不延續欄格式，鎖了才保真） */
function textLockRow_(sh, table, rowIndex) {
  textCols_(table).forEach(function(col) {
    sh.getRange(rowIndex, col, 1, 1).setNumberFormat('@');
  });
}

function schemaHeaders_(table) {
  if (!TABLE_FIELDS[table]) throw appError_('validation', '未知分頁', false);
  return COMMON_FIELDS.concat(TABLE_FIELDS[table]);
}

function tableState_(ss, cache, table) {
  if (cache[table]) return cache[table];
  const sh = ensureSheet_(ss, table);
  const headers = schemaHeaders_(table);
  const values = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues();
  const byId = {};
  values.forEach(function(row, i) {
    const record = rowToRecord_(headers, row);
    if (record.id && !byId[record.id]) byId[record.id] = { rowIndex: i + 2, record: record };
  });
  cache[table] = { sheet: sh, byId: byId };
  return cache[table];
}

function readTable_(table, includeDeleted, ss) {
  const book = ss || ss_();
  const sh = book.getSheetByName(table);
  if (!sh) throw appError_('internal', '資料表缺少必要分頁：' + table, false);
  /* 正式 schema 已由 bootstrap 建立；讀取熱路徑不再逐頁重驗表頭與凍結列。 */
  const headers = schemaHeaders_(table);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues()
    .map(function(row) { return rowToRecord_(headers, row); })
    .filter(function(r) { return includeDeleted || !asBool_(r.isDeleted); });
}

function rowToRecord_(headers, row) {
  const out = {};
  headers.forEach(function(h, i) { out[h] = cell_(row[i]); });
  return out;
}

function upsertSeedRow_(table, partial, now) {
  const ss = ss_();
  const state = tableState_(ss, {}, table);
  const headers = schemaHeaders_(table);
  const existing = state.byId[partial.id] || null;
  const record = blankRecord_(table);
  Object.keys(partial).forEach(function(k) { record[k] = partial[k]; });
  record.updatedAt = now;
  record.updatedBy = 'seed@example.invalid';
  record.version = existing ? Number(existing.record.version || 0) + 1 : 1;
  record.isDeleted = false;
  const row = headers.map(function(h) { return record[h] === undefined ? '' : record[h]; });
  const sh = ensureSheet_(ss, table);
  const rowIndex = existing ? existing.rowIndex : sh.getLastRow() + 1;
  textLockRow_(sh, table, rowIndex);
  sh.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
}

function blankRecord_(table) {
  const out = {};
  schemaHeaders_(table).forEach(function(h) { out[h] = ''; });
  out.version = 0;
  out.isDeleted = false;
  return out;
}

function sanitizeObject_(obj, allowed) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw appError_('validation', 'payload 必須是物件', false);
  const unknown = Object.keys(obj).filter(function(k) { return allowed.indexOf(k) === -1; });
  if (unknown.length) throw appError_('unknown_fields', 'payload 含契約外欄位', false, { fields: unknown });
  return obj;
}

function sanitizeRecord_(table, record) {
  sanitizeObject_(record, TABLE_FIELDS[table]);
  const clean = {};
  Object.keys(record).forEach(function(field) { clean[field] = sanitizeValue_(table, field, record[field]); });
  return clean;
}

function sanitizeBase_(base) {
  sanitizeObject_(base, ['updatedAt', 'version']);
  return { updatedAt: cleanString_(base.updatedAt || ''), version: Number(base.version || 0) };
}

function sanitizeValue_(table, field, value) {
  if (value === null || value === undefined) return '';
  if (['done', 'anyWeek'].indexOf(field) !== -1) return asBool_(value);   // 驗收修正：holiday 是字串（假日名，v1 真值），不是布林
  if (['no', 'off', 'hours', 'rate', 'transport', 'other', 'unitPrice', 'qty', 'budgetAmount', 'amount'].indexOf(field) !== -1) {
    if (value === '') return '';
    const n = Number(value);
    if (!isFinite(n)) throw appError_('validation', field + ' 必須是數字', false);
    return n;
  }
  if (field === 'evidenceUrl') {   /* W1 加：憑證連結 https 限定（與 demo EV() 消毒同規；空值可） */
    const u = cleanString_(value).trim();
    if (u !== '' && !/^https:\/\//.test(u)) throw appError_('validation', 'evidenceUrl 僅接受 https:// 連結', false);
    return u;
  }
  if (field === 'reportBlurb') {   /* v2：成果報告「授課主題與負責任 AI 對應面向」——官方格式 150 字內 */
    let s = cleanString_(value);
    if (s.length > 150) throw appError_('validation', 'reportBlurb 超過 150 字上限', false);
    if (/^[=+\-@\t]/.test(s)) s = "'" + s;
    assertNoPiiText_(s, field);
    return s;
  }
  if (field === 'eventUuid') {   /* v2：場次永久識別——伺服器產生（planChange_ 保留/補發），只驗格式 */
    const u = cleanString_(value).trim();
    if (u !== '' && !/^[A-Za-z0-9._:-]{1,120}$/.test(u)) throw appError_('validation', 'eventUuid 格式不符', false);
    return u;
  }
  if (field === 'evidenceJson') {   /* v2：成果佐證 8 格——固定 {slides:[4],photos:[4]}，逐格空值或 https:// */
    const s = sanitizeJson_(value, field);
    if (s === '') return s;
    const parsed = JSON.parse(s);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw appError_('validation', 'evidenceJson 必須是物件', false);
    ['slides', 'photos'].forEach(function(kind) {
      const arr = parsed[kind];
      if (!Array.isArray(arr) || arr.length > 4) throw appError_('validation', 'evidenceJson.' + kind + ' 必須是至多 4 項的陣列', false);
      arr.forEach(function(u) {
        if (typeof u !== 'string') throw appError_('validation', 'evidenceJson.' + kind + ' 只能是字串', false);
        if (u !== '' && !/^https:\/\//.test(u)) throw appError_('validation', 'evidenceJson 連結僅接受 https://', false);
        if (u.length > 300) throw appError_('validation', 'evidenceJson 連結超過長度限制', false);
      });
    });
    return s;
  }
  if (field.slice(-4) === 'Json') return sanitizeJson_(value, field);
  if (field === 'email' || field === 'speakerEmail') {
    const email = normalizeEmail_(value);
    if (email === '') return '';
    if (email.length > 320) throw appError_('payload_too_large', field + ' 超過長度限制', false);
    assertNoPiiText_(email, field);
    /* email 分支原本早於通用公式防護 return，會讓 =1+1 直接進 Sheet。 */
    if (/^[=+\-@\t]/.test(email)) throw appError_('validation', field + ' 格式不符', false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw appError_('validation', field + ' 格式不符', false);
    return email;
  }
  if (table === 'Users' && field === 'role') return sanitizeEnum_(value, ['owner', 'editor'], 'role');
  if (table === 'Settings' && field === 'key') return sanitizeEnum_(value, SETTINGS_KEYS, 'key');
  let s = cleanString_(value);
  if (s.length > 50000) throw appError_('payload_too_large', field + ' 超過長度限制', false);
  /* P0 修：公式注入防護——開頭是 = + - @ 或 tab 一律前綴單引號（複驗 D1） */
  if (/^[=+\-@\t]/.test(s)) s = "'" + s;
  /* PII 哨兵統一走同一 helper，大小寫皆攔。 */
  assertNoPiiText_(s, field);
  return s;
}

function sanitizeJson_(value, field) {
  const s = typeof value === 'string' ? cleanString_(value) : JSON.stringify(value);
  if (s === '') return '';
  if (s.length > 50000) throw appError_('payload_too_large', field + ' 超過長度限制', false);
  assertNoPiiText_(s, field);
  let parsed;
  try { parsed = JSON.parse(s); } catch (e) { throw appError_('validation', field + ' 必須是 JSON 字串', false); }
  assertJsonHasNoForbiddenPiiKeys_(parsed, field);
  return s;
}

function assertJsonHasNoForbiddenPiiKeys_(value, field) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(function(item) { assertJsonHasNoForbiddenPiiKeys_(item, field); });
    return;
  }
  const forbidden = [
    'nationalid', 'nationalidnumber', 'idnumber', 'identitynumber',
    'bankaccount', 'bankaccountnumber', 'accountnumber',
    'studentid', 'receiptimage',
    '身分證字號', '戶籍地址', '銀行帳號', '學號', '領據影像'
  ];
  Object.keys(value).forEach(function(key) {
    const normalized = String(key).replace(/[\s_.-]/g, '').toLowerCase();
    if (forbidden.indexOf(normalized) !== -1) {
      throw appError_('pii_detected', field + ' 含不可入庫個資欄位', false);
    }
    assertJsonHasNoForbiddenPiiKeys_(value[key], field);
  });
}

function validateMergedRecord_(table, record, id) {
  record.id = id;
  if (table === 'Users' && (!record.email || ['owner', 'editor'].indexOf(record.role) === -1)) throw appError_('validation', 'Users 需要 email 與 role', false);
  if (table === 'Settings' && (SETTINGS_KEYS.indexOf(record.key) === -1 || record.valueJson === '')) throw appError_('validation', 'Settings 需要 key 與 valueJson', false);
}

function baseMatches_(base, record) {
  return base.updatedAt === String(record.updatedAt || '') && Number(base.version) === Number(record.version || 0);
}

function baseHasVersion_(base) {
  return Boolean(base.updatedAt) || Number(base.version || 0) > 0;
}

function conflict_(changeId, table, id, reason, base, serverRecord, clientRecord) {
  return {
    changeId: changeId,
    table: table,
    id: id,
    reason: reason,
    clientBase: { updatedAt: base.updatedAt || '', version: Number(base.version || 0) },
    server: { updatedAt: serverRecord.updatedAt || '', version: Number(serverRecord.version || 0), record: serverRecord },
    clientRecord: clientRecord || {}
  };
}

function sanitizeId_(value, label) {
  const s = cleanString_(value).trim();
  if (!s || !/^[A-Za-z0-9._:-]{1,120}$/.test(s)) throw appError_('validation', label + ' 格式不符', false);
  return s;
}

function sanitizeEnum_(value, allowed, label) {
  const s = cleanString_(value).trim();
  if (allowed.indexOf(s) === -1) throw appError_('validation', label + ' 不在允許清單', false);
  return s;
}

function cleanString_(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ');
}

function normalizeEmail_(value) {
  return cleanString_(value).trim().toLowerCase();
}

function asBool_(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function cell_(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return cleanString_(value);
  return value;
}

function clone_(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function permissionsFor_(role) {
  if (role === 'owner') return ['read', 'write', 'manageUsers', 'manageSettings', 'importSubmission', 'dismissSubmission'];
  if (role === 'editor') return ['read', 'write', 'importSubmission', 'dismissSubmission'];
  return [];
}

function nowIso_() {
  return new Date().toISOString();
}

function appError_(code, message, retryable, extra) {
  const e = new Error(message);
  e.isAppError = true;
  e.code = code;
  e.retryable = Boolean(retryable);
  e.extra = extra || {};
  return e;
}

function errObj_(code, message, retryable) {
  return { code: code, message: message, retryable: Boolean(retryable) };
}

function errorEnvelope_(code, message, retryable, extra) {
  return Object.assign({ ok: false, error: errObj_(code, message, retryable) }, extra || {});
}

function handleError_(e) {
  if (e && e.isAppError) return errorEnvelope_(e.code, e.message, e.retryable, e.extra);
  return errorEnvelope_('internal', '伺服器發生未預期錯誤', false);
}
