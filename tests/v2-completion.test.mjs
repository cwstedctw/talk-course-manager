import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const codePath = path.join(root, 'apps-script-admin', 'Code.gs');
const adminPath = path.join(root, 'admin-v2.html');
const indexPath = path.join(root, 'apps-script-admin', 'Index.html');
const joinPath = path.join(root, 'join.html');
const joinGasPath = path.join(root, 'apps-script-join', 'Join.html');
const joinCodePath = path.join(root, 'apps-script-join', 'Code.gs');
const w1Path = path.join(root, 'apps-script-admin', 'W1Tests.gs');
const v2GasTestsPath = path.join(root, 'apps-script-admin', 'V2CompletionTests.gs');
const code = fs.readFileSync(codePath, 'utf8');
const admin = fs.readFileSync(adminPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const join = fs.readFileSync(joinPath, 'utf8');
const joinGas = fs.readFileSync(joinGasPath, 'utf8');
const joinCode = fs.readFileSync(joinCodePath, 'utf8');
const w1Code = fs.readFileSync(w1Path, 'utf8');
const v2GasTests = fs.readFileSync(v2GasTestsPath, 'utf8');

function loadBackendHelpers() {
  return new Function(`${code}\nreturn {
    sanitizeImportTarget_, convertSubmission_, sanitizeJson_,
    sanitizeValue_, snapshotTablesForRole_, officialBudgetLines_, hasTaiwanId_,
    assertSubmissionContentNoPii_
  };`)();
}

test('報名轉入只掃使用者內容，不把系統中繼資料誤判為個資', () => {
  const { assertSubmissionContentNoPii_ } = loadBackendHelpers();
  const safeSubmission = {
    id: 'sub_A123456789',
    clientId: 'A123456789',
    updatedBy: 'A812345678',
    receivedAt: '2026-07-17T04:09:00.000Z',
    name: '安全測試講者',
    contact: 'speaker@example.invalid',
    org: '測試單位',
    topicsJson: '["AI 教育"]',
    proposedTitle: '安全講題',
    preferredWeeksJson: '["W6 2026-10-16","W8 2026-10-30"]',
    message: '期待交流',
    recName: '', recOrg: '', recWhy: '', recContact: '',
    rawJson: '{"recordPref":"不希望錄影"}'
  };
  assert.doesNotThrow(() => assertSubmissionContentNoPii_(safeSubmission));
  assert.throws(
    () => assertSubmissionContentNoPii_({ ...safeSubmission, message: '請記錄 A123456789' }),
    /報名內容\.message/
  );
  assert.throws(
    () => assertSubmissionContentNoPii_({ ...safeSubmission, rawJson: '{"note":"A812345678"}' }),
    /報名內容\.rawJson/
  );
  assert.match(code, /assertSubmissionContentNoPii_\(submission\)/);
  assert.doesNotMatch(code, /assertNoPiiText_\(JSON\.stringify\(submission\)/);
});

function loadJoinBackendHelpers() {
  return new Function(`${joinCode}\nreturn { sanitizeSub_, safeSheetText_, hasTaiwanId_, hasClientId_, publicScheduleFromRows_ };`)();
}

function loadAdminPiiScan() {
  const start = admin.indexOf('function piiScan');
  const end = admin.indexOf('function selOpts', start);
  assert.ok(start >= 0 && end > start, '找不到管理台個資哨兵');
  return new Function(`${admin.slice(start, end)}\nreturn piiScan;`)();
}

function compileInlineScripts(html, label) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, `${label} 找不到 inline script`);
  scripts.forEach((match, index) => {
    assert.doesNotThrow(() => new Function(match[1]), `${label} script ${index + 1} 語法錯誤`);
  });
}

test('管理台來源與 Apps Script Index 維持完全一致且 JavaScript 可解析', () => {
  assert.equal(admin, index);
  compileInlineScripts(admin, 'admin-v2.html');
});


