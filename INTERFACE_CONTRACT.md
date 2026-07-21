# INTERFACE_CONTRACT.md — 演講管理台 v2 API 契約（v0.3）

> **v0.3（2026-07-20，成果報告改版；`schemaVersion` 1 → 2）**：教育部「期中/期末成果報告」正式格式到位（存你自己的計畫資料夾），schema 升 v2——
> ① `Talks` 尾端加 `reportBlurb`（報告七(一)「授課主題與負責任 AI 對應面向」，≤150 字）、`evidenceJson`（報告七(二)佐證 8 格：`{slides:[4],photos:[4]}`，逐格空值或 `https://`）、`eventUuid`（場次永久識別，**伺服器所有**：`planChange_` 更新一律保留既有值、新列/空值補發 `ev_+UUID`；前端只回傳不生成）。
> ② `Speakers` 尾端加 `education`、`experience`（報告七(一)「學經歷與專長簡介」）。
> ③ `Settings` 鍵新增 `courseInstanceId`（學期課程實例 id；migrateToV2 種入、換新學期由前端重生）。
> ④ `moeJson` 值域改「負責任 AI 六面向」：`b1_ethics`／`b1_rights`／`b2_risk`／`b2_verify`／`b3_impact`／`b3_account`（舊 `legal`/`ethical`→`b1_ethics` 併同，`application` 移除並記至 notes）。
> ⑤ 既有 Sheet 由 Owner 執行一次 `migrateToV2()`（冪等；bootstrapSchema 擴表頭＋轉 moeJson＋補 eventUuid＋Settings 升 '2'＋種 courseInstanceId；AuditLog `schemaMigrate`）。**新欄位一律附加各表尾端，既有欄位位置不可動。**

> **歷史狀態（保留版本沿革）：v0.2＝Phase 1 開工基準**（2026-07-10 凍結 v0.1；2026-07-11 升 v0.2：官方「執行經費表」PDF 到位 → 加 `BudgetLines`＋`Expenses` 兩分頁與計畫經費頁；§D 補 `not_implemented` 過渡碼；當時 `schemaVersion` 維持 1）。**現行＝v0.3、`schemaVersion` 2**（見上一則）。
> **v0.2.1（2026-07-12，W1 驗收落地勘誤）**：①§F `entityType` 補 `BudgetLines`／`Expenses`（v0.2 加表時漏列）②`Expenses.evidenceUrl`＝**https 限定、空值可**（伺服器端 `validation` 擋，與 demo `EV()` 同規）③日期時間類欄位（`updatedAt/date/time/sentDate/paidDate/doneDate/receivedAt/eventAt`）伺服器一律鎖 `@` 文字格式存放——字串原樣進出，禁止 Sheets 自動轉 Date（W1 實測序號位移 bug）④dev Sheet 的 `TestResults` 為驗收工具分頁、非契約資料；`backup`／`purgeDeleted` 等實作以 `TABLE_ORDER` 為準、不掃契約外分頁。（W1 實機驗收 29/29 PASS）。
> **v0.2.3（2026-07-18，開機效能）**：新增 `getBootstrap`，把 allowlist 身分確認與首次資料快照合成一次 Apps Script 呼叫；同次快照共用一個 Spreadsheet 連線，讀取熱路徑不再逐頁重驗 schema。權限、資料表與 fail-closed 邊界不變。
>
> **v0.2.2（2026-07-16，正式使用前收尾）**：`importSubmission`／`dismissSubmission` 已在程式完成，管理台可讀伺服器 `Submissions` 收件匣；Editor 快照不回傳 `Users`／`AuditLog`，軟刪除資料只限 Owner 讀取；JSON 欄位補齊長度、身分證格式與禁止個資鍵掃描。以下標為「延後」的 API 雖保留 stub 方便後續開發，但不會出現在 `permissions`，也沒有正式 UI 入口，**不得視為可用功能**。本版以 Google Sheet 版本紀錄＋管理畫面資料快照作為復原手段；Drive／Gmail 自動化移至通用核心後續里程碑。
> 起草與凍結由前後端維護者分工（C 案：一方寫 GAS、一方寫前端，本檔就是兩邊對接的唯一真理）。
> 原則：**Sheet＝唯一正式真值；前端只做樂觀更新與佇列；所有 client 傳入資料一律 allowlist 消毒；伺服器端判權限。**

