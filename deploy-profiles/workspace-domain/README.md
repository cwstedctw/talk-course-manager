# 同校 Google Workspace 部署設定

這是第一階段唯一正式支援的部署模式：管理者與協作者必須屬於同一個學校 Google Workspace 網域。

## 前置條件

- 使用學校 Google Workspace 帳號建立或複製 Google Sheet。
- Apps Script 必須是該 Sheet 的 container-bound project。
- `src/gas-admin/Code.gs` 已放入 Apps Script 專案。
- 前端 build 已產生 `Index.html`；不要在後端目錄手工維護另一份 UI。
- manifest 使用本目錄的 `appsscript.json`。

## 安裝與部署

1. 在目標 Google Sheet 開啟「擴充功能 → Apps Script」。
2. 放入建置後的 `Code.gs`、`Index.html` 與本 profile 的 `appsscript.json`。
3. 回到試算表並重新整理。
4. 從「Talk Course Manager → 安裝／修復系統」執行 `installSystem()`，完成 Google 授權。
5. 確認自動建立 `Users`、`Settings`、`Speakers`、`Talks`、`Tasks`、`AuditLog`、`Transactions`；安裝者會成為第一位 owner。
6. 部署為 Web app，執行身分選「部署應用程式的使用者」，存取權選「網域內的所有人」。
7. 由 owner 在 `Users` 加入同網域 editor，再使用 editor 帳號實測管理台。

> 不要把底層 Google Sheet 分享成 editor 可直接編輯。協作者只使用 Web App；若直接取得 Sheet 編輯權，就能繞過應用程式角色、資料驗證與 AuditLog。
8. 執行「Talk Course Manager → 執行系統健檢」。

manifest 的正式值為：

```json
{
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "DOMAIN"
  }
}
```

不要改成匿名存取。`DOMAIN` 只擋網域外帳號；同網域使用者仍必須存在 `Users` 且狀態為 active，後端才會回傳資料。

## 驗收矩陣

至少逐一確認：

- owner 可讀寫所有資料、匯入課程設定與管理 Users。
- editor 可讀寫 Speakers、Talks、Tasks，但不能管理 Users 或匯入設定。
- 同網域但不在 Users 的帳號無法取得 snapshot。
- 網域外帳號無法開啟部署。
- 兩個帳號同時修改同一資料時，舊 revision／version 會被拒絕。
- 刪除資料後仍可由 owner 以 `includeDeleted` 查到審計痕跡。
- `healthCheck()` 回報所有必要工作表與欄位正確，且 active owner 至少一位。

## 不可寫入 repo 的資料

- Google Sheet ID
- Apps Script project ID 或 deployment ID
- 學校或個人 email
- OAuth token、API key
- 真實講者、課程或行政資料

部署 ID、Sheet ID 與授權狀態都屬於各校自己的執行環境，不是可分享設定的一部分。

安裝時，後端會把綁定 Sheet ID 存入 Apps Script 的 Script Properties，供 Web app 執行時使用。這個值由程式在每次安裝／修復時更新，不需要也不應手動貼進原始碼。