test('Apps Script 呼叫逾時時會結束等待，不讓開機畫面無限轉圈', () => {
  assert.match(admin, /const GAS_TIMEOUT_MS=20000/);
  assert.match(admin, /setTimeout\(\(\)=>finish\(rej,new Error\(/);
  assert.match(admin, /clearTimeout\(timer\)/);
  assert.match(admin, /typeof runner\[fn\]!=='function'/);
});
test('開機一次取得身分與快照，且同次快照共用試算表連線', () => {
  assert.match(code, /function getBootstrap\(args\)/);
  assert.match(code, /authorize_\(\['owner', 'editor'\], 'getBootstrap', ss\)/);
  assert.match(code, /readTable_\(table, includeDeleted, ss\)/);
  assert.match(code, /function readTable_\(table, includeDeleted, ss\)/);
  assert.match(code, /const sh = book\.getSheetByName\(table\)/);
  assert.match(code, /讀取熱路徑不再逐頁重驗表頭與凍結列/);
  assert.match(admin, /bootstrap\(a\)\{return this\.call\('getBootstrap'/);
  assert.match(admin, /who=await this\.api\.bootstrap\(\{\}\)/);
  assert.match(admin, /const snap=prefetched&&prefetched\.tables\?prefetched:await this\.api\.getSnapshot/);
  assert.match(admin, /this\.pull\(true,bootSnapshot,true\)/);
});
test('Apps Script 內嵌程式分段載入，避免單段過大造成 Google 注入失敗', () => {
  const scripts = [...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 3);
  scripts.forEach((match, index) => {
    assert.ok(match[1].length < 80000, `script ${index + 1} 過大：${match[1].length}`);
  });
});
test('鐘點費時數以 1 小時遞增且新資料預設 3 小時', () => {
  assert.match(admin, /defaultHours:3, defaultRate:2000/);
  assert.match(admin, /<label>時數<\/label><input type="number" min="0" step="1"/);
  assert.match(admin, /<label>預設時數<\/label><input type="number" min="0" step="1"/);
  assert.match(code, /defaultHours: 3, defaultRate: 2000/);
});

test('二代健保在經費頁獨立自動彙總，不占用其他費用', () => {
  assert.match(admin, /const NHI_RATE=\.0211/);
  assert.match(admin, /其他費用（不含二代健保）/);
  assert.match(admin, /二代健保試算 NT\$ [\s\S]*?不填入其他費用，也不計入本區合計/);
  assert.match(admin, /auto==='nhi'\)return budgetAutoTalks\(\)\.reduce\(\(a,t\)=>a\+nhiFee\(t\),0\)/);
  assert.match(admin, /semOf\(t\.date\)===idx\?a\+nhiFee\(t\):a/);
  assert.match(admin, /鐘點費×2\.11% 自動加總/);
  assert.doesNotMatch(admin, /length\*84|\?a\+84:a|每場 84 元/);
  assert.doesNotMatch(admin, /talk\.fee\.other[^\n]*readonly|fee\.other=nhiFee/);
  assert.match(code, /鐘點費×2\.11%，四捨五入/);
  assert.match(admin, /class="bsummary"/);
  assert.match(admin, /class="bsemester"/);
  assert.match(admin, /<strong>下學期<\/strong>[\s\S]*?已用 NT\$/);
  assert.match(admin, /class="bprogress"/);
  assert.doesNotMatch(admin, /\u7968\u6839|\u5be6\u5831\u5be6\u92b7|\u6838\u92b7\u4ee5\u7968\u6839/);
});

test('經費卡與交通費試算在窄螢幕維持可讀版面', () => {
  assert.match(admin, /\.bgrid\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(320px,1fr\)\)/);
  assert.match(admin, /@media\(max-width:700px\)[\s\S]*?\.bgrid\{grid-template-columns:1fr\}/);
  assert.match(admin, /class="fare-route"/);
  assert.match(admin, /class="fare-prices"/);
  assert.match(admin, /@media\(max-width:700px\)[\s\S]*?#dlgFare\{width:calc\(100vw - 20px\)[^}]*max-height:calc\(100dvh - 20px\)[^}]*overflow-y:auto/);
  assert.match(admin, /#dlgFare \.fare-prices\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(admin, /@media\(max-width:360px\)[\s\S]*?#dlgFare \.fare-prices,#dlgFare \.fare-actions\{grid-template-columns:1fr\}/);
  assert.doesNotMatch(admin, /<dialog id="dlgFare" style=/);
  assert.match(admin, /class="row fare-actions"/);
});

test('compact dashboard rules apply only to short desktop viewports', () => {
  assert.match(admin, /document\.body\.classList\.toggle\('view-dash',v==='dash'\)/);
  assert.match(admin, /@media screen and \(min-width:900px\) and \(max-height:820px\)/);
  assert.match(admin, /body\.view-dash header\{flex-wrap:nowrap/);
  assert.match(admin, /body\.view-dash main\{padding-top:10px;padding-bottom:10px\}/);
  assert.match(admin, /body\.view-dash #app>\.notice\{[^}]*text-overflow:ellipsis/);
});

test('開機 ok:false 依 error.code 分流：busy 自動重試、非授權錯誤不誤入 denied 分支', () => {
  /* busy：限次自動重試，尊重 retryAfterSec，不顯示「沒有使用權限」 */
  assert.match(admin, /errCode==='busy'&&\(this\.bootBusyTries=\(this\.bootBusyTries\|\|0\)\+1\)<=2/);
  assert.match(admin, /Number\(who\.retryAfterSec\)\|\|5/);
  assert.match(admin, /setTimeout\(\(\)=>this\.boot\(\),waitSec\*1000\)/);
  /* 只有 unauthorized／unauthenticated 進 🚫 denied；其他（internal…）轉一般錯誤分支 fail closed */
  assert.match(admin, /errCode!=='unauthorized'&&errCode!=='unauthenticated'/);
  const branchOrder = admin.indexOf("errCode==='busy'");
  const deniedBranch = admin.indexOf('沒有使用權限');
  assert.ok(branchOrder > -1 && deniedBranch > branchOrder, 'busy 分流必須在 denied 訊息之前判斷');
});
test('講者庫回顯已排場次，查看與改排採 speakerId 雙向連結', () => {
  assert.match(admin, /const linked=db\.talks\.filter\(t=>t\.speakerId===p\.id\)/);
  assert.match(admin, /class="spkgrid"/);
  assert.match(admin, /class="spkhead"[\s\S]*?data-act="spkEdit"/);
  assert.match(admin, /<details class="spknotes">/);
  assert.doesNotMatch(admin, /\.spktbl\{table-layout:fixed;min-width:1280px\}/);
  assert.match(admin, /data-act="open"[^>]+title="查看第/);
  assert.match(admin, /data-act="reassign"[^>]+data-from=/);
  assert.match(admin, /case 'reassign':openAssignDialog/);
  assert.match(admin, /data-act="unassign"[^>]+data-from=/);
  assert.match(admin, /case 'unassign'/);
  assert.match(admin, /if\(moved\)unassignSpeakerFromTalk\(from,p\.id\)/);
  assert.match(admin, /已完成的場次不能改排/);
  assert.match(admin, />移到別場<\/button>/);
  assert.match(admin, /linked\.length\?'再排一場':'排入場次'/);
  assert.doesNotMatch(admin, />改排<\/button>|另排一場/);
});
test('解除單一場次只清除該場講者，保留其他週次與講者庫', () => {
  const start = admin.indexOf('function unassignSpeakerFromTalk');
  const end = admin.indexOf('function openAssignDialog', start);
  assert.ok(start >= 0 && end > start, '找不到單一場次解除 helper');
  const unassignSpeakerFromTalk = new Function(`${admin.slice(start, end)}\nreturn unassignSpeakerFromTalk;`)();
  const first = {
    id: 't01', status: '已確認', speakerId: 'spk_1',
    speaker: { name: '測試講者', title: '教授', org: '測試單位', email: 'test@example.invalid', phone: '0900000000' }
  };
  const second = {
    id: 't02', status: '邀約中', speakerId: 'spk_1',
    speaker: { name: '測試講者', title: '教授', org: '測試單位', email: 'test@example.invalid', phone: '0900000000' }
  };
  const speaker = { id: 'spk_1', name: '測試講者', status: '已答應' };
  assert.equal(unassignSpeakerFromTalk(first, speaker.id), true);
  assert.equal(first.speakerId, '');
  assert.equal(first.speaker.name, '');
  assert.equal(first.status, '構想中');
  assert.equal(second.speakerId, speaker.id);
  assert.equal(second.speaker.name, speaker.name);
  assert.equal(speaker.status, '已答應');
  assert.equal(unassignSpeakerFromTalk({ ...second, status: '已完成' }, speaker.id), false);
  assert.equal(unassignSpeakerFromTalk(second, 'spk_other'), false);
});


test('換新學期保留完整講者庫，重建週曆與場次並解除舊支出連結', () => {
  const start = admin.indexOf('function isoDatePlusDays');
  const end = admin.indexOf('function openSemesterReset');
  assert.ok(start >= 0 && end > start, '找不到換學期純函式');
  const helpers = new Function(`${admin.slice(start, end)}\nreturn {isoDatePlusDays,makeSemesterWeeks,buildNewSemesterDb};`)();
  const source = {
    settings: { semester: '115-1', defaultHours: 2, defaultRate: 3000 },
    checklistTpl: [{ off: -7, label: '寄行前信' }],
    reimbTpl: ['領據'],
    speakers: [{ id: 's1', name: '賴虛構', title: '副教授', org: '示範大學', field: 'AI', email: 'speaker@example.invalid', phone: '0900000000', status: '已答應', notes: '完整保留' }],
    talks: Array.from({ length: 12 }, (_, i) => ({ id: `t${String(i + 1).padStart(2, '0')}`, no: i + 1, title: '舊講題' })),
    expenses: [{ id: 'e1', talkId: 't01', amount: 6000, note: '舊學期演講費' }],
    templates: { invite: '邀請信' },
    budgetLines: [{ id: 'b1', budgetAmount: 10000 }]
  };
  const next = helpers.buildNewSemesterDb(source, {
    semester: '115-2', weekOneDate: '2027-02-26', holidays: [{ no: 3, reason: '停課' }], backupDate: '2026-07-16'
  });
  assert.deepEqual(next.speakers, source.speakers);
  assert.notEqual(next.speakers, source.speakers);
  assert.equal(next.settings.semester, '115-2');
  assert.equal(next.weeks.length, 18);  /* 17+1 制：W18＝期末驗收週 */
  assert.equal(next.weeks[2].date, '2027-03-12');
  assert.equal(next.weeks[2].holiday, '停課');
  assert.equal(next.weeks[17].no, 18);
  assert.match(next.weeks[17].note, /期末驗收/);
  assert.equal(next.talks.length, 12);
  assert.equal(next.talks[0].date, '2027-03-05');
  assert.equal(next.talks[1].date, '2027-03-19');
  assert.equal(next.talks[0].title, '');
  assert.equal(next.talks[0].checklist[0].done, false);
  assert.equal(next.expenses[0].amount, 6000);
  assert.equal(next.expenses[0].talkId, '');
  assert.deepEqual(next.templates, source.templates);
  assert.deepEqual(next.budgetLines, source.budgetLines);
  assert.match(admin, /下載舊學期快照並開始/);
  assert.match(admin, /SYNC\.user\.role!=='owner'/);
  assert.match(admin, /還有未同步改動或資料衝突/);
});

test('Editor 設定頁隱藏換學期動作，mock 角色與網址同步', () => {
  const locks = admin.match(/function applyRoleLocks\(\)\{[\s\S]*?\n}/)?.[0] || '';
  assert.match(locks, /semesterReset\.hidden=true/);
  assert.match(locks, /換學期只由計畫主持人/);
  assert.match(admin, /\['owner','editor','denied'\]\.includes\(mockRole\)/);
  assert.match(admin, /\$\('#devRole'\)\.value=ApiMock\.role/);
});

test('交通費估算可推測縣市、套用實價並只保留一條最新估算', () => {
  const start = admin.indexOf('const FARE_SNAPSHOT');
  const end = admin.indexOf('function rBudget');
  assert.ok(start >= 0 && end > start, '找不到交通費純函式');
  const helpers = new Function(`
    const money=n=>Number(n).toLocaleString('en-US');
    ${admin.slice(start, end)}
    return {FARE_SNAPSHOT,FARE_TO_ZHIXUE,guessCounty,fareEstimateLine,mergeFareEstimateNote};
  `)();
  assert.equal(helpers.FARE_SNAPSHOT, '2026-07-16');
  assert.equal(helpers.guessCounty('國立成功大學'), '台南市');
  assert.equal(helpers.FARE_TO_ZHIXUE['台南市'].oneWay * 2, 3930);
  assert.match(helpers.FARE_TO_ZHIXUE['台南市'].via, /高鐵→台北/);
  const old = '人工備註\n🚄 交通估算（花蓮縣）：舊資料';
  const line = helpers.fareEstimateLine('台南市');
  const merged = helpers.mergeFareEstimateNote(old, line);
  assert.match(merged, /^人工備註\n🚄 交通估算（台南市）/);
  assert.equal((merged.match(/🚄 交通估算/g) || []).length, 1);
  assert.match(merged, /來回 NT\$ 3,930/);
});

test('公開報名頁兩份來源一致；沒有可信來源時不宣稱檔期開放', () => {
  assert.equal(join, joinGas);
  compileInlineScripts(join, 'join.html');
  assert.match(join, /STATUS_SRC==='none'.*cls='pending';txt='檔期待確認'/s);
  assert.match(join, /不是即時空檔或保留檔期/);
  assert.doesNotMatch(join, /if\(STATUS_SRC==='none'\)\{cls='open'/);
});

test('production inbox 接線存在，Submissions 不進可寫同步表', () => {
  assert.match(admin, /let serverSubmissions=\[\]/);
  assert.match(admin, /importSubmission\(payload\).*call\('importSubmission'/s);
  assert.match(admin, /dismissSubmission\(payload\).*call\('dismissSubmission'/s);
  const tableLine = admin.match(/const SYNC_TABLES=\[([^\]]+)\]/)?.[1] || '';
  assert.doesNotMatch(tableLine, /Submissions/);
  assert.match(admin, /syncServerInbox\(snap\.tables\.Submissions\|\|\[\]\)/);
  const dismissFn = code.match(/function dismissSubmission\(payload\)[\s\S]*?\n}/)?.[0] || '';
  assert.match(dismissFn, /reasonLength:\s*reason\.length/);
  assert.doesNotMatch(dismissFn, /auditDetail\s*=\s*\{\s*reason:\s*reason/);
});

test('正式 GAS 模式採 fail-closed 且停用非交易式還原與範例資料', () => {
  assert.match(admin, /目前無法安全確認登入身分/);
  assert.match(admin, /fresh boot 取不到 whoami 一律 fail closed/);
  assert.match(admin, /正式多人版不提供非交易式 JSON 匯入/);
  assert.match(admin, /正式多人版已停用範例資料/);
  assert.match(admin, /if\(this\.offline\)location\.reload\(\)/);
});

test('Editor snapshot 不含 Users 與 AuditLog', () => {
  const { snapshotTablesForRole_ } = loadBackendHelpers();
  const editor = snapshotTablesForRole_('editor');
  assert.ok(editor.includes('Submissions'));
  assert.ok(editor.includes('Settings'));
  assert.ok(!editor.includes('Users'));
  assert.ok(!editor.includes('AuditLog'));
  const fn = code.match(/function getSnapshot\(args\)[\s\S]*?\n}/)?.[0] || '';
  assert.match(fn, /withScriptLock_\(/);
});

test('import target 只接受明確 type/id 契約', () => {
  const { sanitizeImportTarget_ } = loadBackendHelpers();
  assert.deepEqual(sanitizeImportTarget_({ type: 'speaker' }), { table: 'Speakers', id: '' });
  assert.deepEqual(sanitizeImportTarget_({ type: 'speaker', id: 'spk_1' }), { table: 'Speakers', id: 'spk_1' });
  assert.deepEqual(sanitizeImportTarget_({ type: 'talk', id: 't01' }), { table: 'Talks', id: 't01' });
  assert.throws(() => sanitizeImportTarget_({ type: 'talk' }), /需要 target\.id/);
  assert.throws(() => sanitizeImportTarget_({ type: 'speaker', speakerId: 'x' }), /契約外欄位/);
});

test('既有講者不會被空白報名欄位清空或降回較早狀態', () => {
  const { convertSubmission_ } = loadBackendHelpers();
  const existing = {
    name: '既有講者', title: '教授', org: '原單位', field: '原專長',
    email: 'old@example.invalid', phone: '0900000000', status: '已合作過', notes: '舊備註'
  };
  const submission = {
    mode: 'self', name: '既有講者', contact: '', org: '', topicsJson: '[]',
    preferredWeeksJson: '[]', anyWeek: false, proposedTitle: '', message: '', rawJson: '{}'
  };
  const patch = convertSubmission_(submission, 'Speakers', existing);
  assert.equal(patch.name, '既有講者');
  assert.equal(patch.notes, '舊備註｜報名頁自薦');
  for (const key of ['title', 'org', 'field', 'email', 'phone', 'status']) {
    assert.ok(!(key in patch), `${key} 不應被空白投稿覆寫`);
  }
});

test('JSON 欄位套用大小上限、身分證 pattern 與禁止個資鍵', () => {
  const { sanitizeJson_, hasTaiwanId_ } = loadBackendHelpers();
  const piiScan = loadAdminPiiScan();
  const notionUrl = 'https://example.invalid/p/portfolio-0123456789abcdef0123456789abcdef?source=copy_link';
  assert.equal(sanitizeJson_('{"ok":true}', 'rawJson'), '{"ok":true}');
  assert.equal(hasTaiwanId_(notionUrl), false);
  assert.equal(hasTaiwanId_('偏好：W8 2026-10-30'), false);
  assert.equal(hasTaiwanId_('A123456788'), true); // 疑似即攔，打錯檢查碼仍可能是個資
  assert.equal(hasTaiwanId_('A812345678'), true); // 新式外來人口統一證號格式
  assert.equal(hasTaiwanId_('AB12345678'), true); // 舊式外來人口統一證號格式
  assert.equal(hasTaiwanId_('AE12345678'), false); // 舊式第二碼只接受 A–D
  assert.equal(hasTaiwanId_('prefixA123456789suffix'), false);
  assert.equal(piiScan(notionUrl), false);
  assert.equal(piiScan('偏好：W8 2026-10-30'), false);
  assert.equal(piiScan('A123456788'), true);
  assert.equal(piiScan('A812345678'), true);
  assert.equal(piiScan('AB12345678'), true);
  assert.doesNotThrow(() => sanitizeJson_(JSON.stringify({ portfolio: notionUrl }), 'rawJson'));
  assert.throws(() => sanitizeJson_(JSON.stringify({ idNumber: 'hidden' }), 'rawJson'), /不可入庫個資欄位/);
  assert.throws(() => sanitizeJson_(JSON.stringify({ note: 'A123456789' }), 'rawJson'), /疑似不可入庫個資/);
  assert.throws(() => sanitizeJson_(JSON.stringify({ note: 'a123456789' }), 'rawJson'), /疑似不可入庫個資/);
  for (const key of ['national_id_number', 'bank_account_number', 'studentId', 'receiptImage']) {
    assert.throws(() => sanitizeJson_(JSON.stringify({ [key]: 'hidden' }), 'rawJson'), /不可入庫個資欄位/, key);
  }
  assert.throws(() => sanitizeJson_(JSON.stringify({ value: 'x'.repeat(50001) }), 'rawJson'), /超過長度限制/);
});

test('管理台 email 欄位保留合法地址，但拒絕公式與非法格式', () => {
  const { sanitizeValue_ } = loadBackendHelpers();
  assert.equal(sanitizeValue_('Speakers', 'email', 'Valid.User@Example.COM'), 'valid.user@example.com');
  assert.equal(sanitizeValue_('Talks', 'speakerEmail', ''), '');
  assert.throws(() => sanitizeValue_('Speakers', 'email', '=1+1'), /格式不符/);
  assert.throws(() => sanitizeValue_('Talks', 'speakerEmail', 'not-an-email'), /格式不符/);
  assert.throws(() => sanitizeValue_('Speakers', 'notes', 'a123456789'), /疑似不可入庫個資/);
});

test('公開收件端點把所有匿名文字公式轉成純文字', () => {
  const { sanitizeSub_, safeSheetText_, hasTaiwanId_ } = loadJoinBackendHelpers();
  const notionUrl = 'https://example.invalid/p/portfolio-0123456789abcdef0123456789abcdef?source=copy_link';
  assert.equal(safeSheetText_('=1+1', 120), "'=1+1");
  assert.equal(safeSheetText_('normal text', 120), 'normal text');
  const rec = sanitizeSub_({
    id: '-1', mode: 'self', name: '=IMPORTXML("https://example.invalid")',
    contact: 'person@example.invalid', topics: ['+SUM(1,1)'], recordPref: '@evil'
  });
  assert.equal(rec.name, "'=IMPORTXML(\"https://example.invalid\")");
  assert.equal(rec.contact, 'person@example.invalid');
  assert.equal(rec.clientId, "'-1");
  assert.equal(hasTaiwanId_('W8 2026-10-30'), false);
  assert.equal(rec.topics[0], "'+SUM(1,1)");
  assert.equal(rec.rawKeep.recordPref, "'@evil");
  assert.equal(hasTaiwanId_('A123456789'), true);
  assert.equal(hasTaiwanId_('a123456789'), true);
  assert.equal(hasTaiwanId_('身分證：A123456789。'), true);
  assert.equal(hasTaiwanId_('A1-23456789'), true);
  assert.equal(hasTaiwanId_('A8 12345678'), true);
  assert.equal(hasTaiwanId_('AB-12345678'), true);
  assert.equal(hasTaiwanId_('A123456788'), true);
  assert.equal(hasTaiwanId_('A812345678'), true);
  assert.equal(hasTaiwanId_('AB12345678'), true);
  assert.equal(hasTaiwanId_('AE12345678'), false);
  assert.equal(hasTaiwanId_('xAB12345678y'), false);
  assert.equal(hasTaiwanId_(notionUrl), false);
  assert.equal(hasTaiwanId_('ordinary text'), false);
});

test('whoami 對外宣告的權限不再包含尚未實作 API', () => {
  assert.doesNotMatch(code.match(/function permissionsFor_[\s\S]*?\n}/)?.[0] || '', /backup|restorePreview|purgeDeleted|exportPublicTalks/);
});

test('正式初始化鎖內交易、真實 actor，重跑預設不覆寫既有經費', () => {
  const { officialBudgetLines_ } = loadBackendHelpers();
  const official = officialBudgetLines_();
  assert.equal(official.length, 12);
  assert.equal(official.reduce((sum, line) => sum + line.budgetAmount, 0), 300000);
  const fn = code.match(/function bootstrapProduction\(\w*\)[\s\S]*?\n}/)?.[0] || '';
  assert.match(fn, /withScriptLock_\(/);
  assert.match(fn, /bootstrapSchema\(\)/);
  assert.match(fn, /role:\s*'owner'/);
  assert.match(fn, /officialBudgetLines_\(\)/);
  assert.match(fn, /overwriteExisting\s*=\s*input\.overwriteExisting\s*===\s*true/);
  assert.match(fn, /if\s*\(hit\s*&&\s*!overwriteExisting\)/);
  assert.match(fn, /schemaPlan\.auditDetail\s*=/);
  assert.match(fn, /commitPlans_\(/);
  assert.match(code.match(/function commitPlans_\([\s\S]*?\n}/)?.[0] || '', /context:\s*plan\.auditDetail/);
  assert.doesNotMatch(fn, /upsertSeedRow_\(/);
  assert.doesNotMatch(fn, /seedBudgetLinesOfficial\(\)/);
  assert.doesNotMatch(fn, /seedFakeData\(\)/);

  const devSeed = code.match(/function seedBudgetLinesOfficial\(\w*\)[\s\S]*?\n}/)?.[0] || '';
  assert.match(devSeed, /withScriptLock_\(/);
  assert.match(devSeed, /overwriteExisting\s*=\s*input\.overwriteExisting\s*===\s*true/);
  assert.match(devSeed, /if\s*\(hit\s*&&\s*!overwriteExisting\)/);
});

test('GAS 轉接層的無參數 API 不傳 undefined', () => {
  const api = admin.match(/const ApiGas=\{[\s\S]*?\n\};/)?.[0] || '';
  assert.match(api, /if\(arg===undefined\)runner\[fn\]\(\)/);
  assert.match(api, /else runner\[fn\]\(arg\)/);
  assert.match(api, /whoami\(\)\{return this\.call\('whoami'\);\}/);
  assert.doesNotMatch(api, /withFailureHandler\(rej\)\[fn\]\(arg\)/);
});

test('公開端點驗證必填、冪等重送且 Cache 失敗不翻轉已落地結果', () => {
  const { sanitizeSub_, hasClientId_ } = loadJoinBackendHelpers();
  assert.equal(sanitizeSub_({ mode: 'self', name: '甲', contact: '' }), null);
  assert.equal(sanitizeSub_({ mode: 'recommend', name: '甲', contact: 'a@example.invalid', recName: '' }), null);
  assert.equal(sanitizeSub_({ mode: 'recommend', name: '甲', contact: 'a@example.invalid', recName: '乙' }).recName, '乙');

  const sheet = {
    getLastRow: () => 3,
    getRange: (row, col, count, width) => {
      assert.deepEqual([row, col, count, width], [2, 21, 2, 1]);
      return { getDisplayValues: () => [['client-a'], ['client-b']] };
    }
  };
  assert.equal(hasClientId_(sheet, 'client-b'), true);
  assert.equal(hasClientId_(sheet, 'client-c'), false);
  assert.equal(hasClientId_(sheet, 'anon'), false);

  const proc = joinCode.slice(joinCode.indexOf('function processSubmission_'), joinCode.indexOf('/** 新報名通知'));
  assert.ok(proc.indexOf('sanitizeSub_') < proc.indexOf('hasTaiwanId_'), '必須先 allowlist 消毒，再掃完整收件內容');
  assert.ok(proc.indexOf('hasTaiwanId_') < proc.indexOf('sheetId_'), 'PII 必須在取得資料表與落地前攔截');
  assert.ok(proc.indexOf('hasClientId_') < proc.indexOf('CacheService.getScriptCache()'), '必須先查重再節流');
  assert.ok(proc.indexOf('.setValues(') < proc.indexOf('cache.put('), '必須先落地再寫節流快取');
  assert.match(proc, /try\s*\{[\s\S]*cache\.put\(hourKey[\s\S]*cache\.put\(cliKey[\s\S]*\}\s*catch\s*\(cacheErr\)/);
  assert.match(proc, /duplicate:\s*true/);
  assert.match(join, /let pendingSubmission=null/);
  assert.match(join, /pendingSubmission\.draftKey!==draftKey/);
  assert.match(join, /const rec=pendingSubmission\.rec/);
  assert.match(join, /const showDone=\(\)=>\{pendingSubmission=null/);
});

test('公開檔期只回日期與狀態，已確認日期在報名頁停用', () => {
  const { publicScheduleFromRows_ } = loadJoinBackendHelpers();
  const headers = ['id', 'updatedAt', 'updatedBy', 'version', 'isDeleted', 'no', 'status', 'date',
    'time', 'venue', 'title', 'abstract', 'moeJson', 'speakerId', 'speakerName', 'speakerTitle',
    'speakerOrg', 'speakerEmail', 'speakerPhone', 'notes'];
  const row = values => headers.map(key => values[key] ?? '');
  const publicRows = publicScheduleFromRows_([
    headers,
    row({ id: 't1', status: '已確認', date: '2026-11-06', speakerEmail: 'private@example.invalid', notes: '私密備註' }),
    row({ id: 't2', status: '邀約中', date: '2026-10-30', speakerPhone: '0900000000' }),
    row({ id: 't3', status: '已完成', date: '2026-09-18', speakerName: '不應公開' }),
    row({ id: 't4', status: '構想中', date: '2026-11-13' }),
    row({ id: 't5', status: '已確認', date: '2026-12-04', isDeleted: true })
  ]);
  assert.deepEqual(publicRows, [
    { date: '2026-09-18', status: 'done' },
    { date: '2026-10-30', status: 'negotiating' },
    { date: '2026-11-06', status: 'confirmed' }
  ]);
  const json = JSON.stringify(publicRows);
  assert.doesNotMatch(json, /private|0900|備註|不應公開|speaker/i);
  assert.match(joinCode, /e\.parameter\.schedule/);
  assert.match(join, /PUBLIC_TALKS_URL=ENDPOINT\?ENDPOINT\+'\?schedule=1'/);
  assert.match(join, /const suffix=locked\?'・已確認'/);
  assert.match(join, /locked\?' disabled':''/);
});

test('所有電話與聯絡欄以文字格式寫入，保留 090 前導零', () => {
  const fields = code.match(/const TEXT_FORMAT_FIELDS\s*=\s*\[([\s\S]*?)\];/)?.[1] || '';
  for (const field of ['phone', 'speakerPhone', 'contact', 'recContact']) assert.match(fields, new RegExp(`['"]${field}['"]`));
  assert.match(joinCode, /getRange\(rowIndex,\s*9,\s*1,\s*1\)\.setNumberFormat\('@'\)/);
  assert.match(joinCode, /getRange\(rowIndex,\s*19,\s*1,\s*1\)\.setNumberFormat\('@'\)/);
  assert.match(joinCode, /getRange\(1,\s*9,\s*sh\.getMaxRows\(\),\s*1\)\.setNumberFormat\('@'\)/);
  assert.match(joinCode, /getRange\(1,\s*19,\s*sh\.getMaxRows\(\),\s*1\)\.setNumberFormat\('@'\)/);
});

test('localStorage 主草稿寫入失敗會回復上一個已保存版本', () => {
  const restoreFn = admin.match(/function restoreLastPersistedDb\(\)\{[\s\S]*?\n\}/)?.[0] || '';
  const persistFn = admin.match(/function persistMainDraft\(json\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(restoreFn && persistFn, '找不到草稿持久化函式');
  const run = new Function(`
    let db={value:'new'};
    let lastPersistedDbJson='{"value":"old"}';
    const LS_KEY='test.db';
    const localStorage={setItem(){throw new Error('quota');}};
    const normalize=x=>x,defaultDB=()=>({value:'default'});
    const window={SYNC:{lastErr:null,ready:false,paintPill(){}}};
    const SYNC=window.SYNC;
    const toast=()=>{},render=()=>{};
    const console={error(){}};
    ${restoreFn}
    ${persistFn}
    return () => ({ok:persistMainDraft(JSON.stringify(db)),db,lastPersistedDbJson});
  `)();
  assert.deepEqual(run(), { ok: false, db: { value: 'old' }, lastPersistedDbJson: '{"value":"old"}' });
  assert.doesNotMatch(admin, /(?:^|[;{}])\s*save\(\);/m);
  assert.doesNotMatch(admin, /(?:^|[;{}])\s*saveExpenses\([^)]*\);/m);
});

test('同步 pull／push 互斥，首次 pull 前不開畫面，輸入聚焦時不輪詢', () => {
  assert.match(admin, /pulling:false,pushPending:false,pullPending:false/);
  assert.match(admin, /if\(this\.pulling\)\{this\.pushPending=true/);
  assert.match(admin, /if\(this\.inflight\)\{this\.pullPending=true;return false;\}/);
  assert.match(admin, /finally\{[\s\S]*this\.pulling=false/);
  const firstPullAt=admin.indexOf('const initialPull=this.offline?false:await this.pull(true,bootSnapshot,true);');
  assert.ok(firstPullAt>=0 && firstPullAt < admin.indexOf("veil.classList.add('hide');"));
  assert.match(admin, /hasActiveEditor\(\)[\s\S]*document\.activeElement/);
  assert.match(admin, /!this\.pulling&&!this\.hasActiveEditor\(\)\)this\.pull\(true\)/);
});

test('同步 metadata 半寫失敗會回滾，pull metadata 失敗會還原 db 與 baseline', () => {
  const meta = admin.match(/persistMeta\(\)\{[\s\S]*?\r?\n  \},\r?\n  loadMeta/)?.[0] || '';
  const pull = admin.match(/async pull\(silent,prefetched,deferRender\)\{[\s\S]*?\r?\n  \},\r?\n\r?\n  \/\* 把/)?.[0] || '';
  assert.match(meta, /oldB=localStorage\.getItem/);
  assert.match(meta, /if\(wroteB\)/);
  assert.match(meta, /localStorage\.setItem\(bk,oldB\)/);
  assert.match(pull, /const oldDbJson=lastPersistedDbJson/);
  assert.match(pull, /const oldPhantomDel=new Set/);
  assert.match(pull, /this\.baseline=oldBaseline;this\.conflicts=oldConflicts;serverSubmissions=oldServerSubmissions/);
  assert.match(pull, /this\.phantomDel=oldPhantomDel;this\.lastSync=oldLastSync/);
  assert.match(pull, /localStorage\.setItem\(LS_KEY,oldDbJson\)/);
});

test('dev/staging 破壞性測試有 Script Property 閘，production 預設關閉', () => {
  const guard = code.match(/function assertDestructiveTestsAllowed_\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(guard, /ALLOW_DESTRUCTIVE_TESTS/);
  assert.match(guard, /===\s*'true'/);
  assert.match(code.match(/function seedFakeData\(\)[\s\S]*?\n\}/)?.[0] || '', /assertDestructiveTestsAllowed_\(\)/);
  assert.match(code.match(/function seedBudgetLinesOfficial\(\w*\)[\s\S]*?\n\}/)?.[0] || '', /if\s*\(overwriteExisting\)\s*assertDestructiveTestsAllowed_\(\)/);
  assert.match(code.match(/function bootstrapProduction\(\w*\)[\s\S]*?\n\}/)?.[0] || '', /if\s*\(overwriteExisting\)\s*assertDestructiveTestsAllowed_\(\)/);
  assert.match(w1Code, /function runW1Suite\(\)[\s\S]*?assertDestructiveTestsAllowed_\(\)/);
  assert.match(v2GasTests, /function runV2CompletionSuite\(\)[\s\S]*?assertDestructiveTestsAllowed_\(\)/);
});

test('試算表 ID 只從 Script Properties 讀取，未硬編碼進 repo', () => {
  for (const [label, source] of [['管理台', code], ['公開報名', joinCode]]) {
    assert.doesNotMatch(source, /const\s+SHEET_ID\s*=/, `${label} 不得硬編碼 SHEET_ID`);
    assert.match(source, /const\s+SHEET_ID_PROPERTY\s*=\s*['"]SHEET_ID['"]/);
    const helper = source.match(/function sheetId_\(\)[\s\S]*?\n}/)?.[0] || '';
    assert.match(helper, /PropertiesService\.getScriptProperties\(\)\.getProperty\(SHEET_ID_PROPERTY\)/);
    assert.match(helper, /\^\[A-Za-z0-9_-\]\{20,200\}\$/);
    assert.match(helper, /未設定或格式錯誤/);
  }
  assert.match(code.match(/function ss_\(\)[\s\S]*?\n}/)?.[0] || '', /openById\(sheetId_\(\)\)/);
  assert.match(code.match(/function dataStoreKey_\(\)[\s\S]*?\n}/)?.[0] || '', /\+ sheetId_\(\)/);
  assert.match(joinCode, /const sheetId = sheetId_\(\)/);
  assert.match(joinCode, /ensureSheet_\(sheetId\)/);
  assert.match(joinCode, /notifySubmission_\(rec, savedRow, sheetId\)/);
  assert.match(joinCode, /openById\(sheetId\)/);
  assert.doesNotMatch(code + joinCode, /['"][A-Za-z0-9_-]{30,}['"]\s*;\s*\/\/.*Sheet/);
});

/* ===== schema v2（2026-07-20 成果報告改版）===== */

test('schema v2 常數與新欄位前後端一致，前端不再硬編 schemaVersion:1', () => {
  assert.match(code, /const SCHEMA_VERSION = 2/);
  assert.match(admin, /const SCHEMA_VERSION=2/);
  assert.doesNotMatch(admin, /schemaVersion:1[^0-9]/);
  const talkFields = code.match(/Talks:\s*\[([^\]]+)\]/)?.[1] || '';
  for (const f of ['reportBlurb', 'evidenceJson', 'eventUuid']) assert.match(talkFields, new RegExp(`'${f}'`), f);
  const spkFields = code.match(/Speakers:\s*\[([^\]]+)\]/)?.[1] || '';
  for (const f of ['education', 'experience']) assert.match(spkFields, new RegExp(`'${f}'`), f);
  assert.match(code, /'courseInstanceId'/);
  assert.match(admin, /SETTINGS_SYNC_KEYS=\['settings','checklistTpl','reimbTpl','templates','courseInstanceId'\]/);
});

test('指標改版為負責任 AI 六面向；舊草稿值遷移、佐證物件消毒', () => {
  const start = admin.indexOf('const MOE=[');
  const end = admin.indexOf('const DEF_CHECKLIST');
  assert.ok(start >= 0 && end > start, '找不到 MOE 指標區塊');
  const helpers = new Function(`${admin.slice(start, end)}\nreturn {MOE, MOE_KEYS, migrateMoe, blankEvidence, normEvidenceObj, EVIDENCE_SLOTS};`)();
  assert.deepEqual(helpers.MOE_KEYS, ['b1_ethics', 'b1_rights', 'b2_risk', 'b2_verify', 'b3_impact', 'b3_account']);
  assert.deepEqual(
    helpers.migrateMoe(['legal', 'ethical', 'application', 'b2_risk', 'b2_risk', 'junk']),
    ['b1_ethics', 'b2_risk']
  );
  assert.deepEqual(helpers.migrateMoe(null), []);
  const ev = helpers.normEvidenceObj({ slides: ['https://a', 'http://b'], photos: 'x' });
  assert.deepEqual(ev, { slides: ['https://a', '', '', ''], photos: ['', '', '', ''] });
  assert.equal(helpers.EVIDENCE_SLOTS.slides.length, 4);
  assert.equal(helpers.EVIDENCE_SLOTS.photos.length, 4);
  assert.doesNotMatch(admin, /\{k:'legal',label/);
  assert.match(admin, /moeIndicators:\['b1_ethics','b1_rights','b2_risk','b2_verify','b3_impact','b3_account'\]/);
});

test('reportBlurb/evidenceJson/eventUuid 伺服器驗證：150 字上限、僅收 https、格式白名單', () => {
  const { sanitizeValue_ } = loadBackendHelpers();
  assert.equal(sanitizeValue_('Talks', 'reportBlurb', '從智慧醫療案例談資料治理與病人隱私'), '從智慧醫療案例談資料治理與病人隱私');
  assert.throws(() => sanitizeValue_('Talks', 'reportBlurb', 'x'.repeat(151)), /150 字上限/);
  const okEv = JSON.stringify({ slides: ['https://a', '', '', ''], photos: ['', '', '', ''] });
  assert.equal(sanitizeValue_('Talks', 'evidenceJson', okEv), okEv);
  assert.throws(
    () => sanitizeValue_('Talks', 'evidenceJson', JSON.stringify({ slides: ['http://x', '', '', ''], photos: ['', '', '', ''] })),
    /https/
  );
  assert.throws(
    () => sanitizeValue_('Talks', 'evidenceJson', JSON.stringify({ slides: ['', '', '', '', ''], photos: [] })),
    /至多 4 項/
  );
  assert.equal(sanitizeValue_('Talks', 'eventUuid', ''), '');
  assert.equal(sanitizeValue_('Talks', 'eventUuid', 'ev_abc-123'), 'ev_abc-123');
  assert.throws(() => sanitizeValue_('Talks', 'eventUuid', 'bad uuid!'), /格式不符/);
});

test('eventUuid 由伺服器保留或補發；migrateToV2 升版流程存在且冪等', () => {
  const plan = code.match(/function planChange_\([\s\S]*?\n}/)?.[0] || '';
  assert.match(plan, /keepUuid \|\| cleanString_\(after\.eventUuid \|\| ''\)\.trim\(\) \|\| \('ev_' \+ Utilities\.getUuid\(\)\)/);
  const mig = code.match(/function migrateToV2\(\)[\s\S]*?\n}/)?.[0] || '';
  assert.ok(mig, '找不到 migrateToV2');
  assert.match(mig, /withScriptLock_\(/);
  assert.match(mig, /assertOwnerSelf_\(\)/);
  assert.match(mig, /bootstrapSchema\(\)/);
  assert.match(mig, /'schemaMigrate'/);
  assert.match(mig, /legal: 'b1_ethics', ethical: 'b1_ethics'/);
  assert.match(mig, /courseInstanceId/);
  assert.match(mig, /已是 v2、無需變更/);
  /* 前端不生成 eventUuid：只在有值時輸出，且伺服器快照值原樣回填 */
  assert.match(admin, /if\(t\.eventUuid\)rec\.eventUuid=t\.eventUuid/);
  assert.match(admin, /eventUuid:String\(r\.eventUuid\|\|''\)/);
});

test('場次頁有成果報告資料區；經費頁可印期中/期末成果報告資料包', () => {
  assert.match(admin, /id="sec-report"/);
  assert.match(admin, /data-field="talk\.reportBlurb"/);
  assert.match(admin, /maxlength="150"/);
  assert.match(admin, /data-evd data-id/);
  assert.match(admin, /if\(el\.dataset\.evd!==undefined\)/);
  assert.match(admin, /function buildReportBundleBody\(mode\)/);
  assert.match(admin, /data-act="reportBundle" data-mode="mid"/);
  assert.match(admin, /data-act="reportBundle" data-mode="final"/);
  assert.match(admin, /case 'reportBundle':printReportBundle/);
  assert.match(admin, /學經歷與專長簡介/);
  assert.match(admin, /收支明細報告表/);
});

test('信件範本含成果報告授權句與講座回饋句；舊預設草稿自動換新', () => {
  assert.match(admin, /簡報的封面與部分相關頁面用於本課程成果報告/);
  assert.match(admin, /講座教師回饋整理進教育部成果報告/);
  assert.match(admin, /const DEF_TPL_LEGACY=/);
  assert.match(admin, /d\.templates\.invite===DEF_TPL_LEGACY\.invite/);
  assert.match(admin, /d\.templates\.thanks===DEF_TPL_LEGACY\.thanks/);
});

test('手機版：佐證連結列標籤上置滿版、報告資料包窄螢幕橫向捲動', () => {
  /* 佐證連結列改用 .evrow（不動核銷 .evline），≤480px 標籤整行、輸入框滿版 */
  assert.match(admin, /\.evrow\{display:flex;align-items:center;gap:8px;margin:3px 0\}/);
  assert.match(admin, /\.evrow \.evlbl\{min-width:118px[^}]*flex:none/);
  assert.match(admin, /\.evrow input\{flex:1;min-width:0/);
  assert.match(admin, /@media\(max-width:480px\)\{\s*\.evrow\{flex-wrap:wrap\}[\s\S]*?\.evrow input\{flex:1 1 100%\}/);
  assert.match(admin, /<div class="evrow">/);
  assert.match(admin, /<span class="evlbl mut sm"/);
  assert.doesNotMatch(admin, /class="evline" style="margin:3px 0"/);   /* 舊固定 118px 版已移除 */
  /* 報告資料包直式列印：螢幕上窄螢幕框內橫向捲動，列印不受影響（@media screen 限定） */
  assert.match(admin, /@media screen\{#printDoc\.report\{overflow-x:auto\}#printDoc\.report table\{min-width:600px\}\}/);
  assert.match(admin, /classList\.toggle\('report',!!opts\.report\)/);
  assert.match(admin, /\$\('#printDoc'\)\.classList\.remove\('report'\)/);
  assert.match(admin, /openPrintWin\(`\$\{label\}成果報告資料包`,buildReportBundleBody\(mode\),\s*\{report:true/);
});

test('手機版無障礙打磨：面向 checkbox 44px 觸控、佐證連結各自命名、學經歷可換行', () => {
  /* 六面向 checkbox label 觸控高度對齊 .ckline 44px 標準 */
  assert.match(admin, /\.moewrap label\{[^}]*min-height:44px[^}]*\}/);
  /* 佐證「開啟↗」連結各自具區別性 aria-label（避免 8 個同名連結），且有觸控 padding */
  assert.match(admin, /rel="noopener" aria-label="開啟 \$\{title\}：\$\{lb\}">開啟↗<\/a>/);
  assert.match(admin, /\.evrow a\{[^}]*padding:6px 4px[^}]*\}/);
  /* 佐證標籤 span 已 aria-hidden（輸入框自帶 aria-label，避免重複朗讀） */
  assert.match(admin, /<span class="evlbl mut sm" aria-hidden="true">/);
  /* 講者卡學經歷值套 .spkcontact（overflow-wrap:anywhere），長字串不溢位 */
  assert.match(admin, /學經歷（報告用）<\/div><div class="spkcontact">/);
});

test('v1 舊 baseline 載入時就地升 v2，不產生幽靈待送或衝突', () => {
  const moeStart = admin.indexOf('const MOE=[');
  const moeEnd = admin.indexOf('const DEF_CHECKLIST');
  const upStart = admin.indexOf('function upgradeBaselineToV2');
  const upEnd = admin.indexOf('function mapDbToRecords', upStart);
  assert.ok(moeStart >= 0 && upStart >= 0 && upEnd > upStart, '找不到 baseline 升級函式');
  const upgrade = new Function(`${admin.slice(moeStart, moeEnd)}\n${admin.slice(upStart, upEnd)}\nreturn upgradeBaselineToV2;`)();
  const base = {
    Talks: { t01: { rec: { no: 1, moeJson: '["legal","application"]', notes: '' }, updatedAt: 'x', version: 3 } },
    Speakers: { s1: { rec: { name: '講者' }, updatedAt: 'y', version: 1 } }
  };
  upgrade(base);
  assert.equal(base.Talks.t01.rec.moeJson, '["b1_ethics"]');
  assert.equal(base.Talks.t01.rec.reportBlurb, '');
  assert.equal(base.Talks.t01.rec.evidenceJson, JSON.stringify({ slides: ['', '', '', ''], photos: ['', '', '', ''] }));
  assert.equal(base.Talks.t01.rec.eventUuid, undefined); /* eventUuid 伺服器所有，前端不補 */
  assert.equal(base.Talks.t01.version, 3); /* 樂觀鎖中繼資料不動 */
  assert.equal(base.Speakers.s1.rec.education, '');
  assert.equal(base.Speakers.s1.rec.experience, '');
  assert.match(admin, /upgradeBaselineToV2\(this\.baseline\)/);
});

test('講者庫學歷/經歷欄位打通：對話框、normalize、同步映射', () => {
  assert.match(admin, /id="spk_education"/);
  assert.match(admin, /id="spk_experience"/);
  assert.match(admin, /education:String\(p\.education\|\|''\),experience:String\(p\.experience\|\|''\)/);
  assert.match(admin, /education:p\.education\|\|'',experience:p\.experience\|\|''/);
  assert.match(admin, /education:r\.education\|\|'',experience:r\.experience\|\|''/);
});

test('資料環境與帳號雙重分鍵，舊後端缺 dataStoreKey 時 fail closed', () => {
  assert.match(code, /dataStoreKey:\s*dataStoreKey_\(\)/);
  assert.match(admin, /this\.storeKey=dataStoreKey/);
  assert.match(admin, /k\(suffix\)\{return LS_BASE\+'\.'\+this\.storeKey\+'\.'\+\(this\.user\?this\.user\.email:'anon'\)/);
  assert.match(admin, /後端版本過舊或資料環境識別失敗/);
  assert.doesNotMatch(admin, /lastUser/);
  const readInboxFn = admin.match(/function readInbox\(\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(readInboxFn, /SYNC\.mode==='gas'\)return serverSubmissions/);
});
