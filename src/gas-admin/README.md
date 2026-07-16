# Apps Script 管理台後端

這個目錄是綁定 Google Sheet 的 Apps Script 後端原始碼。第一階段只支援同一個學校 Google Workspace 網域；不支援一般 Gmail 或跨網域協作。

## 公開 API

| 函式 | 權限 | 用途 |
|---|---|---|
| `onOpen()` | Sheet 使用者 | 建立安裝與健檢選單 |
| `installSystem()` | 首次安裝者／owner | 建表並安全建立第一位 owner |
| `doGet()` | owner、editor | 載入建置產生的 `Index.html` |
| `whoami()` | 已登入網域使用者 | 回傳登入與角色狀態，不回傳課程資料 |
| `getSnapshot(options)` | owner、editor | 取得目前 revision、設定與業務資料 |
| `saveBatch(payload)` | owner、editor | 以 revision、row version 與復原 journal 保護的單筆寫入 |
| `importCourseConfig(payload)` | owner | 驗證並匯入通用課程設定 |
| `healthCheck()` | owner | 檢查必要工作表、欄位、網域與 owner |

所有寫入都會取得 `ScriptLock`。第一階段每次只接受一筆 operation；寫入前先完成權限、版本與參照驗證，並在 `Transactions` 留下 prepared journal。若 Apps Script 在多張表寫入途中被中斷，下次受保護 API 會依 before/after、revision 與 AuditLog 完成復原；遇到無法判定的人工改表則停止並要求 owner 處理，不會猜測覆蓋。

## `saveBatch` 契約

```json
{
  "baseRevision": 3,
  "operations": [
    {
      "entity": "speakers",
      "action": "update",
      "id": "record-id",
      "version": 2,
      "data": { "organization": "Example University" }
    }
  ]
}
```

支援的 entity 是 `speakers`、`talks`、`tasks`、`users`；action 是 `create`、`update`、`delete`。editor 不可操作 `users`。刪除一律寫入 `deletedAt`，不會移除資料列；仍被 active 子資料引用的 parent 會被拒絕刪除。

成功回應：

```json
{
  "ok": true,
  "revision": 4,
  "results": [
    { "index": 0, "entity": "speakers", "action": "update", "id": "record-id", "version": 3 }
  ]
}
```

錯誤會以 JSON 字串放在 Apps Script exception message，包含 `code`、`message` 與選用的 `details`。前端遇到 `REVISION_CONFLICT` 或 `VERSION_CONFLICT` 時應重新讀取 snapshot，不可靜默覆蓋。

## 資料安全

- API 每次都在伺服器重新檢查 `Users` 角色與 Workspace 網域。
- 系統拒絕移除最後一位 active owner，也拒絕操作者把自己鎖在系統外。
- 使用者輸入寫進儲存格前會處理 `= + - @` 等公式開頭，避免公式注入。
- `AuditLog` 只新增不修改；記錄操作者、動作、前後內容與同批 request ID。
- `Transactions` 保存可恢復的 prepared/committed journal；它不是對外業務資料。
- Apps Script 的 `LockService` 不是資料庫交易；本專案透過 journal 做失敗後復原，不宣稱跨多張 Sheet 的即時原子交易。
- 原始碼不得放入 Sheet ID、deployment ID、email 或學校專屬內容。

`installSystem()` 會把當下綁定試算表的 ID 寫入該 Apps Script 專案的 Script Properties，讓 Web app 執行時可以重新開啟正確的 Sheet。這是各校部署環境的執行期狀態，不是硬編碼，也不得提交到 repo。

`Index.html` 不在這個目錄手工維護，必須由前端 build 產生後放進 Apps Script 專案。