> 場次資料包、Drive 附件索引、學生回饋與報告產生器不屬於本契約範圍（其中 `courseInstanceId`／`eventUuid` 已隨 schema v2 先行加入）。後續若開工再另立架構文件；不可把資料夾當第二套正式真值。

## 凍結裁決（對 v0 草案的修訂，2026-07-10）

1. **`Weeks` 獨立成分頁**（草案原收進 Settings）——weeks 含排程用 `talkId`，是 Editor 日常要改的營運資料；收進 Settings 會被「Settings 限 Owner 寫」鎖死。Weeks 由 COURSE_PROFILE 種入，Editor 可寫。
2. **`recordPref`（錄影意願）**——v0.1 曾刪除；現行報名頁已收集此欄（選填、20 字純文字），管理台收件匣會顯示，轉入講者庫時併入備註。
3. **收件分頁名統一 `Submissions`**——現行收件端點寫「講者報名」分頁，Phase 1 遷移時改 `SHEET_NAME` 常數，不留 alias。
4. **`exportPublicTalks` 格式＝Hub 既有 `talks.schema.json`**（沿用 v1 `hubJson()`＋`hubWarnings()` 預檢），外加頂層 `generatedAt`。公開欄位以 hub schema 為準；**絕不含 email／phone／核銷／行政進度**。
5. **`Settings` 的 `settings` 鍵展開＝v1 `defaultSettings()` 鍵**（courseName／shortName／semester／weekday／room／defaultHours／defaultRate／budget 等，照 COURSE_PROFILE 落地）。
6. **`Users` 加 `note` 欄**（對齊 phase0-diagnostic 的 Users 分頁）。
7. **實際還原 API（restoreApply）延後**——本版復原靠 Sheet 版本紀錄，另可手動下載管理畫面資料快照作額外保險；`restorePreview` 目前也只是未啟用的延後 stub。待通用核心規劃完整伺服器備份／還原時再議。
8. 其餘照 v0 草案凍結如下。

---

## A. Sheet 分頁與欄位

**共用同步欄**：每個分頁每筆都帶 `id`、`updatedAt`、`updatedBy`、`version`、`isDeleted`。`updatedAt／updatedBy／version` 由**伺服器端**寫入；刪除一律先軟刪除（`isDeleted=true`）。未來若實作永久清除，`purgeDeleted` 只給 Owner；本版仍是延後 stub。

