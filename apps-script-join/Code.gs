/**
 * 演講管理台 v2 — 專案 B（公開收件端點）
 * 契約：INTERFACE_CONTRACT.md v0.2.2 §A Submissions（append-only）＋§D 錯誤碼。
 * 部署：Web App「執行身分＝我」「存取＝任何人」（匿名報名頁用；請由專案擁有者在 Apps Script 主控台親自設定）。
 * 回應＝ContentService JSON（join.html 以 text/plain 直送免預檢、redirect follow 後可讀）——
 * busy／錯誤講真話，不再 no-cors 盲送。
 */

const SHEET_ID_PROPERTY = 'SHEET_ID';
const SHEET_NAME = 'Submissions';   // 契約分頁名（v1「講者報名」不留 alias，遷移即改）
const MAX_BODY = 20000;             // 單筆 payload 上限（字元）
const RATE_MAX_PER_HOUR = 30;       // 全站每小時收件上限（匿名端點的粗閘；超過回 busy）
const NOTIFY_EMAIL = 'notify@example.invalid';   // 請改成你的通知信收件人
const NOTIFY_SUBJECT_PREFIX = '【演講課講者報名】';

const HEADERS = ['id', 'updatedAt', 'updatedBy', 'version', 'isDeleted',
  'receivedAt', 'mode', 'name', 'contact', 'org', 'topicsJson', 'proposedTitle',
  'preferredWeeksJson', 'anyWeek', 'message', 'recName', 'recOrg', 'recWhy', 'recContact',
  'source', 'clientId', 'rawJson'];