| 分頁 | 業務欄位 | 寫入權 |
|---|---|---|
| `Speakers` | `name`, `title`, `org`, `field`, `email`, `phone`, `status`, `notes`, `education`, `experience` | Owner／Editor |
| `Talks` | `no`, `status`, `date`, `time`, `venue`, `title`, `abstract`, `moeJson`, `speakerId`, `speakerName`, `speakerTitle`, `speakerOrg`, `speakerEmail`, `speakerPhone`, `notes`, `reportBlurb`, `evidenceJson`, `eventUuid` | Owner／Editor（`eventUuid` 伺服器所有） |
| `Weeks` | `no`, `date`, `holiday`, `note`, `talkId` | Owner／Editor（排程用；由 COURSE_PROFILE 種入） |
| `Tasks` | `talkId`, `off`, `label`, `done`, `doneDate` | Owner／Editor（源自 v1 `talk.checklist[]`） |
| `Reimbursements` | `talkId`, `hours`, `rate`, `transport`, `other`, `status`, `itemsJson`, `sentDate`, `paidDate`, `note` | Owner／Editor（源自 v1 `talk.fee`＋`talk.reimb`；每場一列） |
| `Submissions` | `receivedAt`, `mode`, `name`, `contact`, `org`, `topicsJson`, `proposedTitle`, `preferredWeeksJson`, `anyWeek`, `message`, `recName`, `recOrg`, `recWhy`, `recContact`, `source`, `clientId`, `rawJson` | 公開收件端點（專案 B）append-only；管理台只讀＋轉入 |
| `BudgetLines` | `category`, `item`, `unitPrice`, `unit`, `qty`, `budgetAmount`, `note` | Owner／Editor（科目自「執行經費表」種入，以下為示範金額、clone 後照核定經費表改：講座鐘點費 100,000／講座二代健保 2,110／講師交通費 20,000／臨時人員費 40,000／臨時人員勞健退 8,000／主持費 12,000＋健保 253／指導費 12,000＋健保 253／印刷費 50,000／雜支 28,384＋行政管理費 27,000；示範總額 300,000，全學年口徑） |
| `Expenses` | `budgetLineId`, `date`, `amount`, `desc`, `talkId`, `evidenceUrl`, `status` | Owner／Editor（支出流水；講座類科目可由場次 fee 彙總、其餘手記；`evidenceUrl`＝憑證檔 Drive 連結；兩期撥款＝第 1 期 150,000／第 2 期＝核定總額−150,000（示範總額 300,000 時＝150,000），第 2 期需期限前期中報告＋執行率 90%——經費頁以此做紅綠燈） |
| `Users` | `email`, `role`, `note` | **只有 Owner** |
| `AuditLog` | 見 §F | **只有伺服器**（client 不可寫） |
| `Settings` | `key`, `valueJson`（鍵：`schemaVersion`, `settings`, `checklistTpl`, `reimbTpl`, `templates`, `lastBackup`, `courseInstanceId`） | **只有 Owner** |

**個資紅線（沿用 v1 契約）**：schema 不設身分證字號、戶籍地址、銀行帳號或學生個資專用欄位；系統不保存領據／憑證二進位檔，只允許 `evidenceUrl` 保存私有 Drive 的 `https://` 連結。伺服器會以不分大小寫的台灣身分證格式與禁止 JSON 鍵硬拒絕（`pii_detected`）；自由文字無法可靠辨識所有地址、銀行帳號或學生資料，故 UI 與作業規範明確禁止輸入。公開報名若誤填，管理者必須「略過」，不得轉入講者庫。

`Submissions.clientId` 是公開頁每次表單生成的冪等鍵：專案 B 在 ScriptLock 內先查全部列（包含已軟刪除列），重送同一鍵回 `{ok:true, duplicate:true}`，不得新增第二列或重寄通知。自薦必填 `name`＋`contact`；推薦另必填 `recName`。`contact`／`recContact` 與管理資料的 `phone`／`speakerPhone` 均以文字格式寫入 Sheet，保留 `090...` 前導 0。

## B. API 清單（管理台＝專案 A；全部伺服器端先過 allowlist＋角色）