/** W6+：doGet 直接服務報名頁；?ping=1 保留健檢；?schedule=1 只回去個資檔期。 */
function doGet(e) {
  if (e && e.parameter && e.parameter.schedule) {
    return json_(getPublicSchedule());
  }
  if (e && e.parameter && e.parameter.ping) {
    return json_({ ok: true, ping: 'talkmgr-join', serverTime: new Date().toISOString() });
  }
  return HtmlService.createHtmlOutputFromFile('Join')
    .setTitle('徵求講者｜AI 通識課程・示範大學')   // 校名請改成你的學校正式名稱
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 公開檔期唯一讀取介面：只回日期與公開狀態，不回講者姓名、聯絡方式、講題、備註或行政資料。
 * confirmed／done 會鎖住報名頁日期；negotiating 只顯示洽談中，仍可填為偏好。
 */
function getPublicSchedule() {
  const cache = CacheService.getScriptCache();
  const key = 'public_schedule_v1';
  try {
    const hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (cacheErr) {
    console.error('Public schedule cache read failed: ' + String(cacheErr && cacheErr.message || cacheErr));
  }

  const ss = SpreadsheetApp.openById(sheetId_());
  const sh = ss.getSheetByName('Talks');
  const talks = sh ? publicScheduleFromRows_(sh.getDataRange().getDisplayValues()) : [];
  const payload = { ok: true, generatedAt: new Date().toISOString(), talks: talks };
  try {
    cache.put(key, JSON.stringify(payload), 60);
  } catch (cacheErr) {
    console.error('Public schedule cache write failed: ' + String(cacheErr && cacheErr.message || cacheErr));
  }
  return payload;
}

/** 純函式，方便測試輸入列；回傳欄位採固定 allowlist，不能傳回整列。 */
function publicScheduleFromRows_(values) {
  if (!Array.isArray(values) || !values.length) return [];
  const headers = values[0].map(function(h) { return String(h || '').trim(); });
  const idx = {};
  headers.forEach(function(h, i) { if (h) idx[h] = i; });
  if (idx.date === undefined || idx.status === undefined) return [];
  const statusMap = { '邀約中': 'negotiating', '已確認': 'confirmed', '已完成': 'done' };
  const out = [];
  values.slice(1).forEach(function(row) {
    const deleted = idx.isDeleted === undefined ? '' : String(row[idx.isDeleted] || '').toLowerCase();
    if (deleted === 'true' || deleted === '1') return;
    const date = String(row[idx.date] || '').trim();
    const status = statusMap[String(row[idx.status] || '').trim()];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !status) return;
    out.push({ date: date, status: status });
  });
  return out.sort(function(a, b) { return a.date.localeCompare(b.date); });
}

/** HtmlService 頁內投遞（google.script.run——同專案 RPC、無 CORS 無轉址）；與 doPost 共用同一條管線 */
function submitFromPage(raw) {
  try {
    if (typeof raw !== 'string') return errObj2_('validation', '格式不對');
    if (raw.length > MAX_BODY) return errObj2_('payload_too_large', '內容太長');
    let data;
    try { data = JSON.parse(raw); } catch (err) { return errObj2_('validation', '格式不是有效 JSON'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return errObj2_('validation', '格式不對');
    return processSubmission_(data);
  } catch (err) {
    return errObj2_('internal', '伺服器發生未預期錯誤');
  }
}

function doPost(e) {
  try {
    const raw = extractPayload_(e);
    if (!raw) return jsonErr_('validation', '沒有收到內容');
    if (raw.length > MAX_BODY) return jsonErr_('payload_too_large', '內容太長');

    let data;
    try { data = JSON.parse(raw); } catch (err) { return jsonErr_('validation', '格式不是有效 JSON'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return jsonErr_('validation', '格式不對');
    return json_(processSubmission_(data));
  } catch (err) {
    return jsonErr_('internal', '伺服器發生未預期錯誤');   // 對外不回顯細節（契約）
  }
}

/** 共用投遞管線：蜜罐→消毒→PII→節流→鎖→落地；回傳「純物件」（doPost 包 json_、submitFromPage 直回） */
function processSubmission_(data) {

    /* 蜜罐：機器人填了隱藏欄 → 假裝成功、不落地（別教它怎麼過關） */
    if (typeof data.website === 'string' && data.website.trim() !== '') return { ok: true };

    const rec = sanitizeSub_(data);
    if (!rec) return errObj2_('validation', '請填姓名與聯絡方式；推薦模式另需填被推薦人姓名');

    /* PII 哨兵：疑似身分證字號不入庫（契約紅線） */
    if (hasTaiwanId_(JSON.stringify(rec))) return errObj2_('pii_detected', '內容疑似含身分證字號或居留證統一證號——報名不需要提供，請移除後再送');

    const sheetId = sheetId_();
    let savedRow = null;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return busyObj_(5);
    try {
      const sh = ensureSheet_(sheetId);

      /* 網路逾時後瀏覽器會用同一 clientId 重送。先在鎖內查重，避免同一表單落兩列。 */
      if (rec.clientId !== 'anon' && hasClientId_(sh, rec.clientId)) {
        return { ok: true, duplicate: true };
      }

      /* 節流：全站粗閘＋同 clientId 10 分鐘 3 筆。Cache 只是節流提示，不是真值來源。 */
      const cache = CacheService.getScriptCache();
      const hourKey = 'join_rate_' + new Date().toISOString().slice(0, 13);
      const hourN = Number(cache.get(hourKey) || 0);
      if (hourN >= RATE_MAX_PER_HOUR) return busyObj_(120);
      const cliKey = 'join_cli_' + rec.clientId;
      const cliN = Number(cache.get(cliKey) || 0);
      if (cliN >= 3) return busyObj_(300);

      const now = new Date().toISOString();
      const row = {
        id: 'sub_' + Utilities.getUuid(),
        updatedAt: now, updatedBy: 'join-endpoint', version: 1, isDeleted: false,
        receivedAt: now,
        mode: rec.mode, name: rec.name, contact: rec.contact, org: rec.org,
        topicsJson: JSON.stringify(rec.topics), proposedTitle: rec.proposedTitle,
        preferredWeeksJson: JSON.stringify(rec.preferredWeeks), anyWeek: rec.anyWeek,
        message: rec.message, recName: rec.recName, recOrg: rec.recOrg,
        recWhy: rec.recWhy, recContact: rec.recContact,
        source: rec.source, clientId: rec.clientId,
        rawJson: JSON.stringify(rec.rawKeep)   // recordPref 等契約外欄位保留在 rawJson（v0.3 議題：recordPref 欄位化）
      };
      const rowIndex = sh.getLastRow() + 1;
      /* 日期與聯絡電話鎖文字格式：防 Sheets 自動轉 Date，並保留 0900... 前導 0。 */
      sh.getRange(rowIndex, 2, 1, 1).setNumberFormat('@');
      sh.getRange(rowIndex, 6, 1, 1).setNumberFormat('@');
      sh.getRange(rowIndex, 9, 1, 1).setNumberFormat('@');
      sh.getRange(rowIndex, 19, 1, 1).setNumberFormat('@');
      sh.getRange(rowIndex, 1, 1, HEADERS.length).setValues([HEADERS.map(function(h) { return row[h] === undefined ? '' : row[h]; })]);
      /* Sheet 已成功落地後，Cache 寫入失敗也不可回報整筆失敗，否則前端重試會誤導使用者。 */
      try {
        cache.put(hourKey, String(hourN + 1), 3600);
        cache.put(cliKey, String(cliN + 1), 600);
      } catch (cacheErr) {
        console.error('Submission saved but rate cache failed: ' + String(cacheErr && cacheErr.message || cacheErr));
      }
      savedRow = row;
    } finally { lock.releaseLock(); }

  /* 通知不阻擋收件：Sheet 已落地後才寄；寄信若暫時失敗，不讓前端重試造成重複報名。 */
  try {
    notifySubmission_(rec, savedRow, sheetId);
  } catch (err) {
    console.error('Submission saved but notification failed: ' + String(err && err.message || err));
  }

  return { ok: true };
}

/** 新報名通知：主旨固定前綴供 Gmail 篩選器套用「演講課/講者報名」標籤。 */
function notifySubmission_(rec, row, sheetId) {
  if (!row) return;
  const modeText = rec.mode === 'recommend' ? '推薦講者' : '講者自薦';
  const who = rec.mode === 'recommend' ? (rec.recName || rec.name) : rec.name;
  const weeks = rec.anyWeek
    ? '都可以，配合安排'
    : (rec.preferredWeeks.length ? rec.preferredWeeks.join('、') : '未指定');
  const topics = rec.topics.length ? rec.topics.join('、') : '未填';
  const recordPref = rec.rawKeep.recordPref || '到時再確認';
  const receivedAt = Utilities.formatDate(
    new Date(row.receivedAt),
    Session.getScriptTimeZone() || 'Asia/Taipei',
    'yyyy-MM-dd HH:mm:ss'
  );
  const lines = [
    '演講課公開報名頁收到一筆新資料。',
    '',
    '類型：' + modeText
  ];
  if (rec.mode === 'recommend') {
    lines.push(
      '推薦人：' + (rec.name || '未填'),
      '推薦人聯絡方式：' + (rec.contact || '未填'),
      '推薦講者：' + (rec.recName || '未填'),
      '講者聯絡方式：' + (rec.recContact || '未填'),
      '講者單位／職稱：' + (rec.recOrg || '未填'),
      '推薦原因：' + (rec.recWhy || '未填')
    );
  } else {
    lines.push(
      '姓名：' + (rec.name || '未填'),
      '聯絡方式：' + (rec.contact || '未填'),
      '單位／職稱：' + (rec.org || '未填'),
      '擬講題：' + (rec.proposedTitle || '未填'),
      '講題方向：' + topics,
      '偏好週次：' + weeks,
      '錄影意願：' + recordPref,
      '想說的話：' + (rec.message || '未填')
    );
  }
  lines.push(
    '',
    '收到時間：' + receivedAt,
    '報名編號：' + row.id,
    '查看收件表：https://docs.google.com/spreadsheets/d/' + sheetId + '/edit',
    '',
    '這封信由演講課報名系統自動寄出。'
  );

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: NOTIFY_SUBJECT_PREFIX + modeText + '｜' + (who || '未填姓名'),
    body: lines.join('\n'),
    name: '演講課管理台'
  });
}

/* join.html 用 text/plain 直送 JSON；也兼容 v1 的 payload= urlencoded 形式 */
function extractPayload_(e) {
  if (!e) return '';
  if (e.parameter && e.parameter.payload) return String(e.parameter.payload);
  if (e.postData && e.postData.contents) return String(e.postData.contents);
  return '';
}

/* 消毒：allowlist＋長度上限（對齊管理台 sanitizeSub 口徑）；未知欄位收進 rawKeep（進 rawJson、不落欄） */
function sanitizeSub_(r) {
  const S = function(v, n) { return safeSheetText_(v, n || 600); };
  const A = function(v) { return Array.isArray(v) ? v.filter(function(x) { return typeof x === 'string'; }).map(function(x) { return safeSheetText_(x, 120); }).slice(0, 30) : []; };
  const out = {
    mode: r.mode === 'recommend' ? 'recommend' : 'self',
    name: S(r.name, 60), contact: S(r.contact, 120), org: S(r.org, 120),
    topics: A(r.topics), proposedTitle: S(r.proposedTitle, 120),
    anyWeek: r.anyWeek === true, preferredWeeks: A(r.preferredWeeks),
    message: S(r.message, 600),
    recName: S(r.recName, 60), recOrg: S(r.recOrg, 120), recWhy: S(r.recWhy, 600), recContact: S(r.recContact, 120),
    source: S(r.source, 20) || 'web',
    clientId: (/^[A-Za-z0-9._:-]{1,64}$/.test(String(r.id || ''))) ? safeSheetText_(String(r.id), 65) : 'anon',
    rawKeep: { recordPref: S(r.recordPref, 20), course: S(r.course, 40), ts: S(r.ts, 30) }
  };
  if (!out.name || !out.contact || (out.mode === 'recommend' && !out.recName)) return null;
  return out;
}

/** clientId 是公開頁每次送件生成的冪等鍵；包含軟刪除列，避免已處理案件被重送成新案件。 */
function hasClientId_(sh, clientId) {
  if (!clientId || clientId === 'anon' || sh.getLastRow() < 2) return false;
  return sh.getRange(2, 21, sh.getLastRow() - 1, 1).getDisplayValues().some(function(row) {
    return String(row[0] || '') === String(clientId);
  });
}

/**
 * 匿名表單文字寫入 Sheet 前的最後防線。
 * Google Sheets 會把 =、+、-、@ 開頭的字串解讀成公式；前綴單引號強制存成純文字。
 */
function safeSheetText_(value, maxLength) {
  if (typeof value !== 'string') return '';
  let text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (/^[=+\-@\t]/.test(text)) text = "'" + text;
  return text.slice(0, maxLength);
}

function hasTaiwanId_(value) {
  /*
   * 國民身分證：1 英文＋性別碼 1/2＋8 數字
   * 新式外來人口統號：1 英文＋性別碼 8/9＋8 數字
   * 舊式外來人口統號：2 英文＋8 數字
   * 保留「疑似即攔」的安全口徑，不靠檢查碼；但要求完整字元邊界，避免命中網址 UUID 中段。
   */
  const text = String(value || '').replace(/\bW(?:[1-9]|1[0-8])\s+\d{4}-\d{2}-\d{2}\b/gi, '');
  return /(^|[^A-Za-z0-9])(?:(?:[A-Z][1289]|[A-Z][A-D])(?:[ -]?\d){8})(?![A-Za-z0-9])/i.test(text);
}

function sheetId_() {
  const id = String(
    PropertiesService.getScriptProperties().getProperty(SHEET_ID_PROPERTY) || ''
  ).trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(id)) {
    throw new Error('SHEET_ID 指令碼屬性未設定或格式錯誤');
  }
  return id;
}

function ensureSheet_(sheetId) {
  const ss = SpreadsheetApp.openById(sheetId);
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('@');
    sh.getRange(1, 6, sh.getMaxRows(), 1).setNumberFormat('@');
    sh.getRange(1, 9, sh.getMaxRows(), 1).setNumberFormat('@');
    sh.getRange(1, 19, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sh.setFrozenRows(1);
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
/* 純物件版錯誤（processSubmission_／submitFromPage 用；doPost 出口再包 json_） */
function errObj2_(code, message) {
  return { ok: false, error: { code: code, message: message, retryable: code === 'busy' } };
}
function busyObj_(sec) {
  return { ok: false, error: { code: 'busy', message: '系統忙碌，請稍後重試', retryable: true }, retryAfterSec: sec };
}
function jsonErr_(code, message) {
  return json_({ ok: false, error: { code: code, message: message, retryable: code === 'busy' } });
}
function jsonBusy_(sec) {
  return json_({ ok: false, error: { code: 'busy', message: '系統忙碌，請稍後重試', retryable: true }, retryAfterSec: sec });
}