| API | 參數 | 回傳 | 權限 |
|---|---|---|---|
| `whoami()` | 無 | `{ok, email, role, permissions, dataStoreKey, schemaVersion, serverTime}`；`dataStoreKey` 是由 Sheet ID 雜湊出的不可逆環境識別碼，前端用它與 email 分隔草稿；缺少或格式不符時前端 fail closed。非 allowlist 只回拒絕、不回資料 | 任何登入者 |
| `getBootstrap({includeDeleted=false})` | 開機專用；參數同 `getSnapshot` | 合併 `whoami` 與 `getSnapshot` 的欄位；非 allowlist 只回錯誤、不回資料 | Owner／Editor |
| `getSnapshot({includeDeleted=false})` | 是否含軟刪除 | `{schemaVersion, generatedAt, serverTime, tables}` | Owner／Editor |
| `saveBatch(envelope)` | 見 §C | 成功結果或衝突／驗證錯誤 | Owner／Editor；`Users`／`Settings` 寫入限 Owner；`AuditLog` 不接受 client 寫 |
| `importSubmission({submissionId, target, patch})` | 轉入講者庫：`target={type:'speaker', id?}`；或轉入既有場次：`target={type:'talk', id}`。`patch` 走目標資料表 allowlist；報名空白欄位不覆蓋既有講者資料 | `{ok, createdIds, updatedIds, auditLogIds}`；目標寫入與原報名軟刪除同一交易 | Owner／Editor；**已實作，待正式 Sheet 實機驗收** |
| `dismissSubmission({submissionId, reason?})` | 將不採用或測試報名標為已處理；理由最多 300 字 | `{ok, dismissedId, auditLogIds}` | Owner／Editor；**已實作，待正式 Sheet 實機驗收** |
| `exportPublicTalks()` | 無 | Hub `talks.schema.json` 格式＋`generatedAt`；過 `hubWarnings` 預檢 | **延後**；本版僅保留前端手動 Hub 匯出，伺服器函式為 stub |
| `backup({reason})` | 備份理由 | `{backupId, generatedAt, schemaVersion, rowCounts}` | **延後**；伺服器函式為 stub，不在 `permissions` |
| `restorePreview({backupJson})` | 備份內容 | `{ok, schemaVersion, rowCounts, unknownFields, piiWarnings, diffSummary}`；**不寫入** | **延後**；伺服器函式為 stub，不在 `permissions` |
| `purgeDeleted({table, ids, before})` | 指定表／列或日期界線 | `{purged, rowCounts, auditLogId}` | **延後**；伺服器函式為 stub，不在 `permissions` |
| `uploadEvidence({target, fileBase64, fileName, mimeType})` | 核銷憑證上傳（場次＋其他支出通用） | 原規劃為自動建 Drive 子資料夾並回填 `evidenceUrl` | **移至通用核心後續里程碑**；本版採貼上 Drive `https://` 連結 |
| `checkTodoEvidence({talkId})` | 待辦自動偵測 | 原規劃比對 Drive 檔名／Gmail 寄件備份，手動勾選永遠優先 | **移至通用核心後續里程碑**；本版採人工勾選 |

## C. `saveBatch` envelope 與衝突格式

**v0 採單批 atomic**：同一批任一筆 `conflict` 或 `validation` → 整批不寫入（前端收到後重新取 snapshot、拆批重送）。

請求：
```json
{
  "schemaVersion": 2,
  "clientBatchId": "uuid",
  "changes": [
    { "changeId": "c1", "op": "upsert", "table": "Talks", "id": "t01",
      "base": { "updatedAt": "2026-07-10T08:00:00Z", "version": 3 },
      "record": { "title": "..." } },
    { "changeId": "c2", "op": "softDelete", "table": "Speakers", "id": "sabc123",
      "base": { "updatedAt": "2026-07-10T08:01:00Z", "version": 1 } }
  ]
}
```

成功：
```json
{ "ok": true, "schemaVersion": 2, "serverTime": "...",
  "accepted": [ { "changeId": "c1", "table": "Talks", "id": "t01",
                  "updatedAt": "...", "updatedBy": "owner@example.invalid", "version": 4 } ],
  "auditLogIds": ["log_..."] }
```

衝突：
```json
{ "ok": false,
  "error": { "code": "conflict", "message": "資料已被其他使用者更新", "retryable": false },
  "conflicts": [ { "changeId": "c1", "table": "Talks", "id": "t01", "reason": "stale_record",
                   "clientBase": { "updatedAt": "...", "version": 3 },
                   "server": { "updatedAt": "...", "version": 4, "record": {} },
                   "clientRecord": {} } ] }
```

## D. 錯誤碼表

| code | 意義 |
|---|---|
| `unauthenticated` | 無法取得登入身分（email 空字串） |
| `unauthorized` | 不在 `Users` allowlist 或角色不足 |
| `validation` | 型別、長度、enum、必填或 allowlist 驗證失敗 |
| `unknown_fields` | payload 含契約外欄位 |
| `conflict` | `updatedAt`／`version` 與伺服器現值不符 |
| `schema_mismatch` | client schema 過舊／過新／無法 migration |
| `not_found` | 指定 `id` 不存在或已 purge |
| `busy` | LockService／併發忙碌；可附 `retryAfterSec` |
| `rate_limited` | 公開收件或 API 節流 |
| `payload_too_large` | payload 超限 |
| `pii_detected` | 匯入／還原預覽偵測疑似不可入庫個資 |
| `internal` | 未預期錯誤；**對外訊息不得回顯 email／電話** |
| `not_implemented` | 過渡碼：延後功能的 stub API 尚未實作；凡已啟用、列於 `permissions` 或有正式 UI 入口的功能，正式上線時不得回此碼 |

現行公開端點回可讀 JSON：成功為 `{ok:true}`（冪等重送另帶 `duplicate:true`）；失敗使用本表的 `validation`、`busy`、`payload_too_large`、`pii_detected` 或 `internal`，可重試的忙碌回應另帶 `retryAfterSec`。公開頁必須顯示真實結果，不可把失敗當成功。

公開檔期讀取是唯一例外：`GET ?schedule=1` 回 `{ok:true, generatedAt, talks:[{date,status}]}`，`status` 只允許 `negotiating`／`confirmed`／`done`。固定不得含姓名、講題、email、電話、備註、核銷或完整 Sheet 列；讀取失敗時公開頁必須回到「檔期待確認」，不能把未知狀態當成開放。

## E. `schemaVersion` 演進規則

- 本契約現行 Sheet `schemaVersion = 2`（v0.3 起；v1→v2 由 `migrateToV2()` 升版）；它是**整份資料結構**的版本，與每筆 record 的 `version`（樂觀鎖）不同。
- 任何持久化欄位增刪、型別變更、enum 變更 → 必升版。
- 伺服器只接受目前版本與明確支援 migration 的舊版；未來版本一律回 `schema_mismatch`。
- migration 由**伺服器**執行並寫 `AuditLog`；不得靠前端 `normalize()` 靜默吞欄。

## F. `AuditLog` 列格式（append-only）

| 欄位 | 說明 |
|---|---|
| `eventAt` | 事件時間（ISO 8601） |
| `actorEmail` | 伺服器端取得的使用者 email |
| `actorRole` | `owner`／`editor`；拒絕事件記 `denied` |
| `action` | `create`／`update`／`softDelete`／`importSubmission`／`dismissSubmission`；保留給後續里程碑：`purge`／`exportPublicTalks`／`backup`／`restorePreview`／`schemaMigrate`／`loginDenied` |
| `entityType` | `Speakers`／`Talks`／`Weeks`／`Tasks`／`Reimbursements`／`BudgetLines`／`Expenses`／`Submissions`／`Users`／`Settings`（v0.2.1 補齊，與 `TABLE_ORDER` 一致） |
| `entityId` | 目標 record id；批次放主要 id、其餘進 `detailJson` |
| `beforeVersion`／`afterVersion` | 寫入前後的 record version |
| `requestId` | `clientBatchId` 或 server 產生 |
| `result` | `ok` 或錯誤碼 |
| `detailJson` | 精簡摘要（變更欄位、row counts）；**不得放完整聯絡資料或 raw submission** |

---
_v0 起草 2026-07-10；v0.1 凍結裁決同日（修訂 8 條見開頭）。Phase 1 由此檔開工：後端寫專案 A／B 的 `.gs`、前端改資料層，雙方以本檔為準、誰要改先開議。_
